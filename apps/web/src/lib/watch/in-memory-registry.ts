import {
  GuardWatchEvent,
  MarketMetadata,
  MonitoringPlan,
  NotificationRecord,
  NotificationRecordSchema,
  ReconReport,
  SentryAlertCategory,
  SentryAlertCategorySchema,
  SentryDecisionTypeSchema,
  SentryEvaluation,
  SentryEvaluationSchema,
  SnapshotComparisonResult,
  SnapshotComparisonResultSchema,
  SnapshotRecord,
  SnapshotRecordSchema,
  TrackedMarket,
  TrackedMarketSchema,
} from "@overwatch/shared";
import { getAdminDb } from "../firebase-admin";
import { getCanonicalMarketMetadata } from "../markets/store";
import { EvidenceCollector, ToolRegistry } from "../connectors/registry";
import { compareNormalizedSnapshots } from "./comparator";
import {
  InferenceProvider,
  InferenceProviderError,
  resolveInferenceProvider,
} from "../inference";
import { SENTRY_SYSTEM_PROMPT } from "../agents/prompts";
import { getLatestReconReportForMarket } from "../agents/orchestrator";
import { getUserDecryptedZeroGKeys } from "../auth/session";
import { inferenceBudgetGuard } from "../inference/budget-guard";
import { prepareMarketCricketData } from "../connectors/cricket-sportmonks";
import { listPaperPositions } from "../positions/store";
import { logger } from "../logger";

const TRACKED_COLLECTION = "tracked_markets";
const SNAPSHOTS_COLLECTION = "snapshots";
const NOTIFICATIONS_COLLECTION = "notifications";

const MIN_COOLDOWN_SECONDS = 45;
const MAX_SENTRY_EVALUATIONS_HARD_CAP = 6;

function extractJsonFromText(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  try {
    return JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function createIdempotentNotification(
  notification: NotificationRecord
): Promise<NotificationRecord> {
  const validated = NotificationRecordSchema.parse(notification);
  try {
    const db = getAdminDb();
    await db
      .collection(NOTIFICATIONS_COLLECTION)
      .doc(validated.notificationId)
      .set(validated, { merge: true });
  } catch (err) {
    logger.warn("Could not persist notification to Firestore (offline/test mode)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return validated;
}

export async function runSentryEvaluation(params: {
  market: MarketMetadata;
  monitoringPlan: MonitoringPlan;
  comparison: SnapshotComparisonResult;
  provider: InferenceProvider;
  toolRegistry: ToolRegistry;
  activeSide?: "YES" | "NO";
  currentMatchState?: Record<string, unknown>;
  latestReconReport?: ReconReport | null;
}): Promise<SentryEvaluation> {
  const reconSummary = params.latestReconReport
    ? {
        assessment: params.latestReconReport.assessment,
        yesProbability: params.latestReconReport.yesProbability,
        noProbability: params.latestReconReport.noProbability,
        headline: params.latestReconReport.headline,
        summary: params.latestReconReport.summary,
      }
    : null;

  const res = await params.provider.complete({
    model: "qwen3.5-35b-a3b",
    agentRole: "SENTRY",
    systemInstruction: SENTRY_SYSTEM_PROMPT,
    temperature: 0.1,
    maxTokens: 500,
    timeoutMs: 15000,
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          marketId: params.market.marketId,
          question: params.market.question,
          marketType: params.market.marketType,
          resolutionCriteria: params.market.resolutionCriteria,
          activePaperPositionSide: params.activeSide ?? "YES",
          monitoringPlan: params.monitoringPlan,
          currentMatchState: params.currentMatchState ?? {},
          latestReconAssessment: reconSummary,
          matchDevelopmentDiff: params.comparison,
          instruction:
            "Evaluate whether current live match status or Recon findings threaten or contradict the user's active paper position (YES or NO). If a discrepancy or adverse event exists, alert immediately as POSITION_THESIS_WEAKENED or CRITICAL_DEVELOPMENT with HIGH or CRITICAL severity.",
        }),
      },
    ],
  });

  const parsed = extractJsonFromText(res.content);
  const decision = SentryDecisionTypeSchema.safeParse(parsed.decision).success
    ? (parsed.decision as SentryEvaluation["decision"])
    : "NOTIFY_ONLY";

  const rawCat = typeof parsed.alertCategory === "string" ? parsed.alertCategory.toUpperCase() : "";
  const alertCategory: SentryAlertCategory = SentryAlertCategorySchema.safeParse(rawCat).success
    ? (rawCat as SentryAlertCategory)
    : "CRITICAL_DEVELOPMENT";

  return SentryEvaluationSchema.parse({
    decision,
    alertCategory,
    severity:
      parsed.severity === "LOW" ||
        parsed.severity === "MEDIUM" ||
        parsed.severity === "HIGH" ||
        parsed.severity === "CRITICAL"
        ? parsed.severity
        : "CRITICAL",
    summary: String(
      parsed.summary ?? "Sentry evaluated cricket development against paper position."
    ),
    reasoning: String(
      parsed.reasoning ?? "Live cricket match development detected."
    ),
    recommendedSpecialists: ["DATA"],
    requestId: res.requestId,
    provider: "zero-g",
    evaluatedAt: new Date().toISOString(),
  });
}

