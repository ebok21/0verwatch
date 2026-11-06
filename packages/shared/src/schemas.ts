import { z } from "zod";

export const PlatformIdSchema = z.literal("demo").default("demo");
export type PlatformId = z.infer<typeof PlatformIdSchema>;

export const MarketIdentifierSchema = z.object({
  platform: PlatformIdSchema.default("demo"),
  marketId: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  detectedVia: z.enum(["url", "dom"]).default("url"),
  sourceUrl: z.string().optional(),
});
export type MarketIdentifier = z.infer<typeof MarketIdentifierSchema>;

export const MatchFormatSchema = z.enum([
  "ODI",
  "T20",
  "T20I",
  "TEST",
  "LIST_A",
  "OTHER",
]);
export type MatchFormat = z.infer<typeof MatchFormatSchema>;

export const CricketMarketTypeSchema = z.enum([
  "OVER_RUNS",
  "MATCH_WINNER",
  "INNINGS_TOTAL",
  "INNINGS_RUNS",
  "PLAYER_RUNS",
  "PLAYER_WICKETS",
  "PLAYER_PERFORMANCE",
  "PHASE_RUNS",
  "WICKETS",
  "CUSTOM_CRICKET",
]);
export type CricketMarketType = z.infer<typeof CricketMarketTypeSchema>;

export const VerifiedFixtureMetaSchema = z.preprocess(
  (raw: unknown) => {
    if (!raw || typeof raw !== "object") return {};
    const obj = raw as Record<string, unknown>;
    const startingAt =
      typeof obj.startingAt === "string" && obj.startingAt.trim()
        ? obj.startingAt.trim()
        : typeof obj.scheduledStartTime === "string" && obj.scheduledStartTime.trim()
        ? obj.scheduledStartTime.trim()
        : new Date().toISOString();
    const format =
      typeof obj.format === "string" && obj.format.trim()
        ? obj.format.trim()
        : typeof obj.matchFormat === "string" && obj.matchFormat.trim()
        ? obj.matchFormat.trim()
        : "ODI";
    return {
      ...obj,
      startingAt,
      format,
    };
  },
  z.object({
    fixtureId: z.number().int().positive(),
    homeTeam: z.string().min(1),
    awayTeam: z.string().min(1),
    startingAt: z.string().min(1),
    scheduledStartTime: z.string().optional(),
    matchDate: z.string().optional(),
    format: z.string().min(1),
    matchFormat: z.string().optional(),
    venue: z.string().min(1),
    status: z.string().min(1),
    competition: z.string().optional(),
    verifiedAt: z.string(),
  })
);
export type VerifiedFixtureMeta = z.infer<typeof VerifiedFixtureMetaSchema>;

export const MarketStatusSchema = z.enum([
  "OPEN",
  "LIVE",
  "CLOSED",
  "SETTLED",
  "VOID",
]);
export type MarketStatus = z.infer<typeof MarketStatusSchema>;

export const MarketMetadataSchema = z.object({
  marketId: z.string().min(2).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  platform: PlatformIdSchema.default("demo"),
  question: z.string().min(5),
  subtitle: z.string().optional(),
  category: z.literal("CRICKET").default("CRICKET"),
  competition: z.string().default("International Cricket Series"),
  homeTeam: z.string().min(1).default("New Zealand"),
  awayTeam: z.string().min(1).default("India"),
  matchDate: z.string().default("2026-11-07"),
  scheduledStartTime: z.string().default("2026-11-07T02:00:00Z"),
  matchFormat: MatchFormatSchema.default("ODI"),
  fixtureId: z.number().int().positive(),
  seriesReferenceFixtureId: z.number().int().positive().optional(),
  sportmonksIncludes: z.array(z.string()).optional(),
  marketType: CricketMarketTypeSchema.default("OVER_RUNS"),
  resolutionCriteria: z
    .string()
    .default("Settled strictly from official Sportmonks Cricket API v2.0 fixture data."),
  openingTime: z.string().default("2026-11-06T00:00:00Z"),
  expectedResolutionTime: z.string().default("2026-11-07T05:30:00Z"),
  closingTime: z.string().default("2026-11-07T05:30:00Z"),
  minimumResolutionHorizonMinutes: z.number().int().min(10).default(10),
  targetEventWindow: z.string().optional(),
  status: MarketStatusSchema.default("OPEN"),
  resolutionContext: z
    .object({
      matchTitle: z.string().optional(),
      venue: z.string().optional(),
      scheduledStart: z.string().optional(),
      inningsNumber: z.number().int().optional(),
      battingTeam: z.string().optional(),
      bowlingTeam: z.string().optional(),
      targetPlayer: z.string().optional(),
      targetOvers: z.array(z.number().int()).optional(),
      runThreshold: z.number().optional(),
      wicketThreshold: z.number().optional(),
      scoreThreshold: z.number().optional(),
      includesAllExtras: z.boolean().optional(),
      extrasIncludedList: z.array(z.string()).optional(),
      voidConditions: z.array(z.string()).optional(),
      officialSource: z.string().optional(),
      description: z.string().optional(),
      rules: z.string().optional(),
    })
    .optional(),
  verifiedFixtureMeta: VerifiedFixtureMetaSchema.optional(),
  createdAt: z.string().default("2026-11-06T00:00:00Z"),
  updatedAt: z.string().default("2026-11-06T00:00:00Z"),
});
export type MarketMetadata = z.infer<typeof MarketMetadataSchema>;

