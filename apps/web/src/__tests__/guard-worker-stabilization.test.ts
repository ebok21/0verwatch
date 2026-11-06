import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { getAdminDb, getFirestoreMetrics, resetFirestoreMetrics } from "../lib/firebase-admin";
import { getCanonicalMarketMetadata } from "../lib/markets/store";
import { InferenceProvider } from "../lib/inference";
import { executeReconWorkflow } from "../lib/agents/orchestrator";
import { createOrUpdateTrackedMarket } from "../lib/watch/engine";
import { createPaperPosition } from "../lib/positions/store";
import {
  guardWatchRegistry,
  runGuardWatchSweep,
  startWorkerServer,
  stopWorkerServer,
} from "../worker/guard-watch";
import { notifyWorkerOfTrackUpdate } from "../lib/watch/worker-client";

describe("Phase 1 — Guard Worker & Firestore Stabilization", () => {
  const testUserId = `test-user-stabilization-${Date.now()}`;
  let trackingId = "";

  const testProvider: InferenceProvider = {
    providerName: "zero-g",
    complete: async (req) => {
      if (req.agentRole === "SERGEANT_PLAN" || (req.agentRole as string) === "SERGEANT_PLANNER") {
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
          yesProbability: 60,
          headline: "Match Stable",
          summary: "Normal match development.",
          keyFactors: [],
          risks: [],
          uncertainties: [],
        }),
        toolCalls: [],
        finishReason: "stop",
        model: "qwen3.5-35b-a3b",
        usage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
        requestId: `test-recon-${Date.now()}`,
      };
    },
  };

  beforeAll(async () => {
    // Clean up any stale test-user tracking documents from previous test executions
    const db = getAdminDb();
    const snap = await db.collection("tracked_markets").get();
    const batch = db.batch();
    let hasDeletes = false;
    for (const doc of snap.docs) {
      if (doc.id.includes("test-user")) {
        batch.delete(doc.ref);
        hasDeletes = true;
      }
    }
    if (hasDeletes) {
      await batch.commit();
    }
  });

  afterAll(async () => {
    const db = getAdminDb();
    if (trackingId) {
      await db.collection("tracked_markets").doc(trackingId).delete();
    }
  });

  beforeEach(() => {
    resetFirestoreMetrics();
  });

  it("1. Worker startup restores active tracked markets from Firestore into in-memory Map", async () => {
    const market = await getCanonicalMarketMetadata("ind-nz-over-15");
    expect(market).not.toBeNull();

    await createPaperPosition({
      userId: testUserId,
      marketId: "ind-nz-over-15",
      side: "YES",
      stake: 50,
    });

    const reconReport = await executeReconWorkflow({
      market: market!,
      provider: testProvider,
      persistToFirestore: true,
    });

    const tracked = await createOrUpdateTrackedMarket({
      userId: testUserId,
      market: market!,
      latestReconReport: reconReport,
      authorizedBackgroundInference: true,
    });
    trackingId = tracked.trackingId;

    // Simulate worker restart by clearing the in-memory registry
    guardWatchRegistry.clear();
    expect(guardWatchRegistry.size).toBe(0);

    // Call initFromFirestore (executed once on worker startup)
    const loadedCount = await guardWatchRegistry.initFromFirestore();
    expect(loadedCount).toBeGreaterThanOrEqual(1);
    expect(guardWatchRegistry.has(trackingId)).toBe(true);

    const record = guardWatchRegistry.get(trackingId);
    expect(record).toBeDefined();
    expect(record?.trackedMarket.status).toBe("WATCHING");
    expect(record?.latestSnapshot).toBeDefined();
  });

  it("2. Recurring scheduler ticks cause EXACTLY ZERO Firestore reads and writes when state is unchanged", async () => {
    expect(guardWatchRegistry.has(trackingId)).toBe(true);

    // Reset metrics before executing recurring ticks
    resetFirestoreMetrics();
    const metricsBefore = getFirestoreMetrics();
    expect(metricsBefore.reads).toBe(0);
    expect(metricsBefore.queries).toBe(0);
    expect(metricsBefore.writes).toBe(0);

    // Execute Tick 1 (unchanged snapshot)
    const tick1 = await runGuardWatchSweep();
    expect(tick1.inspectedCount).toBeGreaterThanOrEqual(1);
    expect(tick1.processedIds).toContain(trackingId);

    // Execute Tick 2 (unchanged snapshot)
    const tick2 = await runGuardWatchSweep();
    expect(tick2.inspectedCount).toBeGreaterThanOrEqual(1);

    // Execute Tick 3 (unchanged snapshot)
    const tick3 = await runGuardWatchSweep();
    expect(tick3.inspectedCount).toBeGreaterThanOrEqual(1);

    // Verify Firestore usage across all 3 recurring ticks
    const metricsAfter = getFirestoreMetrics();
    expect(metricsAfter.reads).toBe(0);
    expect(metricsAfter.queries).toBe(0);
    expect(metricsAfter.writes).toBe(0);
  });

  it("3. Track and Untrack operations update the in-memory registry via internal worker sync", async () => {
    const testPort = 3098;
    process.env.GUARD_WORKER_PORT = String(testPort);
    process.env.GUARD_WORKER_URL = `http://127.0.0.1:${testPort}`;

    await startWorkerServer(testPort);

    try {
      expect(guardWatchRegistry.has(trackingId)).toBe(true);

      // Send UNTRACK via worker sync client
      const untrackSynced = await notifyWorkerOfTrackUpdate({
        action: "UNTRACK",
        trackingId,
      });
      expect(untrackSynced).toBe(true);
      expect(guardWatchRegistry.has(trackingId)).toBe(false);

      // Send TRACK to restore
      const db = getAdminDb();
      const snap = await db.collection("tracked_markets").doc(trackingId).get();
      expect(snap.exists).toBe(true);

      const trackSynced = await notifyWorkerOfTrackUpdate({
        action: "TRACK",
        trackingId,
        trackedMarket: snap.data() as any,
      });
      expect(trackSynced).toBe(true);
      expect(guardWatchRegistry.has(trackingId)).toBe(true);
    } finally {
      await stopWorkerServer();
    }
  });

  it("4. In-memory registry tick handles match data updates and respects cooldown", async () => {
    expect(guardWatchRegistry.has(trackingId)).toBe(true);
    const active = guardWatchRegistry.get(trackingId)!;

    resetFirestoreMetrics();

    // Run tick with fresh preFetchedMatchData and bypassCooldown
    const surgeResult = await guardWatchRegistry.runTickForRecord(active, {
      preFetchedMatchData: {
        fixtureId: 71020,
        status: "1st Innings",
        runs: [{ overs: 15.0, score: 98, wickets: 3 }],
        startingAt: new Date().toISOString(),
      },
      bypassCooldown: true,
    });

    expect(surgeResult.comparison).toBeDefined();

    // Verify cooldown is respected: immediate next poll without bypass skips inference
    resetFirestoreMetrics();
    const cooldownTick = await guardWatchRegistry.runTickForRecord(active, {
      bypassCooldown: false, // cooldown active
    });

    expect(cooldownTick.sentryEvaluation).toBeNull();
    const metricsCooldown = getFirestoreMetrics();
    expect(metricsCooldown.writes).toBe(0);
    expect(metricsCooldown.reads).toBe(0);
  });
});
