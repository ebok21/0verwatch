import { describe, it, expect } from "vitest";
import { getCanonicalMarketMetadata } from "../lib/markets/store";
import { InferenceProvider } from "../lib/inference";
import { executeReconWorkflow } from "../lib/agents/orchestrator";
import {
  createOrUpdateTrackedMarket,
  processGuardWatchCycleForMarket,
} from "../lib/watch/engine";
import {
  createPaperPosition,
  listPaperPositionsForUser,
  closePaperPosition,
} from "../lib/positions/store";

describe("Overwatch End-to-End Backend Integration (Recon -> Paper Position -> Guard Watch)", () => {
  const testProvider: InferenceProvider = {
    providerName: "zero-g",
    complete: async (req) => {
      if (req.agentRole === "SERGEANT_PLANNER") {
        return {
          provider: "zero-g",
          content: JSON.stringify({
            researchObjective: "Analyze market ind-nz-over-15",
            dataSpecialistTask: { objective: "Analyze scorecard", allowedTools: ["cricket.get_fixture_data"], maxToolCalls: 1 },
            intelligenceSpecialistTask: { objective: "Analyze external news", allowedTools: ["web.search"], maxToolCalls: 1 },
          }),
          toolCalls: [],
          finishReason: "stop",
          model: "qwen3.5-35b-a3b",
          usage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
          requestId: `test-plan-${Date.now()}`,
        };
      }
      return {
        provider: "zero-g",
        content: JSON.stringify({
          assessment: "YES",
          yesProbability: 62,
          headline: "High Run Rate Expected",
          summary: "Historical data and pitch conditions indicate strong likelihood of 8+ runs.",
          keyFactors: [],
          risks: [],
          uncertainties: ["Toss decision may alter second-innings conditions."],
        }),
        toolCalls: [],
        finishReason: "stop",
        model: "qwen3.5-35b-a3b",
        usage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
        requestId: `test-recon-${Date.now()}`,
      };
    },
  };

  it("executes Full Recon with parallel Data & Intelligence Specialists and verifies ReconReportSchema", async () => {
    const market = await getCanonicalMarketMetadata("ind-nz-over-15");
    expect(market).not.toBeNull();

    const report = await executeReconWorkflow({
      market: market!,
      provider: testProvider,
      persistToFirestore: true,
    });

    expect(report.marketId).toBe("ind-nz-over-15");
    expect(report.mode).toBe("RECON");
    expect(report.assessment).toBe("YES");
    expect(report.yesProbability).toBe(62);
    expect(report.noProbability).toBe(38);
    expect(report.estimateLabel).toContain("AI ESTIMATE");
    expect(report.provider).toBe("zero-g");

    // Verify parallel Specialists ran and Contrarian is completely excluded
    expect(report.specialistFindings.map((f) => f.specialist)).toEqual([
      "DATA",
      "INTELLIGENCE",
    ]);

    // Verify cited evidenceIds exist in evidenceMap
    const validIds = new Set(Object.keys(report.evidenceMap));
    for (const claim of [...report.keyFactors, ...report.risks]) {
      for (const evId of claim.evidenceIds) {
        expect(validIds.has(evId)).toBe(true);
      }
    }
  });

  it("manages Paper Position lifecycle: open -> list -> close with idempotency", async () => {
    const testUserId = `paper-user-${Date.now()}`;
    const position = await createPaperPosition({
      userId: testUserId,
      marketId: "ind-nz-over-15",
      fixtureId: 71020,
      question: "Will Over 15 yield 8+ runs?",
      side: "YES",
      stake: 50,
      reconRunId: "test-run-123",
      label: "YES $50",
      idempotencyKey: `idem-${testUserId}-1`,
    });

    expect(position.positionId).toBeDefined();
    expect(position.status).toBe("OPEN");
    expect(position.stake).toBe(50);
    expect(position.side).toBe("YES");

    // Idempotent duplicate open returns existing position
    const duplicate = await createPaperPosition({
      userId: testUserId,
      marketId: "ind-nz-over-15",
      fixtureId: 71020,
      question: "Will Over 15 yield 8+ runs?",
      side: "YES",
      stake: 50,
      reconRunId: "test-run-123",
      label: "YES $50",
      idempotencyKey: `idem-${testUserId}-1`,
    });
    expect(duplicate.positionId).toBe(position.positionId);

    // List open positions
    const openPositions = await listPaperPositionsForUser(testUserId, "OPEN");
    expect(openPositions.some((p) => p.positionId === position.positionId)).toBe(true);

    // Close position
    const closed = await closePaperPosition(position.positionId, testUserId);
    expect(closed?.status).toBe("CLOSED");
    expect(closed?.closedAt).toBeDefined();
  });

  it("runs Guard Watch -> skips unchanged snapshot", async () => {
    const market = await getCanonicalMarketMetadata("ind-nz-over-15");
    const initialReport = await executeReconWorkflow({
      market: market!,
      provider: testProvider,
      persistToFirestore: true,
    });

    const testUserId = `watch-user-${Date.now()}`;
    const tracked = await createOrUpdateTrackedMarket({
      userId: testUserId,
      market: market!,
      latestReconReport: initialReport,
      authorizedBackgroundInference: true,
      activeSide: "YES",
    });

    expect(tracked.status).toBe("WATCHING");
    expect(tracked.sentryCallCount).toBe(0);

    // 1. Poll with unchanged state -> skips AI inference
    const unchangedCycle = await processGuardWatchCycleForMarket({
      trackingId: tracked.trackingId,
      bypassCooldownForManualTest: true,
    });
    expect(unchangedCycle.comparison.hasMeaningfulChanges).toBe(false);
    expect(unchangedCycle.sentryEvaluation).toBeNull();
    expect(unchangedCycle.trackedMarket.sentryCallCount).toBe(0);
  });
});