/**
 * Validates that a market's expected resolution time is at least 10 minutes
 * after its opening time.
 */
export function validateMarketResolutionHorizon(params: {
  openingTime: string;
  expectedResolutionTime: string;
  minimumHorizonMinutes?: number;
}): { valid: boolean; horizonMinutes: number; reason?: string } {
  const minMinutes = Math.max(10, params.minimumHorizonMinutes ?? 10);
  const openMs = Date.parse(params.openingTime);
  const resolveMs = Date.parse(params.expectedResolutionTime);

  if (Number.isNaN(openMs) || Number.isNaN(resolveMs)) {
    return {
      valid: false,
      horizonMinutes: 0,
      reason: "Invalid ISO timestamp for openingTime or expectedResolutionTime.",
    };
  }

  const diffMinutes = (resolveMs - openMs) / (60 * 1000);
  if (diffMinutes < minMinutes) {
    return {
      valid: false,
      horizonMinutes: Math.round(diffMinutes * 10) / 10,
      reason: `Market resolution horizon (${Math.round(diffMinutes * 10) / 10}m) is shorter than the required ${minMinutes}-minute minimum.`,
    };
  }

  return {
    valid: true,
    horizonMinutes: Math.round(diffMinutes * 10) / 10,
  };
}

export const ToolOperationNameSchema = z.enum([
  "market.get_metadata",
  "cricket.get_fixture_data",
  "web.search",
  "web.fetch_page",
]);
export type ToolOperationName = z.infer<typeof ToolOperationNameSchema>;

export const EvidenceRecordSchema = z.object({
  evidenceId: z.string().regex(/^EV-\d{2,}$/),
  toolOperation: ToolOperationNameSchema,
  sourceUrlOrOrigin: z.string().min(1),
  retrievedAt: z.string(),
  title: z.string().optional(),
  summary: z.string().optional(),
  extractedData: z.unknown(),
});
export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;

export function normalizeClaimType(
  rawType: unknown,
  hasEvidence: boolean
): "EVIDENCE" | "HYPOTHETICAL_OBJECTION" {
  if (typeof rawType === "string") {
    const upper = rawType.toUpperCase().trim();
    if (upper === "NEGATIVE_EVIDENCE" || upper.includes("NEGATIVE_EVIDENCE")) {
      return hasEvidence ? "EVIDENCE" : "HYPOTHETICAL_OBJECTION";
    }
    if (
      upper === "HYPOTHETICAL_OBJECTION" ||
      upper === "OBJECTION" ||
      upper === "HYPOTHETICAL" ||
      upper === "CAUTION" ||
      upper === "RISK" ||
      upper === "COUNTER" ||
      upper === "NEGATIVE" ||
      upper.includes("OBJECTION") ||
      upper.includes("CAUTION") ||
      upper.includes("HYPOTHETICAL") ||
      upper.includes("COUNTER") ||
      upper.includes("NEGATIVE") ||
      upper.includes("RISK")
    ) {
      return "HYPOTHETICAL_OBJECTION";
    }
    if (
      upper === "EVIDENCE" ||
      upper === "SUPPORTING" ||
      upper === "FACT" ||
      upper === "OBSERVATION" ||
      upper === "EMPIRICAL" ||
      upper === "DATA" ||
      upper === "CONFIRMED" ||
      upper.includes("EVIDENCE")
    ) {
      return "EVIDENCE";
    }
  }
  return hasEvidence ? "EVIDENCE" : "HYPOTHETICAL_OBJECTION";
}

export function normalizeEvidenceIds(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter((x) => x.length > 0);
  }
  if (typeof raw === "string" && raw.trim().length > 0) {
    return [raw.trim()];
  }
  return [];
}