export interface ActiveWatchRecord {
  trackingId: string;
  userId: string;
  marketId: string;
  fixtureId: number;
  market: MarketMetadata;
  trackedMarket: TrackedMarket;
  latestSnapshot: SnapshotRecord | null;
  latestReconReport: ReconReport | null;
  lastPolledAt: string | null;
  lastInferenceAt: string | null;
  sentryCallCount: number;
  scoutingRunCount: number;
  activeSide?: "YES" | "NO";
  userDecryptedKeys?: {
    skKey: string | null;
    mkKey: string | null;
  };
}

export interface WatchTickResult {
  trackedMarket: TrackedMarket;
  comparison: SnapshotComparisonResult;
  sentryEvaluation: SentryEvaluation | null;
  scoutingReport: ReconReport | null;
  notification: NotificationRecord | null;
}

export class GuardWatchRegistry {
  private readonly records = new Map<string, ActiveWatchRecord>();
  private isInitialized = false;

  public get size(): number {
    return this.records.size;
  }

  public has(trackingId: string): boolean {
    return this.records.has(trackingId);
  }

  public get(trackingId: string): ActiveWatchRecord | undefined {
    return this.records.get(trackingId);
  }

  public getAll(): ActiveWatchRecord[] {
    return Array.from(this.records.values());
  }

  public clear(): void {
    this.records.clear();
    this.isInitialized = false;
  }

  /**
   * Deactivates all tracking records for a specific market (e.g. on market deletion).
   */
  public deactivateMarket(marketId: string): number {
    let count = 0;
    for (const [trackingId, record] of this.records.entries()) {
      if (record.marketId === marketId) {
        record.trackedMarket.status = "STOPPED";
        this.records.delete(trackingId);
        count += 1;
      }
    }
    if (count > 0) {
      logger.info(`[GUARD] Deactivated ${count} tracking records for deleted market ${marketId}`);
    }
    return count;
  }

  public async initFromFirestore(): Promise<number> {
    try {
      const db = getAdminDb();
      const snap = await db
        .collection(TRACKED_COLLECTION)
        .where("status", "==", "WATCHING")
        .get();

      for (const doc of snap.docs) {
        const parsed = TrackedMarketSchema.safeParse(doc.data());
        if (!parsed.success) continue;

        const tracked = parsed.data;
        const market = await getCanonicalMarketMetadata(tracked.marketId);
        if (!market) continue;

        this.registerMarket({
          trackedMarket: tracked,
          market,
        });
      }
      this.isInitialized = true;
    } catch {
      this.isInitialized = true;
    }
    return this.records.size;
  }

  public registerMarket(params: {
    trackedMarket: TrackedMarket;
    market: MarketMetadata;
    activeSide?: "YES" | "NO";
    latestReconReport?: ReconReport | null;
  }): ActiveWatchRecord {
    const record: ActiveWatchRecord = {
      trackingId: params.trackedMarket.trackingId,
      userId: params.trackedMarket.userId,
      marketId: params.market.marketId,
      fixtureId: params.market.fixtureId,
      market: params.market,
      trackedMarket: params.trackedMarket,
      latestSnapshot: null,
      latestReconReport: params.latestReconReport ?? null,
      lastPolledAt: params.trackedMarket.lastPolledAt,
      lastInferenceAt: params.trackedMarket.lastInferenceAt,
      sentryCallCount: params.trackedMarket.sentryCallCount,
      scoutingRunCount: params.trackedMarket.scoutingRunCount,
      activeSide: params.activeSide ?? params.trackedMarket.activeSide,
    };

    this.records.set(record.trackingId, record);
    logger.info(`[GUARD] Guard Watch activated | trackingId=${record.trackingId} | marketId=${record.marketId}`);
    return record;
  }

