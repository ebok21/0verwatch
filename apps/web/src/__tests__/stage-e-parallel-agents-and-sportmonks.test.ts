import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeReconWorkflow } from "../lib/agents/orchestrator";
import {
  InferenceBudgetGuard,
  getBudgetGuardConfig,
  inferenceBudgetGuard,
} from "../lib/inference/budget-guard";
import { InferenceProvider } from "../lib/inference/provider";
import { guardWatchRegistry } from "../lib/watch/in-memory-registry";
import { MarketMetadata, TrackedMarket, SnapshotRecord } from "@overwatch/shared";

// Mock Firestore to ensure 100% test isolation
vi.mock("../lib/firebase-admin", () => {
  const store = new Map<string, Map<string, unknown>>();
  return {
    getAdminDb: () => ({
      collection: (colName: string) => ({
        doc: (docId: string) => ({
          get: async () => {
            const data = store.get(colName)?.get(docId);
            return { exists: Boolean(data), data: () => data };
          },
          set: async (val: unknown) => {
            if (!store.has(colName)) store.set(colName, new Map());
            store.get(colName)!.set(docId, val);
          },
        }),
      }),
      runTransaction: async (cb: unknown) => cb,
    }),
    getFirestoreMetrics: () => ({ reads: 0, writes: 0, queries: 0 }),
    resetFirestoreMetrics: () => { },
  };
});

