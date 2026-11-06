import {
  GuardWatchEvent,
  MarketMetadata,
  MonitoringPlan,
  NotificationRecord,
  NotificationRecordSchema,
  ReconReport,
  SentryEvaluation,
  SnapshotComparisonResult,
  SnapshotRecord,
  SnapshotRecordSchema,
  TrackedMarket,
  TrackedMarketSchema,
} from "@overwatch/shared";
import { getAdminDb } from "../firebase-admin";
import { getCanonicalMarketMetadata } from "../markets/store";
import { EvidenceCollector, ToolRegistry } from "../connectors/registry";
import { compareNormalizedSnapshots } from "./comparator";
import { prepareMarketCricketData } from "../connectors/cricket-sportmonks";
import {
  guardWatchRegistry,
  ActiveWatchRecord,
  WatchTickResult,
  runSentryEvaluation,
  createIdempotentNotification,
} from "./in-memory-registry";
import { notifyWorkerOfTrackUpdate } from "./worker-client";
import { logger } from "../logger";

export { guardWatchRegistry };
export { notifyWorkerOfTrackUpdate };
export type { ActiveWatchRecord, WatchTickResult };

const TRACKED_COLLECTION = "tracked_markets";
const SNAPSHOTS_COLLECTION = "snapshots";

const MIN_COOLDOWN_SECONDS = 45;
const MAX_SENTRY_EVALUATIONS_HARD_CAP = 6;
const MAX_SCOUTING_RUNS_HARD_CAP = 2;
const LEASE_DURATION_MS = 60_000;

export { runSentryEvaluation, createIdempotentNotification };

/**
 * Creates or updates a `TrackedMarket` record in Firestore and synchronizes
 * the in-memory `GuardWatchRegistry`.
 */
export async function createOrUpdateTrackedMarket(params: {
  userId: string;
  market: MarketMetadata;
  latestReconReport: ReconReport;
  authorizedBackgroundInference: boolean;
  activeSide?: "YES" | "NO";
}): Promise<TrackedMarket> {
  const trackingId = `watch-${params.userId}-${params.market.marketId}`;
  const now = new Date().toISOString();

  const initialEvent: GuardWatchEvent = {
    eventId: `evt-${Date.now()}`,
    timestamp: now,
    type: "MONITORING_STARTED",
    summary: `Monitoring activated for ${params.market.question} (${params.market.homeTeam} vs ${params.market.awayTeam}).`,
  };

  const record: TrackedMarket = TrackedMarketSchema.parse({
    trackingId,
    userId: params.userId,
    marketId: params.market.marketId,
    platform: "demo",
    status: "WATCHING",
    authorizedBackgroundInference: params.authorizedBackgroundInference,
    activeSide: params.activeSide ?? "YES",
    monitoringPlan: {
      ...params.latestReconReport.monitoringPlan,
      cooldownSeconds: Math.max(
        MIN_COOLDOWN_SECONDS,
        params.latestReconReport.monitoringPlan.cooldownSeconds
      ),
      maxSentryEvaluations: Math.min(
        MAX_SENTRY_EVALUATIONS_HARD_CAP,
        params.latestReconReport.monitoringPlan.maxSentryEvaluations
      ),
      maxScoutingRuns: Math.min(
        MAX_SCOUTING_RUNS_HARD_CAP,
        params.latestReconReport.monitoringPlan.maxScoutingRuns
      ),
    },
    latestReconRunId: params.latestReconReport.runId,
    sentryCallCount: 0,
    scoutingRunCount: 0,
    snapshotCount: 0,
    lastPolledAt: null,
    lastInferenceAt: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    recentEvents: [initialEvent],
    createdAt: now,
    updatedAt: now,
  });

  const db = getAdminDb();
  const { snapshot } = await captureSnapshotForTrackedMarket({
    trackedMarket: record,
    market: params.market,
  });

  record.latestNormalizedState = snapshot.normalizedState;
  await db.collection(TRACKED_COLLECTION).doc(trackingId).set(record);

  guardWatchRegistry.registerMarket({
    trackedMarket: record,
    market: params.market,
    activeSide: params.activeSide,
  });

  void notifyWorkerOfTrackUpdate({
    action: "TRACK",
    trackingId: record.trackingId,
    trackedMarket: record,
  });

  return record;
}