  public unregisterMarket(trackingId: string): boolean {
    const removed = this.records.delete(trackingId);
    if (removed) {
      logger.info(`[GUARD] Monitoring stopped | trackingId=${trackingId}`);
    }
    return removed;
  }

  public updateStatus(trackingId: string, status: TrackedMarket["status"]): boolean {
    const existing = this.records.get(trackingId);
    if (!existing) return false;
    existing.trackedMarket.status = status;
    if (status !== "WATCHING") {
      this.records.delete(trackingId);
    }
    return true;
  }

  /**
   * Executes a single monitoring tick for an active record:
   * Uses real Sportmonks match data shared by fixtureId.
   */
  public async runTickForRecord(
    active: ActiveWatchRecord,
    options?: {
      preFetchedMatchData?: Record<string, unknown>;
      bypassCooldown?: boolean;
    }
  ): Promise<WatchTickResult> {
    const now = new Date().toISOString();

    // Check in-memory position state (zero Firestore reads during recurring scheduler ticks)
    const hasActivePosition = Boolean(
      active.activeSide ||
      (active.trackedMarket.positionIds && active.trackedMarket.positionIds.length > 0)
    );

    if (!hasActivePosition) {
      this.unregisterMarket(active.trackingId);
      active.trackedMarket.status = "STOPPED";
      return {
        trackedMarket: active.trackedMarket,
        comparison: { hasMeaningfulChanges: false, changes: [], comparedAt: now },
        sentryEvaluation: null,
        scoutingReport: null,
        notification: null,
      };
    }

    let matchData = options?.preFetchedMatchData;
    if (!matchData) {
      const res = await prepareMarketCricketData({
        fixtureId: active.fixtureId,
        marketType: active.market.marketType,
      });
      matchData = (res.match ?? {}) as unknown as Record<string, unknown>;
    }

    const firstInnings = Array.isArray(matchData.innings) && matchData.innings[0]
      ? (matchData.innings[0] as Record<string, unknown>)
      : {};

    const normalizedState: Record<string, unknown> = {
      status: matchData.status ?? active.market.status,
      note: matchData.note ?? null,
      totalRuns: firstInnings.totalRuns ?? 0,
      wickets: firstInnings.wickets ?? 0,
      oversBowled: firstInnings.oversBowled ?? 0,
      runRate: firstInnings.runRate ?? 0,
    };

    const previousState =
      active.latestSnapshot?.normalizedState ||
      active.trackedMarket.latestNormalizedState ||
      null;

    const comparison = compareNormalizedSnapshots({
      previousState,
      currentState: normalizedState,
      watchedFields: ["status", "note", "totalRuns", "wickets", "oversBowled"],
    });

    // Ensure baseline recon report is available for position thesis checks
    if (!active.latestReconReport) {
      active.latestReconReport = await getLatestReconReportForMarket(active.marketId);
    }

    const hasMeaningfulMatchChanges = comparison.hasMeaningfulChanges;

    // Detect if the active trade side directly contradicts the Recon assessment
    const hasPositionContradiction = Boolean(
      active.activeSide &&
      active.latestReconReport &&
      active.sentryCallCount < 2 &&
      (
        (active.activeSide === "YES" && active.latestReconReport.assessment === "NO") ||
        (active.activeSide === "NO" && active.latestReconReport.assessment === "YES")
      )
    );

    const isMatchCompleted =
      normalizedState.status === "FINISHED" ||
      normalizedState.status === "FT" ||
      normalizedState.status === "COMPLETED" ||
      normalizedState.status === "ABANDONED";

    const isMatchCompletedWithActiveTrade = Boolean(
      active.activeSide &&
      active.sentryCallCount < 2 &&
      isMatchCompleted
    );

    const isManualBypass = Boolean(options?.bypassCooldown);

    // Evaluate Sentry if:
    // 1) Live match state or scorecard changed
    // 2) Active trade directly contradicts Recon baseline thesis or match is concluded
    // 3) Manual test/bypass requested
    const shouldTriggerSentry =
      hasMeaningfulMatchChanges ||
      hasPositionContradiction ||
      isMatchCompletedWithActiveTrade ||
      isManualBypass;

    // 1. If match state is unchanged and no trade discrepancy: ZERO FIRESTORE WRITES
    if (!shouldTriggerSentry) {
      active.lastPolledAt = now;
      active.trackedMarket.snapshotCount += 1;
      active.trackedMarket.lastPolledAt = now;

      return {
        trackedMarket: active.trackedMarket,
        comparison,
        sentryEvaluation: null,
        scoutingReport: null,
        notification: null,
      };
    }

    // Cooldown enforcement for repetitive ticks (bypassed on manual trigger)
    const cooldownMs =
      Math.max(
        MIN_COOLDOWN_SECONDS,
        active.trackedMarket.monitoringPlan.cooldownSeconds
      ) * 1000;

    if (
      !options?.bypassCooldown &&
      active.lastInferenceAt &&
      Date.now() - new Date(active.lastInferenceAt).getTime() < cooldownMs
    ) {
      active.lastPolledAt = now;
      active.trackedMarket.snapshotCount += 1;
      active.trackedMarket.lastPolledAt = now;
      return {
        trackedMarket: active.trackedMarket,
        comparison,
        sentryEvaluation: null,
        scoutingReport: null,
        notification: null,
      };
    }

    const maxSentry = Math.min(
      MAX_SENTRY_EVALUATIONS_HARD_CAP,
      active.trackedMarket.monitoringPlan.maxSentryEvaluations
    );

    if (active.sentryCallCount >= maxSentry && !options?.bypassCooldown) {
      active.trackedMarket.status = "LIMIT_REACHED";
      return {
        trackedMarket: active.trackedMarket,
        comparison,
        sentryEvaluation: null,
        scoutingReport: null,
        notification: null,
      };
    }

    // Load user keys
    if (!active.userDecryptedKeys) {
      const keys = await getUserDecryptedZeroGKeys(active.userId);
      active.userDecryptedKeys = {
        skKey: keys.skKey,
        mkKey: keys.mkKey,
      };
    }

    if (!active.userDecryptedKeys.skKey) {
      // Deterministic Sentry alert if active position directly contradicts reality or Recon
      if (hasPositionContradiction || isMatchCompleted) {
        active.sentryCallCount += 1;
        active.trackedMarket.snapshotCount += 1;
        active.trackedMarket.sentryCallCount = active.sentryCallCount;
        active.lastPolledAt = now;
        active.lastInferenceAt = now;
        active.trackedMarket.lastPolledAt = now;
        active.trackedMarket.lastInferenceAt = now;
        active.trackedMarket.latestNormalizedState = normalizedState;
        active.trackedMarket.updatedAt = now;

        const category: SentryAlertCategory = hasPositionContradiction
          ? "POSITION_THESIS_WEAKENED"
          : "CRITICAL_DEVELOPMENT";
        const reason = hasPositionContradiction
          ? `CRITICAL DISCREPANCY: Active trade side (${active.activeSide}) directly contradicts Recon assessment (${active.latestReconReport?.assessment}). Current match: ${normalizedState.totalRuns}/${normalizedState.wickets} in ${normalizedState.oversBowled} ov.`
          : `Match completed: Current fixture status is ${normalizedState.status}.`;

        const sentryEvent: GuardWatchEvent = {
          eventId: `evt-${Date.now()}`,
          timestamp: now,
          type: "SENTRY_DECISION",
          summary: `Sentry [${category}]: ${reason}`,
          sentryDecision: "NOTIFY_ONLY",
          requestId: `sentry-rule-${Date.now()}`,
        };
        active.trackedMarket.recentEvents = [
          sentryEvent,
          ...active.trackedMarket.recentEvents,
        ].slice(0, 15);

        const notification = await createIdempotentNotification({
          notificationId: `notif-${active.trackingId}-${Date.now()}`,
          userId: active.userId,
          trackingId: active.trackingId,
          marketId: active.marketId,
          type: "SENTRY_ALERT",
          alertCategory: category,
          title: `Sentry Alert [${category}] • ${active.market.marketId}`,
          message: reason,
          severity: "CRITICAL",
          requestId: sentryEvent.requestId,
          acknowledged: false,
          createdAt: now,
        });

        try {
          const db = getAdminDb();
          await db.collection(TRACKED_COLLECTION).doc(active.trackingId).set(
            {
              snapshotCount: active.trackedMarket.snapshotCount,
              sentryCallCount: active.trackedMarket.sentryCallCount,
              lastPolledAt: now,
              lastInferenceAt: now,
              latestNormalizedState: normalizedState,
              recentEvents: active.trackedMarket.recentEvents,
              updatedAt: now,
            },
            { merge: true }
          );
        } catch {
          // Non-fatal
        }

        return {
          trackedMarket: active.trackedMarket,
          comparison,
          sentryEvaluation: {
            decision: "NOTIFY_ONLY",
            alertCategory: category,
            severity: "CRITICAL",
            summary: reason,
            reasoning: reason,
            recommendedSpecialists: ["DATA"],
            requestId: sentryEvent.requestId ?? `sentry-rule-${Date.now()}`,
            provider: "zero-g",
            evaluatedAt: now,
          },
          scoutingReport: null,
          notification,
        };
      }

      active.trackedMarket.status = "PAUSED_CREDITS";
      return {
        trackedMarket: active.trackedMarket,
        comparison,
        sentryEvaluation: null,
        scoutingReport: null,
        notification: null,
      };
    }

    const budgetCheck = inferenceBudgetGuard.isCallAllowed({
      workflowType: "SENTRY",
      marketId: active.marketId,
    });

    if (!budgetCheck.allowed) {
      if (budgetCheck.code === "INFERENCE_BUDGET_EXCEEDED") {
        active.trackedMarket.status = "PAUSED_BUDGET";
      }
      active.lastPolledAt = now;
      active.trackedMarket.snapshotCount += 1;
      active.trackedMarket.lastPolledAt = now;
      return {
        trackedMarket: active.trackedMarket,
        comparison,
        sentryEvaluation: null,
        scoutingReport: null,
        notification: null,
      };
    }

    const provider: InferenceProvider = resolveInferenceProvider({
      platform: "demo",
      decryptedUserSkKey: active.userDecryptedKeys.skKey,
    });

    const evidenceCollector = new EvidenceCollector();
    const toolRegistry = new ToolRegistry(evidenceCollector, {
      activeMarket: active.market,
    });

    try {
      const sentryEvaluation = await runSentryEvaluation({
        market: active.market,
        monitoringPlan: active.trackedMarket.monitoringPlan,
        comparison,
        provider,
        toolRegistry,
        activeSide: active.activeSide,
        currentMatchState: normalizedState,
        latestReconReport: active.latestReconReport,
      });

      active.sentryCallCount += 1;
      active.lastInferenceAt = now;
      active.lastPolledAt = now;

      const snapshotId = `snap-${active.trackingId}-${Date.now()}`;
      const snapshot: SnapshotRecord = SnapshotRecordSchema.parse({
        snapshotId,
        trackingId: active.trackingId,
        marketId: active.marketId,
        capturedAt: now,
        normalizedState,
        evidenceIds: [],
        isSyntheticStep: false,
      });
      active.latestSnapshot = snapshot;

      active.trackedMarket.sentryCallCount = active.sentryCallCount;
      active.trackedMarket.lastInferenceAt = now;
      active.trackedMarket.lastPolledAt = now;
      active.trackedMarket.snapshotCount += 1;
      active.trackedMarket.latestNormalizedState = normalizedState;
      active.trackedMarket.updatedAt = now;

      const sentryEvent: GuardWatchEvent = {
        eventId: `evt-${Date.now()}`,
        timestamp: now,
        type: "SENTRY_DECISION",
        summary: `Sentry [${sentryEvaluation.alertCategory}]: ${sentryEvaluation.summary}`,
        sentryDecision: sentryEvaluation.decision,
        requestId: sentryEvaluation.requestId,
      };
      active.trackedMarket.recentEvents = [
        sentryEvent,
        ...active.trackedMarket.recentEvents,
      ].slice(0, 15);

      const notification = await createIdempotentNotification({
        notificationId: `notif-${active.trackingId}-${snapshot.snapshotId}`,
        userId: active.userId,
        trackingId: active.trackingId,
        marketId: active.marketId,
        type: "SENTRY_ALERT",
        alertCategory: sentryEvaluation.alertCategory,
        title: `Sentry Alert [${sentryEvaluation.alertCategory}] • ${active.market.marketId}`,
        message: sentryEvaluation.summary,
        severity: sentryEvaluation.severity,
        requestId: sentryEvaluation.requestId,
        acknowledged: false,
        createdAt: now,
      });

      // Synchronize updated state to Firestore tracked_markets
      try {
        const db = getAdminDb();
        await db.collection(TRACKED_COLLECTION).doc(active.trackingId).set(
          {
            snapshotCount: active.trackedMarket.snapshotCount,
            sentryCallCount: active.trackedMarket.sentryCallCount,
            lastPolledAt: now,
            lastInferenceAt: now,
            latestNormalizedState: normalizedState,
            recentEvents: active.trackedMarket.recentEvents,
            updatedAt: now,
          },
          { merge: true }
        );
      } catch (syncErr) {
        logger.warn("Could not sync tracked market state to Firestore", { error: syncErr });
      }

      logger.info(
        `[SENTRY] Evaluated | alertCategory=${sentryEvaluation.alertCategory} | side=${active.activeSide} | decision=${sentryEvaluation.decision}`
      );

      return {
        trackedMarket: active.trackedMarket,
        comparison,
        sentryEvaluation,
        scoutingReport: null,
        notification,
      };
    } catch (err) {
      if (
        err instanceof InferenceProviderError &&
        (err.code === "INSUFFICIENT_CREDITS" || err.code === "INVALID_CREDENTIALS")
      ) {
        active.trackedMarket.status = "PAUSED_CREDITS";
      } else if (
        err instanceof InferenceProviderError &&
        err.code === "INFERENCE_BUDGET_EXCEEDED"
      ) {
        active.trackedMarket.status = "PAUSED_BUDGET";
      }
      return {
        trackedMarket: active.trackedMarket,
        comparison,
        sentryEvaluation: null,
        scoutingReport: null,
        notification: null,
      };
    }
  }