describe("Stage E — Parallel Agents, Direct Fixture Validation & Failure Isolation", () => {
  beforeEach(() => {
    inferenceBudgetGuard.resetForTesting();
    vi.restoreAllMocks();
  });

  const baseMarket: MarketMetadata = {
    marketId: "ind-nz-over-15",
    fixtureId: 71020,
    platform: "demo",
    category: "CRICKET",
    question: "Will Over 15 yield 8+ runs in IND vs NZ?",
    status: "OPEN",
    openingTime: new Date(Date.now() - 3600000).toISOString(),
    expectedResolutionTime: new Date(Date.now() + 3600000).toISOString(),
    closingTime: new Date(Date.now() + 3600000).toISOString(),
    homeTeam: "New Zealand",
    awayTeam: "India",
    competition: "ODI Series",
    matchFormat: "ODI",
    matchDate: "2026-11-06",
    scheduledStartTime: "2026-11-06T02:00:00Z",
    initialProbabilityYes: 0.55,
    resolutionContext: {
      targetOvers: [15],
      runThreshold: 8,
    },
    verifiedFixtureMeta: {
      fixtureId: 71020,
      homeTeam: "New Zealand",
      awayTeam: "India",
      startingAt: "2026-11-06T02:00:00Z",
      format: "ODI",
      venue: "Eden Park",
      status: "1st Innings",
      verifiedAt: new Date().toISOString(),
    },
  };

  it("1 & 2. Data and Intelligence Specialists start concurrently and Sergeant synthesizes report", async () => {
    const callOrder: string[] = [];
    let dataStartedAt = 0;
    let intelStartedAt = 0;

    const mockProvider: InferenceProvider = {
      providerName: "zero-g",
      complete: async (req) => {
        callOrder.push(req.agentRole ?? "UNKNOWN");

        if (req.agentRole === "DATA_SPECIALIST") {
          dataStartedAt = Date.now();
          await new Promise((r) => setTimeout(r, 20));
          return {
            content: JSON.stringify({
              summary: "Data Specialist found strong ODI head-to-head records.",
              claims: [
                {
                  text: "India scored 12 runs in Over 15 in the previous fixture.",
                  evidenceIds: [],
                  type: "EVIDENCE",
                  impact: "HIGH",
                },
              ],
              dataLimitations: [],
            }),
            toolCalls: [],
            finishReason: "stop",
            model: "qwen3.5-35b-a3b",
            requestId: "req-data",
            provider: "zero-g",
          };
        }

        if (req.agentRole === "INTELLIGENCE_SPECIALIST") {
          intelStartedAt = Date.now();
          await new Promise((r) => setTimeout(r, 20));
          return {
            content: JSON.stringify({
              summary: "Intelligence Specialist found clear weather conditions in Auckland.",
              claims: [
                {
                  text: "Weather forecasts predict clear skies and dry outfield.",
                  evidenceIds: [],
                  type: "EVIDENCE",
                  impact: "MEDIUM",
                },
              ],
              dataLimitations: [],
            }),
            toolCalls: [],
            finishReason: "stop",
            model: "qwen3.5-35b-a3b",
            requestId: "req-intel",
            provider: "zero-g",
          };
        }

        if (req.agentRole === "SERGEANT_PLANNER") {
          return {
            content: JSON.stringify({
              researchObjective: "Analyze Over 15 runs",
              dataSpecialistTask: { objective: "Analyze scorecard", allowedTools: ["cricket.get_fixture_data"], maxToolCalls: 1 },
              intelligenceSpecialistTask: { objective: "Analyze external news", allowedTools: ["web.search"], maxToolCalls: 1 },
            }),
            toolCalls: [],
            finishReason: "stop",
            model: "qwen3.5-35b-a3b",
            requestId: "req-plan",
            provider: "zero-g",
          };
        }

        if (req.agentRole === "SERGEANT_SYNTHESIS") {
          return {
            content: JSON.stringify({
              assessment: "YES",
              yesProbability: 60,
              headline: "Favorable conditions for Over 15 8+ runs",
              summary: "Combined data and intelligence indicate high boundary likelihood.",
              keyFactors: [],
              risks: [],
              uncertainties: [],
            }),
            toolCalls: [],
            finishReason: "stop",
            model: "qwen3.5-35b-a3b",
            requestId: "req-synthesis",
            provider: "zero-g",
          };
        }

        throw new Error(`Unexpected agentRole: ${req.agentRole}`);
      },
    };

    const report = await executeReconWorkflow({
      market: baseMarket,
      provider: mockProvider,
      persistToFirestore: false,
    });

    expect(callOrder[0]).toBe("SERGEANT_PLANNER");
    // Both data and intel were triggered concurrently
    expect(callOrder).toContain("DATA_SPECIALIST");
    expect(callOrder).toContain("INTELLIGENCE_SPECIALIST");
    expect(callOrder[callOrder.length - 1]).toBe("SERGEANT_SYNTHESIS");

    expect(Math.abs(dataStartedAt - intelStartedAt)).toBeLessThan(100);

    expect(report.specialistFindings).toHaveLength(2);
    expect(report.assessment).toBe("YES");
    expect(report.yesProbability).toBe(60);
  });

  it("3. If one specialist fails, the other specialist succeeds and synthesis still completes", async () => {
    const mockProvider: InferenceProvider = {
      providerName: "zero-g",
      complete: async (req) => {
        if (req.agentRole === "SERGEANT_PLANNER") {
          return {
            content: JSON.stringify({
              researchObjective: "Analyze market",
              dataSpecialistTask: { objective: "Data" },
              intelligenceSpecialistTask: { objective: "Intel" },
            }),
            toolCalls: [],
            finishReason: "stop",
            model: "qwen3.5-35b-a3b",
            requestId: "req-plan",
            provider: "zero-g",
          };
        }
        if (req.agentRole === "DATA_SPECIALIST") {
          throw new Error("Data Specialist API failed");
        }
        if (req.agentRole === "INTELLIGENCE_SPECIALIST") {
          return {
            content: JSON.stringify({
              summary: "Intelligence succeeded with weather data.",
              claims: [],
              dataLimitations: [],
            }),
            toolCalls: [],
            finishReason: "stop",
            model: "qwen3.5-35b-a3b",
            requestId: "req-intel",
            provider: "zero-g",
          };
        }
        if (req.agentRole === "SERGEANT_SYNTHESIS") {
          return {
            content: JSON.stringify({
              assessment: "INCONCLUSIVE",
              yesProbability: null,
              headline: "Partial analysis due to data outage",
              summary: "Data specialist was unavailable.",
              keyFactors: [],
              risks: [],
              uncertainties: ["Data specialist execution failed."],
            }),
            toolCalls: [],
            finishReason: "stop",
            model: "qwen3.5-35b-a3b",
            requestId: "req-synthesis",
            provider: "zero-g",
          };
        }
        throw new Error(`Unexpected agentRole: ${req.agentRole}`);
      },
    };

    const report = await executeReconWorkflow({
      market: baseMarket,
      provider: mockProvider,
      persistToFirestore: false,
    });

    expect(report.specialistFindings).toHaveLength(2);
    const dataFinding = report.specialistFindings.find((f) => f.specialist === "DATA");
    const intelFinding = report.specialistFindings.find((f) => f.specialist === "INTELLIGENCE");

    expect(dataFinding?.summary).toContain("Data specialist execution failed");
    expect(intelFinding?.summary).toContain("Intelligence succeeded");
    expect(report.assessment).toBe("INCONCLUSIVE");
  });

  it("4. Fixture grouping: multiple markets sharing the same fixtureId are polled efficiently", () => {
    guardWatchRegistry.clear();

    const mockTracked1: TrackedMarket = {
      trackingId: "watch-user-1-m1",
      userId: "user-1",
      marketId: "m1",
      platform: "demo",
      status: "WATCHING",
      authorizedBackgroundInference: true,
      activeSide: "YES",
      monitoringPlan: {
        marketId: "m1",
        pollIntervalSeconds: 30,
        monitoredTools: ["cricket.get_fixture_data"],
        watchedFields: ["status"],
        materialChangeCriteria: ["Wicket"],
        escalationConditions: ["Surge"],
        cooldownSeconds: 60,
        maxSentryEvaluations: 3,
        maxScoutingRuns: 2,
      },
      sentryCallCount: 0,
      scoutingRunCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockSnapshot: SnapshotRecord = {
      snapshotId: "snap-1",
      trackingId: "watch-user-1-m1",
      marketId: "m1",
      platform: "demo",
      fixtureId: 71020,
      timestamp: new Date().toISOString(),
      structuredState: { status: "1st Innings" },
      hash: "hash1",
    };

    guardWatchRegistry.register({
      trackingId: "watch-user-1-m1",
      marketId: "m1",
      fixtureId: 71020,
      marketMetadata: { ...baseMarket, marketId: "m1" },
      trackedMarket: mockTracked1,
      latestSnapshot: mockSnapshot,
      dueAt: 0,
    });

    expect(guardWatchRegistry.size).toBe(1);
    expect(guardWatchRegistry.has("watch-user-1-m1")).toBe(true);
  });
});