export function normalizeImpact(raw: unknown): "HIGH" | "MEDIUM" | "LOW" {
  if (typeof raw === "string") {
    const upper = raw.toUpperCase().trim();
    if (upper === "HIGH") return "HIGH";
    if (upper === "LOW") return "LOW";
    if (upper === "MEDIUM") return "MEDIUM";
  }
  return "MEDIUM";
}

export const ClaimSchema = z.preprocess(
  (val: unknown) => {
    if (!val || typeof val !== "object") {
      return {
        text:
          typeof val === "string" && val.trim().length > 0
            ? val.trim()
            : "Unspecified observation",
        evidenceIds: [],
        type: "HYPOTHETICAL_OBJECTION",
        impact: "MEDIUM",
      };
    }
    const obj = val as Record<string, unknown>;
    const evidenceIds = normalizeEvidenceIds(obj.evidenceIds);
    const text =
      typeof obj.text === "string" && obj.text.trim().length > 0
        ? obj.text.trim()
        : typeof obj.claim === "string" && obj.claim.trim().length > 0
        ? obj.claim.trim()
        : typeof obj.summary === "string" && obj.summary.trim().length > 0
        ? obj.summary.trim()
        : "Unspecified observation";

    return {
      id: typeof obj.id === "string" ? obj.id : undefined,
      text,
      evidenceIds,
      type: normalizeClaimType(obj.type, evidenceIds.length > 0),
      impact: normalizeImpact(obj.impact),
    };
  },
  z.object({
    id: z.string().optional(),
    text: z.string().min(1),
    evidenceIds: z.array(z.string()),
    type: z.enum(["EVIDENCE", "HYPOTHETICAL_OBJECTION"]),
    impact: z.enum(["HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
  })
);
export type Claim = z.infer<typeof ClaimSchema>;

export const SpecialistRoleSchema = z.enum(["DATA", "INTELLIGENCE"]);
export type SpecialistRole = z.infer<typeof SpecialistRoleSchema>;

export const SpecialistFindingSchema = z.object({
  specialist: SpecialistRoleSchema,
  summary: z.string(),
  claims: z.array(ClaimSchema),
  dataLimitations: z.array(z.string()).default([]),
  requestId: z.string(),
  provider: z.literal("zero-g").default("zero-g"),
  latencyMs: z.number().min(0).optional(),
});
export type SpecialistFinding = z.infer<typeof SpecialistFindingSchema>;

export const MonitoringPlanSchema = z.object({
  marketId: z.string(),
  pollIntervalSeconds: z.number().int().min(15).max(300).default(30),
  monitoredTools: z.array(ToolOperationNameSchema),
  watchedFields: z.array(z.string()),
  materialChangeCriteria: z.array(z.string()),
  escalationConditions: z.array(z.string()),
  cooldownSeconds: z.number().int().min(45).max(300).default(45),
  maxSentryEvaluations: z.number().int().min(1).max(6).default(3),
  maxScoutingRuns: z.number().int().min(1).max(2).default(2),
});
export type MonitoringPlan = z.infer<typeof MonitoringPlanSchema>;

export const ReconAssessmentSchema = z.enum(["YES", "NO", "INCONCLUSIVE"]);
export type ReconAssessment = z.infer<typeof ReconAssessmentSchema>;

export const DataFreshnessSchema = z.object({
  fixtureId: z.number().int(),
  fixtureStatus: z.string(),
  sportmonksRetrievedAt: z.string().nullable(),
  tavilyRetrievedAt: z.string().nullable(),
  freshnessSummary: z.string(),
});
export type DataFreshness = z.infer<typeof DataFreshnessSchema>;

export const ReconReportSchema = z.object({
  runId: z.string().min(1),
  marketId: z.string().min(1),
  fixtureId: z.number().int().positive(),
  platform: PlatformIdSchema.default("demo"),
  mode: z.enum(["RECON", "SCOUTING"]),
  assessment: ReconAssessmentSchema,
  yesProbability: z.number().min(0).max(100).nullable(),
  noProbability: z.number().min(0).max(100).nullable(),
  estimateLabel: z
    .string()
    .default("AI ESTIMATE — UNCALIBRATED"),
  headline: z.string().min(1),
  summary: z.string().min(1),
  keyFactors: z.array(ClaimSchema).default([]),
  risks: z.array(ClaimSchema).default([]),
  supportingClaims: z.array(ClaimSchema).default([]),
  uncertainties: z.array(z.string()).default([]),
  dataFreshness: DataFreshnessSchema,
  evidenceIds: z.array(z.string()),
  specialistFindings: z.array(SpecialistFindingSchema),
  evidenceMap: z.record(z.string(), EvidenceRecordSchema),
  monitoringPlan: MonitoringPlanSchema,
  requestIds: z.array(z.string()).default([]),
  provider: z.literal("zero-g").default("zero-g"),
  totalTokens: z.number().int().min(0).optional(),
  estimatedCostUsd: z.number().min(0).optional(),
  latencyMs: z.number().min(0).optional(),
  telemetry: z
    .object({
      totalTokens: z.number().optional(),
      totalCostUsd: z.number().optional(),
      durationMs: z.number().optional(),
      requestIds: z.array(z.string()).optional(),
      model: z.string().optional(),
      provider: z.string().optional(),
    })
    .optional(),
  createdAt: z.string(),
  scoutingTriggerSummary: z.string().optional(),
});
export type ReconReport = z.infer<typeof ReconReportSchema>;

export const PaperPositionSideSchema = z.enum(["YES", "NO"]);
export type PaperPositionSide = z.infer<typeof PaperPositionSideSchema>;

export const PaperPositionStatusSchema = z.enum([
  "OPEN",
  "CLOSED",
  "RESOLVED",
  "CANCELLED",
]);
export type PaperPositionStatus = z.infer<typeof PaperPositionStatusSchema>;

export const PaperPositionSchema = z.object({
  positionId: z.string().min(1),
  userId: z.string().min(1),
  marketId: z.string().min(1),
  fixtureId: z.number().int().positive(),
  question: z.string().optional(),
  side: PaperPositionSideSchema,
  stake: z.number().positive(),
  openedAt: z.string(),
  closedAt: z.string().nullable().default(null),
  status: PaperPositionStatusSchema.default("OPEN"),
  reconRunId: z.string().min(1),
  label: z
    .literal("PAPER POSITION — DEMO ONLY")
    .default("PAPER POSITION — DEMO ONLY"),
  idempotencyKey: z.string().optional(),
});
export type PaperPosition = z.infer<typeof PaperPositionSchema>;

export const DemoMarketPositionEventSchema = z.object({
  source: z.literal("OVERWATCH_DEMO_MARKET"),
  type: z.literal("OVERWATCH_POSITION_UPDATED"),
  payload: z.object({
    positionId: z.string().min(1),
    marketId: z.string().min(1),
    fixtureId: z.number().int().positive(),
    side: PaperPositionSideSchema,
    stake: z.number().positive(),
    status: PaperPositionStatusSchema,
    reconRunId: z.string().min(1),
    action: z.enum(["OPENED", "CLOSED", "CANCELLED"]),
  }),
});
export type DemoMarketPositionEvent = z.infer<
  typeof DemoMarketPositionEventSchema
>;

export const CandidateChangeSchema = z.object({
  fieldPath: z.string(),
  changeType: z.enum([
    "WICKET_FALL",
    "RUN_RATE_SHIFT",
    "TARGET_OVER_UPDATE",
    "LINEUP_CHANGE",
    "MATCH_STATUS_CHANGE",
    "NUMERIC_SHIFT",
    "NEW_EVENT_OR_DELIVERY",
    "STATUS_CHANGE",
    "MISSING_OR_STALE_DATA",
    "FIELD_MUTATION",
  ]),
  previousValue: z.unknown(),
  currentValue: z.unknown(),
  description: z.string(),
});
export type CandidateChange = z.infer<typeof CandidateChangeSchema>;

export const SnapshotComparisonResultSchema = z.object({
  hasMeaningfulChanges: z.boolean(),
  changes: z.array(CandidateChangeSchema),
  comparedAt: z.string(),
});
export type SnapshotComparisonResult = z.infer<
  typeof SnapshotComparisonResultSchema
>;

export const SentryDecisionTypeSchema = z.enum([
  "NO_ACTION",
  "NOTIFY_ONLY",
  "REQUEST_MORE_DATA",
  "TRIGGER_RESEARCH",
  "INSUFFICIENT_DATA",
]);
export type SentryDecisionType = z.infer<typeof SentryDecisionTypeSchema>;

export const SentryAlertCategorySchema = z.enum([
  "POSITION_THESIS_STRENGTHENED",
  "POSITION_THESIS_WEAKENED",
  "CRITICAL_DEVELOPMENT",
  "DATA_UNAVAILABLE",
  "INSUFFICIENT_DATA",
  "MONITORING_PAUSED",
]);
export type SentryAlertCategory = z.infer<typeof SentryAlertCategorySchema>;

export const SentryEvaluationSchema = z.object({
  decision: SentryDecisionTypeSchema,
  alertCategory: SentryAlertCategorySchema.default("CRITICAL_DEVELOPMENT"),
  positionSide: PaperPositionSideSchema.optional(),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  summary: z.string().min(1),
  reasoning: z.string().min(1),
  requestedTool: z
    .object({
      operation: ToolOperationNameSchema,
      arguments: z.record(z.unknown()),
    })
    .optional(),
  recommendedSpecialists: z.array(SpecialistRoleSchema).optional(),
  requestId: z.string(),
  provider: z.literal("zero-g").default("zero-g"),
  evaluatedAt: z.string(),
});
export type SentryEvaluation = z.infer<typeof SentryEvaluationSchema>;

export const SergeantScoutingDecisionSchema = z.object({
  shouldRunScouting: z.boolean(),
  reasoning: z.string(),
  specialistsToWake: z.array(SpecialistRoleSchema),
  updatedAlertMessage: z.string(),
  requestId: z.string(),
  provider: z.literal("zero-g").default("zero-g"),
});
export type SergeantScoutingDecision = z.infer<
  typeof SergeantScoutingDecisionSchema
>;

export const TrackedMarketStatusSchema = z.enum([
  "WATCHING",
  "EVALUATING_SENTRY",
  "SCOUTING",
  "PAUSED_CREDITS",
  "PAUSED_BUDGET",
  "PAUSED_USER",
  "LIMIT_REACHED",
  "STOPPED",
  "ERROR",
]);
export type TrackedMarketStatus = z.infer<typeof TrackedMarketStatusSchema>;

export const GuardWatchEventSchema = z.object({
  eventId: z.string(),
  timestamp: z.string(),
  type: z.enum([
    "TRACKING_STARTED",
    "SNAPSHOT_UNCHANGED",
    "DIFF_DETECTED",
    "SENTRY_DECISION",
    "SERGEANT_DECISION",
    "SCOUTING_COMPLETED",
    "COOLDOWN_SKIPPED",
    "CAP_REACHED",
    "CREDITS_EXHAUSTED",
    "ERROR",
  ]),
  summary: z.string(),
  sentryDecision: SentryDecisionTypeSchema.optional(),
  alertCategory: SentryAlertCategorySchema.optional(),
  requestId: z.string().optional(),
});
export type GuardWatchEvent = z.infer<typeof GuardWatchEventSchema>;

export const TrackedMarketSchema = z.object({
  trackingId: z.string(),
  userId: z.string(),
  marketId: z.string(),
  fixtureId: z.number().int().positive(),
  platform: PlatformIdSchema.default("demo"),
  question: z.string(),
  status: TrackedMarketStatusSchema,
  positionIds: z.array(z.string()).default([]),
  activeSide: PaperPositionSideSchema.optional(),
  totalStake: z.number().min(0).optional(),
  authorizedBackgroundInference: z.boolean(),
  monitoringPlan: MonitoringPlanSchema,
  latestReconRunId: z.string(),
  sentryCallCount: z.number().int().min(0).default(0),
  scoutingRunCount: z.number().int().min(0).default(0),
  snapshotCount: z.number().int().min(0).default(0),
  lastPolledAt: z.string().nullable().default(null),
  lastInferenceAt: z.string().nullable().default(null),
  latestMatchSummary: z.string().optional(),
  lastMeaningfulDevelopment: z.string().optional(),
  latestNormalizedState: z.record(z.unknown()).optional().nullable(),
  leaseOwner: z.string().nullable().default(null),
  leaseExpiresAt: z.number().nullable().default(null),
  recentEvents: z.array(GuardWatchEventSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TrackedMarket = z.infer<typeof TrackedMarketSchema>;

export const SnapshotRecordSchema = z.object({
  snapshotId: z.string(),
  trackingId: z.string(),
  marketId: z.string(),
  fixtureId: z.number().int().positive().optional(),
  capturedAt: z.string(),
  normalizedState: z.record(z.unknown()),
  evidenceIds: z.array(z.string()),
});
export type SnapshotRecord = z.infer<typeof SnapshotRecordSchema>;

export const NotificationRecordSchema = z.object({
  notificationId: z.string(),
  userId: z.string(),
  trackingId: z.string(),
  marketId: z.string(),
  positionId: z.string().optional(),
  type: z.enum(["SENTRY_ALERT", "SCOUTING_UPDATE", "CREDITS_PAUSED", "SYSTEM"]),
  alertCategory: SentryAlertCategorySchema.optional(),
  title: z.string(),
  message: z.string(),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  reconRunId: z.string().optional(),
  requestId: z.string().optional(),
  dedupeHash: z.string().optional(),
  acknowledged: z.boolean().default(false),
  createdAt: z.string(),
});
export type NotificationRecord = z.infer<typeof NotificationRecordSchema>;
