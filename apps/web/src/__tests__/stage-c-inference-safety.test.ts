import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  InferenceBudgetGuard,
  getBudgetGuardConfig,
  inferenceBudgetGuard,
} from "../lib/inference/budget-guard";
import {
  ZeroGInferenceProvider,
  InferenceProviderError,
  resolveInferenceProvider,
} from "../lib/inference";
import { fetchSportmonksFixtureData } from "../lib/connectors/cricket-sportmonks";
import { EvidenceCollector, ToolRegistry } from "../lib/connectors/registry";
import { ReconReportSchema } from "@overwatch/shared";

describe("Stage C & D - 0G Inference Safety, Cost Controls & Data Integrity", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    inferenceBudgetGuard.resetForTesting();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("1. Global Kill Switch Safeguard (Fail-Closed)", () => {
    it("defaults to disabled (OG_INFERENCE_ENABLED=false) and throws INFERENCE_DISABLED", () => {
      delete process.env.OG_INFERENCE_ENABLED;
      const config = getBudgetGuardConfig();
      expect(config.inferenceEnabled).toBe(false);

      expect(() => {
        inferenceBudgetGuard.checkCallAllowed({ workflowType: "RECON" });
      }).toThrowError(InferenceProviderError);

      try {
        inferenceBudgetGuard.checkCallAllowed({ workflowType: "RECON" });
      } catch (err) {
        expect(err).toBeInstanceOf(InferenceProviderError);
        const provErr = err as InferenceProviderError;
        expect(provErr.code).toBe("INFERENCE_DISABLED");
        expect(provErr.statusCode).toBe(403);
      }
    });

    it("blocks ZeroGInferenceProvider complete calls when kill switch is disabled", async () => {
      process.env.OG_INFERENCE_ENABLED = "false";
      const provider = new ZeroGInferenceProvider({
        apiKey: "sk-mock-valid-key-for-test-guard",
      });

      await expect(
        provider.complete({
          model: "qwen3.5-35b-a3b",
          messages: [{ role: "user", content: "test" }],
          agentRole: "DATA_SPECIALIST",
          temperature: 0.1,
          maxTokens: 100,
          timeoutMs: 5000,
        })
      ).rejects.toThrowError(/kill switch/i);
    });

    it("strictly requires user-owned sk- key", () => {
      expect(() => {
        resolveInferenceProvider({
          platform: "demo",
          decryptedUserSkKey: "",
        });
      }).toThrowError(InferenceProviderError);
    });
  });

  describe("2. Daily & Per-Workflow Budget Limits", () => {
    it("enforces global daily model call cap (default 8 calls)", () => {
      process.env.OG_INFERENCE_ENABLED = "true";
      process.env.OG_MAX_DAILY_MODEL_CALLS = "3";
      const guard = new InferenceBudgetGuard();

      expect(guard.isCallAllowed().allowed).toBe(true);

      const r1 = guard.acquireReservation({ workflowId: "wf-1" });
      r1.recordSuccess({
        requestId: "r1",
        model: "qwen3.5-35b-a3b",
        provider: "zero-g",
        workflowId: "wf-1",
        timestamp: new Date().toISOString(),
        promptTokens: 10,
        completionTokens: 10,
        totalTokens: 20,
        durationMs: 100,
        estimatedCostUsd: 0.001,
      });

      const r2 = guard.acquireReservation({ workflowId: "wf-1" });
      r2.recordSuccess({
        requestId: "r2",
        model: "qwen3.5-35b-a3b",
        provider: "zero-g",
        workflowId: "wf-1",
        timestamp: new Date().toISOString(),
        promptTokens: 10,
        completionTokens: 10,
        totalTokens: 20,
        durationMs: 100,
        estimatedCostUsd: 0.001,
      });

      const r3 = guard.acquireReservation({ workflowId: "wf-1" });
      r3.recordSuccess({
        requestId: "r3",
        model: "qwen3.5-35b-a3b",
        provider: "zero-g",
        workflowId: "wf-1",
        timestamp: new Date().toISOString(),
        promptTokens: 10,
        completionTokens: 10,
        totalTokens: 20,
        durationMs: 100,
        estimatedCostUsd: 0.001,
      });

      expect(guard.isCallAllowed().allowed).toBe(false);
      expect(guard.isCallAllowed().code).toBe("DAILY_BUDGET_EXCEEDED");
    });
  });

  describe("3. Concurrency Throttle", () => {
    it("enforces max concurrent model requests and releases slot atomically", () => {
      process.env.OG_INFERENCE_ENABLED = "true";
      process.env.OG_MAX_CONCURRENT_MODEL_CALLS = "2";
      const guard = new InferenceBudgetGuard();

      const slot1 = guard.acquireReservation({ workflowId: "wf-1" });
      const slot2 = guard.acquireReservation({ workflowId: "wf-1" });

      expect(guard.isCallAllowed().allowed).toBe(false);
      expect(guard.isCallAllowed().code).toBe("RATE_LIMITED");

      slot1.release();
      expect(guard.isCallAllowed().allowed).toBe(true);

      slot2.release();
    });
  });

  describe("4. Sportmonks Fail-Closed Data Integrity", () => {
    it("returns null match with clear disclosure when SPORTMONKS_API_TOKEN is missing", async () => {
      delete process.env.SPORTMONKS_API_TOKEN;

      const result = await fetchSportmonksFixtureData({
        fixtureId: 99999,
      });

      expect(result.match).toBeNull();
      expect(result.unavailableReason).toMatch(/SPORTMONKS_API_TOKEN is not configured/i);
    });

    it("ToolRegistry records unavailable evidence without fabricating ball-by-ball deliveries", async () => {
      delete process.env.SPORTMONKS_API_TOKEN;
      const collector = new EvidenceCollector();
      const registry = new ToolRegistry(collector);

      const toolOutput = await registry.executeToolCall(
        "cricket.get_fixture_data",
        JSON.stringify({ fixtureId: 77777 })
      );

      expect(toolOutput.evidenceRecord.toolOperation).toBe("cricket.get_fixture_data");
      expect(toolOutput.serializedModelOutput).toMatch(/DATA_UNAVAILABLE/);
      expect(toolOutput.serializedModelOutput).toMatch(/Do not invent or assume live scores/);
    });
  });

  describe("5. Conformance to ReconReportSchema", () => {
    it("conforms to strict ReconReportSchema with uncalibrated AI estimate", () => {
      const sampleReport = {
        runId: "recon-test-stage-c",
        marketId: "ind-nz-over-15",
        fixtureId: 71020,
        platform: "demo" as const,
        mode: "RECON" as const,
        assessment: "YES" as const,
        yesProbability: 60,
        noProbability: 40,
        estimateLabel: "AI ESTIMATE — UNCALIBRATED",
        headline: "High Run Rate Expected",
        summary: "Empirical analysis supports 8+ runs in Over 15.",
        keyFactors: [
          {
            text: "Overwatch notes compact boundary size.",
            evidenceIds: ["EV-01"],
            type: "EVIDENCE" as const,
            impact: "MEDIUM" as const,
          },
        ],
        risks: [],
        supportingClaims: [],
        uncertainties: ["Toss winner decision pending"],
        dataFreshness: {
          fixtureId: 71020,
          fixtureStatus: "1st Innings",
          sportmonksRetrievedAt: new Date().toISOString(),
          tavilyRetrievedAt: new Date().toISOString(),
          freshnessSummary: "Match data live.",
        },
        evidenceIds: ["EV-01"],
        specialistFindings: [],
        evidenceMap: {
          "EV-01": {
            evidenceId: "EV-01",
            toolOperation: "market.get_metadata" as const,
            sourceUrlOrOrigin: "overwatch://markets/ind-nz-over-15",
            retrievedAt: new Date().toISOString(),
            extractedData: {},
          },
        },
        monitoringPlan: {
          marketId: "ind-nz-over-15",
          pollIntervalSeconds: 30,
          monitoredTools: ["market.get_metadata" as const],
          watchedFields: ["status"],
          materialChangeCriteria: ["Status change"],
          escalationConditions: ["Live match start"],
          cooldownSeconds: 45,
          maxSentryEvaluations: 5,
          maxScoutingRuns: 2,
        },
        requestIds: ["req-1"],
        provider: "zero-g" as const,
        createdAt: new Date().toISOString(),
      };

      const parsed = ReconReportSchema.safeParse(sampleReport);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.assessment).toBe("YES");
        expect(parsed.data.yesProbability).toBe(60);
        expect(parsed.data.estimateLabel).toBe("AI ESTIMATE — UNCALIBRATED");
      }
    });
  });
});