  /**
   * Grouping by distinct Sportmonks fixtureId:
   * Fetches each fixture ONCE per sweep cycle, then shares across positions on that fixture.
   */
  public async runSweep(options?: {
    bypassCooldown?: boolean;
  }): Promise<{
    inspectedCount: number;
    processedIds: string[];
    results: WatchTickResult[];
  }> {
    const activeRecords = this.getAll().filter(
      (r) => r.trackedMarket.status === "WATCHING"
    );
    const processedIds: string[] = [];
    const results: WatchTickResult[] = [];

    // Group active records by distinct fixtureId
    const fixtureGroupMap = new Map<number, ActiveWatchRecord[]>();
    for (const record of activeRecords) {
      const list = fixtureGroupMap.get(record.fixtureId) ?? [];
      list.push(record);
      fixtureGroupMap.set(record.fixtureId, list);
    }

    // Fetch each fixture ONCE
    for (const [fixtureId, records] of fixtureGroupMap.entries()) {
      let sharedMatchData: Record<string, unknown> | undefined;
      try {
        const smRes = await prepareMarketCricketData({
          fixtureId,
        });
        if (smRes.match) {
          sharedMatchData = smRes.match as unknown as Record<string, unknown>;
        }
      } catch (err) {
        logger.warn(`Failed to fetch shared fixture #${fixtureId} in sweep`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      for (const record of records) {
        try {
          const res = await this.runTickForRecord(record, {
            preFetchedMatchData: sharedMatchData,
            bypassCooldown: options?.bypassCooldown,
          });
          processedIds.push(record.trackingId);
          results.push(res);
        } catch (err) {
          logger.error("In-memory Guard Watch tick error for market", {
            trackingId: record.trackingId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    return {
      inspectedCount: activeRecords.length,
      processedIds,
      results,
    };
  }
}

export const guardWatchRegistry = new GuardWatchRegistry();