export async function captureSnapshotForTrackedMarket(params: {
  trackedMarket: TrackedMarket;
  market: MarketMetadata;
}): Promise<{
  snapshot: SnapshotRecord;
  previousSnapshot: SnapshotRecord | null;
}> {
  const db = getAdminDb();
  const fixtureData = await prepareMarketCricketData({
    fixtureId: params.market.fixtureId,
    marketType: params.market.marketType,
  });

  const matchData = (fixtureData.match ?? {}) as unknown as Record<string, unknown>;
  const firstInnings = Array.isArray(matchData.innings) && matchData.innings[0]
    ? (matchData.innings[0] as Record<string, unknown>)
    : {};

  const normalizedState: Record<string, unknown> = {
    status: matchData.status ?? params.market.status,
    note: matchData.note ?? null,
    totalRuns: firstInnings.totalRuns ?? 0,
    wickets: firstInnings.wickets ?? 0,
    oversBowled: firstInnings.oversBowled ?? 0,
    runRate: firstInnings.runRate ?? 0,
  };

  const inMemoryRecord = guardWatchRegistry.get(params.trackedMarket.trackingId);
  let previousSnapshot: SnapshotRecord | null =
    inMemoryRecord?.latestSnapshot ?? null;

  if (!previousSnapshot && params.trackedMarket.latestNormalizedState) {
    previousSnapshot = SnapshotRecordSchema.parse({
      snapshotId: `snap-${params.trackedMarket.trackingId}-prev`,
      trackingId: params.trackedMarket.trackingId,
      marketId: params.trackedMarket.marketId,
      capturedAt:
        params.trackedMarket.lastPolledAt ||
        params.trackedMarket.updatedAt ||
        new Date().toISOString(),
      normalizedState: params.trackedMarket.latestNormalizedState,
      evidenceIds: [],
      isSyntheticStep: false,
    });
  }

  const snapshotId = `snap-${params.trackedMarket.trackingId}-${Date.now()}`;
  const snapshot: SnapshotRecord = SnapshotRecordSchema.parse({
    snapshotId,
    trackingId: params.trackedMarket.trackingId,
    marketId: params.trackedMarket.marketId,
    capturedAt: new Date().toISOString(),
    normalizedState,
    evidenceIds: [],
    isSyntheticStep: false,
  });

  await db.collection(SNAPSHOTS_COLLECTION).doc(snapshotId).set(snapshot);
  return { snapshot, previousSnapshot };
}

export async function claimTrackedMarketLease(
  trackingId: string,
  workerId: string
): Promise<TrackedMarket | null> {
  const db = getAdminDb();
  const docRef = db.collection(TRACKED_COLLECTION).doc(trackingId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) return null;

    const parsed = TrackedMarketSchema.safeParse(snap.data());
    if (!parsed.success) return null;
    const market = parsed.data;

    if (market.status !== "WATCHING") {
      return null;
    }

    const now = Date.now();
    if (
      market.leaseOwner &&
      market.leaseOwner !== workerId &&
      market.leaseExpiresAt &&
      market.leaseExpiresAt > now
    ) {
      return null;
    }

    const updated: TrackedMarket = {
      ...market,
      leaseOwner: workerId,
      leaseExpiresAt: now + LEASE_DURATION_MS,
      updatedAt: new Date().toISOString(),
    };
    tx.set(docRef, updated);
    return updated;
  });
}

export async function processGuardWatchCycleForMarket(params: {
  trackingId: string;
  workerId?: string;
  bypassCooldownForManualTest?: boolean;
}): Promise<WatchTickResult> {
  let record = guardWatchRegistry.get(params.trackingId);
  if (!record) {
    const db = getAdminDb();
    const docRef = db.collection(TRACKED_COLLECTION).doc(params.trackingId);
    const snap = await docRef.get();
    if (!snap.exists) {
      throw new Error(`Tracked market "${params.trackingId}" not found.`);
    }
    const tracked = TrackedMarketSchema.parse(snap.data());
    const market = await getCanonicalMarketMetadata(tracked.marketId);
    if (!market) {
      throw new Error(`Canonical market "${tracked.marketId}" not found.`);
    }
    record = guardWatchRegistry.registerMarket({
      trackedMarket: tracked,
      market,
    });
  }

  return guardWatchRegistry.runTickForRecord(record, {
    bypassCooldown: params.bypassCooldownForManualTest,
  });
}
