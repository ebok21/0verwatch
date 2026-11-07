import { z } from "zod";
import {
  Claim,
  ClaimSchema,
  EvidenceRecord,
  MarketMetadata,
  MonitoringPlan,
  MonitoringPlanSchema,
  ReconReport,
  ReconReportSchema,
  SpecialistFinding,
  SpecialistFindingSchema,
  ToolOperationName,
  formatISTDisplay,
  getISTDateString,
  toISTIsoString,
} from "@overwatch/shared";
import {
  EvidenceCollector,
  ToolExecutionOptions,
  ToolRegistry,
} from "../connectors/registry";
import {
  InferenceProvider,
  runCompletionWithToolLoop,
} from "../inference/provider";
import {
  DATA_SPECIALIST_SYSTEM_PROMPT,
  INTELLIGENCE_SPECIALIST_SYSTEM_PROMPT,
  SERGEANT_PLAN_SYSTEM_PROMPT,
  SERGEANT_SYNTHESIS_SYSTEM_PROMPT,
} from "./prompts";
import { getAdminDb } from "../firebase-admin";
import { getServerEnv } from "../env";
import { logger } from "../logger";
import {
  prepareMarketCricketData,
  fetchHistoricalCricketFixtures,
} from "../connectors/cricket-sportmonks";

function getOrchestratorModel(): string {
  try {
    return getServerEnv().ZERO_G_MODEL || "qwen3.5-35b-a3b";
  } catch {
    return "qwen3.5-35b-a3b";
  }
}

function getOrchestratorTimeoutMs(): number {
  try {
    return Number(getServerEnv().OG_INFERENCE_TIMEOUT_MS || "180000");
  } catch {
    return 180000;
  }
}

const SergeantPlanOutputSchema = z.preprocess(
  (raw: unknown) => {
    if (!raw || typeof raw !== "object") return {};
    const obj = raw as Record<string, unknown>;
    const dataTask = (obj.dataSpecialistTask && typeof obj.dataSpecialistTask === "object")
      ? (obj.dataSpecialistTask as Record<string, unknown>)
      : {};
    const intelTask = (obj.intelligenceSpecialistTask && typeof obj.intelligenceSpecialistTask === "object")
      ? (obj.intelligenceSpecialistTask as Record<string, unknown>)
      : {};

    return {
      researchObjective:
        typeof obj.researchObjective === "string" && obj.researchObjective.trim()
          ? obj.researchObjective.trim()
          : "Analyze prediction market",
      dataSpecialistTask: {
        objective:
          typeof dataTask.objective === "string" && dataTask.objective.trim()
            ? dataTask.objective.trim()
            : "Analyze structured match scorecard and statistics",
        allowedTools: Array.isArray(dataTask.allowedTools)
          ? dataTask.allowedTools.filter((t) => typeof t === "string")
          : ["market.get_metadata", "cricket.get_fixture_data"],
        maxToolCalls:
          typeof dataTask.maxToolCalls === "number"
            ? Math.max(1, Math.min(3, Math.round(dataTask.maxToolCalls)))
            : 2,
      },
      intelligenceSpecialistTask: {
        objective:
          typeof intelTask.objective === "string" && intelTask.objective.trim()
            ? intelTask.objective.trim()
            : "Investigate recent news and conditions",
        allowedTools: Array.isArray(intelTask.allowedTools)
          ? intelTask.allowedTools.filter((t) => typeof t === "string")
          : ["web.search", "web.fetch_page"],
        maxToolCalls:
          typeof intelTask.maxToolCalls === "number"
            ? Math.max(1, Math.min(3, Math.round(intelTask.maxToolCalls)))
            : 2,
      },
    };
  },
  z.object({
    researchObjective: z.string().default("Analyze prediction market"),
    dataSpecialistTask: z.object({
      objective: z.string().default("Analyze structured match scorecard and statistics"),
      allowedTools: z
        .array(z.string())
        .default(["market.get_metadata", "cricket.get_fixture_data"]),
      maxToolCalls: z.number().int().min(1).max(3).default(2),
    }),
    intelligenceSpecialistTask: z.object({
      objective: z.string().default("Investigate recent news and conditions"),
      allowedTools: z.array(z.string()).default(["web.search", "web.fetch_page"]),
      maxToolCalls: z.number().int().min(1).max(3).default(2),
    }),
  })
);

const SpecialistRawOutputSchema = z.preprocess(
  (raw: unknown) => {
    if (!raw || typeof raw !== "object") {
      return { summary: "Analysis completed.", claims: [], dataLimitations: [] };
    }
    const obj = raw as Record<string, unknown>;
    const summary =
      typeof obj.summary === "string" && obj.summary.trim()
        ? obj.summary.trim()
        : "Analysis completed.";
    const rawClaims = Array.isArray(obj.claims)
      ? obj.claims
      : Array.isArray(obj.keyFactors)
      ? obj.keyFactors
      : [];
    const claims = rawClaims
      .map((c) => {
        const res = ClaimSchema.safeParse(c);
        return res.success ? res.data : null;
      })
      .filter((c): c is Claim => c !== null);
    const dataLimitations = Array.isArray(obj.dataLimitations)
      ? obj.dataLimitations.map((x) => (typeof x === "string" ? x : JSON.stringify(x)))
      : typeof obj.dataLimitations === "string"
        ? [obj.dataLimitations]
        : [];
    return { summary, claims, dataLimitations };
  },
  z.object({
    summary: z.string().default("Analysis completed."),
    claims: z.array(ClaimSchema).default([]),
    dataLimitations: z.array(z.string()).default([]),
  })
);

const SergeantSynthesisRawSchema = z.preprocess(
  (raw: unknown) => {
    if (!raw || typeof raw !== "object") return {};
    const obj = { ...(raw as Record<string, unknown>) };

    // Normalize assessment
    if (typeof obj.assessment === "string") {
      const a = obj.assessment.toUpperCase().trim();
      if (a === "YES" || a === "NO" || a === "INCONCLUSIVE") {
        obj.assessment = a;
      } else if (a.includes("YES") || a.includes("LEAN_YES")) {
        obj.assessment = "YES";
      } else if (a.includes("NO") || a.includes("LEAN_NO")) {
        obj.assessment = "NO";
      } else {
        obj.assessment = "INCONCLUSIVE";
      }
    } else {
      obj.assessment = "INCONCLUSIVE";
    }

    // Normalize yesProbability (0-100)
    if (typeof obj.yesProbability === "number") {
      let p = obj.yesProbability;
      if (p <= 1 && p > 0) p = Math.round(p * 100);
      obj.yesProbability = Math.max(0, Math.min(100, Math.round(p)));
    } else if (typeof obj.probabilityYes === "number") {
      let p = obj.probabilityYes;
      if (p <= 1 && p > 0) p = Math.round(p * 100);
      obj.yesProbability = Math.max(0, Math.min(100, Math.round(p)));
    } else {
      obj.yesProbability = null;
    }

    if (obj.assessment === "INCONCLUSIVE") {
      obj.yesProbability = null;
    }

    if (typeof obj.headline !== "string" || !obj.headline.trim()) {
      obj.headline =
        typeof obj.summary === "string" && obj.summary.trim()
          ? obj.summary.slice(0, 100)
          : "Research Synthesis";
    }
    if (typeof obj.summary !== "string" || !obj.summary.trim()) {
      obj.summary = "Recon research synthesis completed.";
    }

    const rawKeyFactors = Array.isArray(obj.keyFactors)
      ? obj.keyFactors
      : Array.isArray(obj.supportingClaims)
      ? obj.supportingClaims
      : [];
    obj.keyFactors = rawKeyFactors
      .map((item) => {
        const res = ClaimSchema.safeParse(item);
        return res.success ? res.data : null;
      })
      .filter((c): c is Claim => c !== null);

    const rawRisks = Array.isArray(obj.risks)
      ? obj.risks
      : Array.isArray(obj.contrarianClaims)
      ? obj.contrarianClaims
      : [];
    obj.risks = rawRisks
      .map((item) => {
        const res = ClaimSchema.safeParse(item);
        return res.success ? res.data : null;
      })
      .filter((c): c is Claim => c !== null);

    if (!Array.isArray(obj.uncertainties)) {
      obj.uncertainties = typeof obj.uncertainties === "string" ? [obj.uncertainties] : [];
    } else {
      obj.uncertainties = obj.uncertainties.map((u) =>
        typeof u === "string" ? u : JSON.stringify(u)
      );
    }

    if (obj.monitoringPlan && typeof obj.monitoringPlan === "object") {
      obj.monitoringPlan = { ...(obj.monitoringPlan as Record<string, unknown>) };
    } else {
      delete obj.monitoringPlan;
    }

    return obj;
  },
  z.object({
    assessment: z.enum(["YES", "NO", "INCONCLUSIVE"]).default("INCONCLUSIVE"),
    yesProbability: z.number().min(0).max(100).nullable(),
    headline: z.string().default("Research Synthesis"),
    summary: z.string().default("Recon research completed."),
    keyFactors: z.array(ClaimSchema).default([]),
    risks: z.array(ClaimSchema).default([]),
    uncertainties: z.array(z.string()).default([]),
    monitoringPlan: z.record(z.unknown()).optional(),
  })
);

function extractJsonObject(raw: string | null): unknown {
  if (!raw) {
    throw new Error("Agent returned empty content when JSON was required.");
  }
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let candidate = fenced?.[1]?.trim() ?? trimmed;

  const startIdx = candidate.indexOf("{");
  const endIdx = candidate.lastIndexOf("}");
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    candidate = candidate.slice(startIdx, endIdx + 1);
  }

  try {
    return JSON.parse(candidate);
  } catch {
    // Attempt cleanup of trailing commas before closing braces/brackets
    const sanitized = candidate
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, (c) => (c === "\n" || c === "\r" || c === "\t" ? c : ""));
    return JSON.parse(sanitized);
  }
}

export function verifyAndSanitizeClaims(
  claims: Claim[],
  evidenceCollector: EvidenceCollector,
  allowHypotheticalDowngrade: boolean
): Claim[] {
  const verified: Claim[] = [];

  for (const claim of claims) {
    const validIds = claim.evidenceIds.filter((id) => evidenceCollector.has(id));

    if (claim.type === "EVIDENCE") {
      if (validIds.length > 0) {
        verified.push({
          ...claim,
          evidenceIds: validIds,
        });
      } else if (allowHypotheticalDowngrade) {
        verified.push({
          ...claim,
          evidenceIds: [],
          type: "HYPOTHETICAL_OBJECTION",
        });
      }
    } else {
      verified.push({
        ...claim,
        evidenceIds: validIds,
        type: "HYPOTHETICAL_OBJECTION",
      });
    }
  }

  return verified;
}

async function runDataSpecialist(params: {
  market: MarketMetadata;
  taskObjective: string;
  provider: InferenceProvider;
  toolRegistry: ToolRegistry;
  evidenceCollector: EvidenceCollector;
  liveMatchStatusSummary: string;
}): Promise<{
  finding: SpecialistFinding;
  tokens: number;
  costUsd: number;
}> {
  const startTime = Date.now();
  const nowIST = formatISTDisplay(new Date());
  const scheduledStartIST = formatISTDisplay(params.market.scheduledStartTime);
  const loopResult = await runCompletionWithToolLoop({
    provider: params.provider,
    toolRegistry: params.toolRegistry,
    allowedTools: ["market.get_metadata", "cricket.get_fixture_data"],
    maxToolRoundtrips: 2,
    maxToolCallsTotal: 2,
    initialRequest: {
      model: getOrchestratorModel(),
      agentRole: "DATA_SPECIALIST",
      systemInstruction: DATA_SPECIALIST_SYSTEM_PROMPT,
      temperature: 0.1,
      maxTokens: 1200,
      timeoutMs: getOrchestratorTimeoutMs(),
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            task: params.taskObjective,
            currentSystemTimeIST: nowIST,
            scheduledStartTimeIST: scheduledStartIST,
            officialLiveMatchStatus: params.liveMatchStatusSummary,
            marketId: params.market.marketId,
            fixtureId: params.market.fixtureId,
            question: params.market.question,
            resolutionContext: params.market.resolutionContext,
            availablePreFetchedEvidence: params.evidenceCollector.values().map((ev) => ({
              evidenceId: ev.evidenceId,
              toolOperation: ev.toolOperation,
              title: ev.title,
              summary: ev.summary,
              data: ev.extractedData,
            })),
          }),
        },
      ],
    },
  });

  let parsedRaw: z.infer<typeof SpecialistRawOutputSchema>;
  try {
    const rawJson = extractJsonObject(loopResult.finalResponse.content);
    parsedRaw = SpecialistRawOutputSchema.parse(rawJson);
  } catch (err) {
    logger.warn(`[AGENT] Data Specialist parsing fallback triggered`, {
      contentPreview: loopResult.finalResponse.content?.slice(0, 150),
      error: err instanceof Error ? err.message : String(err),
    });
    parsedRaw = SpecialistRawOutputSchema.parse({
      summary:
        loopResult.finalResponse.content?.slice(0, 400) ||
        "Data specialist match scorecard analysis completed.",
      claims: [],
      dataLimitations: [],
    });
  }
  const verifiedClaims = verifyAndSanitizeClaims(
    parsedRaw.claims,
    params.evidenceCollector,
    false
  );

  const tokens = loopResult.allResponses.reduce(
    (sum, r) => sum + (r.usage?.totalTokens ?? 0),
    0
  );
  const costUsd = loopResult.allResponses.reduce(
    (sum, r) => sum + (r.usage?.estimatedCostUsd ?? 0),
    0
  );

  const finding = SpecialistFindingSchema.parse({
    specialist: "DATA",
    summary: parsedRaw.summary,
    claims: verifiedClaims,
    dataLimitations: parsedRaw.dataLimitations,
    requestId: loopResult.finalResponse.requestId,
    provider: "zero-g",
    latencyMs: Date.now() - startTime,
  });

  return { finding, tokens, costUsd };
}

async function runIntelligenceSpecialist(params: {
  market: MarketMetadata;
  taskObjective: string;
  provider: InferenceProvider;
  toolRegistry: ToolRegistry;
  evidenceCollector: EvidenceCollector;
  liveMatchStatusSummary: string;
}): Promise<{
  finding: SpecialistFinding;
  tokens: number;
  costUsd: number;
}> {
  const startTime = Date.now();
  const nowIST = formatISTDisplay(new Date());
  const todayIST = getISTDateString(new Date());
  const scheduledStartIST = formatISTDisplay(params.market.scheduledStartTime);
  const loopResult = await runCompletionWithToolLoop({
    provider: params.provider,
    toolRegistry: params.toolRegistry,
    allowedTools: ["web.search", "web.fetch_page"],
    maxToolRoundtrips: 2,
    maxToolCallsTotal: 2,
    initialRequest: {
      model: getOrchestratorModel(),
      agentRole: "INTELLIGENCE_SPECIALIST",
      systemInstruction: INTELLIGENCE_SPECIALIST_SYSTEM_PROMPT,
      temperature: 0.15,
      maxTokens: 1200,
      timeoutMs: getOrchestratorTimeoutMs(),
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            task: params.taskObjective,
            currentSystemTimeIST: nowIST,
            currentDateIST: todayIST,
            scheduledStartTimeIST: scheduledStartIST,
            officialLiveMatchStatus: params.liveMatchStatusSummary,
            marketId: params.market.marketId,
            question: params.market.question,
            matchTitle: params.market.resolutionContext?.matchTitle ?? `${params.market.homeTeam} vs ${params.market.awayTeam} ${params.market.matchFormat}`,
            competition: params.market.competition,
            homeTeam: params.market.homeTeam,
            awayTeam: params.market.awayTeam,
            matchDateIST: getISTDateString(params.market.scheduledStartTime || params.market.matchDate),
            matchFormat: params.market.matchFormat,
            venue: params.market.verifiedFixtureMeta?.venue ?? params.market.resolutionContext?.venue ?? "N/A",
            criticalInstruction: `REAL-TIME IST CLOCK: Today is ${todayIST} (${nowIST}). Scheduled start time is ${scheduledStartIST}. Official Sportmonks live status is "${params.liveMatchStatusSummary}". If officialLiveMatchStatus shows an innings or live score, or if currentSystemTimeIST is past scheduledStartTimeIST, THIS MATCH IS LIVE AND UNDERWAY RIGHT NOW — NEVER state that the match is in the future or has not been played yet, even if web search returns pre-match preview articles written yesterday! All time references must be in IST (never UTC or GMT). Target match is ${params.market.resolutionContext?.matchTitle ?? params.market.matchFormat} on ${params.market.matchDate} at ${params.market.verifiedFixtureMeta?.venue ?? params.market.resolutionContext?.venue ?? 'scheduled venue'}. Do NOT confuse this match with previous matches in this series.`,
          }),
        },
      ],
    },
  });

  let parsedRaw: z.infer<typeof SpecialistRawOutputSchema>;
  try {
    const rawJson = extractJsonObject(loopResult.finalResponse.content);
    parsedRaw = SpecialistRawOutputSchema.parse(rawJson);
  } catch (err) {
    logger.warn(`[AGENT] Data Specialist parsing fallback triggered`, {
      contentPreview: loopResult.finalResponse.content?.slice(0, 150),
      error: err instanceof Error ? err.message : String(err),
    });
    parsedRaw = SpecialistRawOutputSchema.parse({
      summary:
        loopResult.finalResponse.content?.slice(0, 400) ||
        "Data specialist match scorecard analysis completed.",
      claims: [],
      dataLimitations: [],
    });
  }
  const verifiedClaims = verifyAndSanitizeClaims(
    parsedRaw.claims,
    params.evidenceCollector,
    false
  );

  const tokens = loopResult.allResponses.reduce(
    (sum, r) => sum + (r.usage?.totalTokens ?? 0),
    0
  );
  const costUsd = loopResult.allResponses.reduce(
    (sum, r) => sum + (r.usage?.estimatedCostUsd ?? 0),
    0
  );

  const finding = SpecialistFindingSchema.parse({
    specialist: "INTELLIGENCE",
    summary: parsedRaw.summary,
    claims: verifiedClaims,
    dataLimitations: parsedRaw.dataLimitations,
    requestId: loopResult.finalResponse.requestId,
    provider: "zero-g",
    latencyMs: Date.now() - startTime,
  });

  return { finding, tokens, costUsd };
}

// In-memory cache for recent recon runs
const inMemoryReconReports = new Map<string, ReconReport>();
const inFlightRecons = new Map<string, Promise<ReconReport>>();

export function clearAllReconData(): void {
  inMemoryReconReports.clear();
  inFlightRecons.clear();
}

export async function storeReconReportInMemoryAndDb(
  report: ReconReport
): Promise<void> {
  inMemoryReconReports.set(report.marketId, report);
  try {
    const db = getAdminDb();
    const runRef = db.collection("recon_runs").doc(report.runId);
    await runRef.set(report);
    if (report.evidenceMap) {
      const evCol = runRef.collection("evidence");
      for (const ev of Object.values(report.evidenceMap)) {
        await evCol.doc(ev.evidenceId).set(ev);
      }
    }
  } catch (err) {
    logger.warn("Could not persist simulated recon_run to Firestore", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Executes the full Overwatch Cricket Recon workflow:
 * 1. Deterministic Sportmonks fixture pre-fetch
 * 2. Sergeant Planning
 * 3. Parallel execution of Data & Intelligence Specialists (via Promise.allSettled)
 * 4. Sergeant Synthesis & Evidence ID verification
 * 5. Returns validated ReconReport adhering to ReconReportSchema
 */
export async function executeReconWorkflow(params: {
  market: MarketMetadata;
  provider: InferenceProvider;
  toolOptions?: ToolExecutionOptions;
  persistToFirestore?: boolean;
}): Promise<ReconReport> {
  const marketId = params.market.marketId;

  // Deduplicate concurrent in-flight Recon requests for the same market
  const existingInFlight = inFlightRecons.get(marketId);
  if (existingInFlight) {
    logger.info(`[RECON] Joining in-flight Recon workflow for market=${marketId}`);
    return existingInFlight;
  }

  const reconPromise = (async () => {
    const workflowStart = Date.now();
    const runId = `recon-${marketId}-${Date.now()}`;
    logger.info(`[RECON] Started | market=${marketId} | runId=${runId}`);

    const evidenceCollector = new EvidenceCollector();
    const toolRegistry = new ToolRegistry(evidenceCollector, {
      ...params.toolOptions,
      activeMarket: params.market,
    });

    const requestIds: string[] = [];
    let totalTokens = 0;
    let totalCostUsd = 0;

    // 1. Deterministic Sportmonks fixture pre-fetch
    const fixtureData = await prepareMarketCricketData({
      fixtureId: params.market.fixtureId,
      marketType: params.market.marketType,
    });

    let liveMatchStatusSummary = `Scheduled Start: ${formatISTDisplay(params.market.scheduledStartTime)} (Status: ${params.market.verifiedFixtureMeta?.status ?? "NS"})`;
    if (fixtureData.match) {
      const firstInnings = fixtureData.match.innings[0];
      const summaryText = firstInnings
        ? `${fixtureData.match.localTeam.name} vs ${fixtureData.match.visitorTeam.name} (${fixtureData.match.status}): ${firstInnings.totalRuns}/${firstInnings.wickets} in ${firstInnings.oversBowled} ov`
        : `${fixtureData.match.localTeam.name} vs ${fixtureData.match.visitorTeam.name} (${fixtureData.match.status})`;
      liveMatchStatusSummary = summaryText;

      evidenceCollector.addRecord({
        toolOperation: "cricket.get_fixture_data",
        sourceUrlOrOrigin: fixtureData.sourceUrlOrOrigin,
        title: `Sportmonks Fixture #${params.market.fixtureId} (${fixtureData.match.localTeam.code} vs ${fixtureData.match.visitorTeam.code})`,
        summary: summaryText,
        extractedData: fixtureData.match,
      });
      logger.info(`[SPORTMONKS] Fixture data pre-fetched | fixtureId=${params.market.fixtureId}`);
    }

    // 1b. Fetch historical completed fixtures in the series for empirical comparisons
    try {
      const historicalFixtures = await fetchHistoricalCricketFixtures({
        currentFixtureId: params.market.fixtureId,
        targetOver: 15,
        limit: 2,
      });

      for (const hist of historicalFixtures) {
        const innSummary = hist.innings
          .map((inn) => `${inn.teamName}: ${inn.score}/${inn.wickets} (${inn.overs} ov)`)
          .join(" vs ");
        const summaryText = `${hist.title} [${hist.status}]. Result: ${hist.resultNote || "N/A"}. Scorecards: ${innSummary}.${
          hist.targetOverSummary ? ` ${hist.targetOverSummary}` : ""
        }`;

        evidenceCollector.addRecord({
          toolOperation: "cricket.get_fixture_data",
          sourceUrlOrOrigin: hist.sourceUrlOrOrigin,
          title: `Historical Sportmonks Fixture #${hist.fixtureId} (${hist.title})`,
          summary: summaryText,
          extractedData: hist,
        });
      }
    } catch (histErr) {
      logger.warn("[SPORTMONKS] Historical fixture pre-fetch warning", {
        error: histErr instanceof Error ? histErr.message : String(histErr),
      });
    }

    const nowISTDisplay = formatISTDisplay(new Date());
    const scheduledStartISTDisplay = formatISTDisplay(params.market.scheduledStartTime);

    // 2. Sergeant Planning
    const planRes = await params.provider.complete({
      model: getOrchestratorModel(),
      agentRole: "SERGEANT_PLAN",
      systemInstruction: SERGEANT_PLAN_SYSTEM_PROMPT,
      temperature: 0.1,
      maxTokens: 600,
      timeoutMs: getOrchestratorTimeoutMs(),
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            currentSystemTimeIST: nowISTDisplay,
            scheduledStartTimeIST: scheduledStartISTDisplay,
            officialLiveMatchStatus: liveMatchStatusSummary,
            marketId: params.market.marketId,
            fixtureId: params.market.fixtureId,
            question: params.market.question,
            homeTeam: params.market.homeTeam,
            awayTeam: params.market.awayTeam,
            matchFormat: params.market.matchFormat,
            resolutionCriteria: params.market.resolutionCriteria,
          }),
        },
      ],
    });
    requestIds.push(planRes.requestId);
    totalTokens += planRes.usage?.totalTokens ?? 0;
    totalCostUsd += planRes.usage?.estimatedCostUsd ?? 0;

    let planJson: unknown;
    try {
      planJson = extractJsonObject(planRes.content);
    } catch {
      planJson = {};
    }
    const plan = SergeantPlanOutputSchema.parse(planJson);

    // 3. Parallel execution of Data & Intelligence Specialists
    logger.info("[AGENT] Data Specialist started");
    logger.info("[AGENT] Intelligence Specialist started");

    const [dataSettled, intelSettled] = await Promise.allSettled([
      runDataSpecialist({
        market: params.market,
        taskObjective: plan.dataSpecialistTask.objective,
        provider: params.provider,
        toolRegistry,
        evidenceCollector,
        liveMatchStatusSummary,
      }),
      runIntelligenceSpecialist({
        market: params.market,
        taskObjective: plan.intelligenceSpecialistTask.objective,
        provider: params.provider,
        toolRegistry,
        evidenceCollector,
        liveMatchStatusSummary,
      }),
    ]);

    let dataFinding: SpecialistFinding;
    let intelFinding: SpecialistFinding;

    if (dataSettled.status === "fulfilled") {
      dataFinding = dataSettled.value.finding;
      requestIds.push(dataFinding.requestId);
      totalTokens += dataSettled.value.tokens;
      totalCostUsd += dataSettled.value.costUsd;
      logger.info(
        `[AGENT] Data Specialist completed | duration=${dataFinding.latencyMs ?? 0}ms`
      );
    } else {
      const errMsg =
        dataSettled.reason instanceof Error
          ? dataSettled.reason.message
          : String(dataSettled.reason);
      logger.error("[AGENT] Data Specialist failed", { error: errMsg });
      dataFinding = SpecialistFindingSchema.parse({
        specialist: "DATA",
        summary: "Data specialist execution failed or unavailable.",
        claims: [],
        dataLimitations: [`Data analysis unavailable: ${errMsg}`],
        requestId: `data-failed-${Date.now()}`,
        provider: "zero-g",
        latencyMs: 0,
      });
      requestIds.push(dataFinding.requestId);
    }

    if (intelSettled.status === "fulfilled") {
      intelFinding = intelSettled.value.finding;
      requestIds.push(intelFinding.requestId);
      totalTokens += intelSettled.value.tokens;
      totalCostUsd += intelSettled.value.costUsd;
      logger.info(
        `[AGENT] Intelligence Specialist completed | duration=${intelFinding.latencyMs ?? 0}ms`
      );
    } else {
      const errMsg =
        intelSettled.reason instanceof Error
          ? intelSettled.reason.message
          : String(intelSettled.reason);
      logger.error("[AGENT] Intelligence Specialist failed", { error: errMsg });
      intelFinding = SpecialistFindingSchema.parse({
        specialist: "INTELLIGENCE",
        summary: "Intelligence specialist execution failed or unavailable.",
        claims: [],
        dataLimitations: [`Intelligence research unavailable: ${errMsg}`],
        requestId: `intel-failed-${Date.now()}`,
        provider: "zero-g",
        latencyMs: 0,
      });
      requestIds.push(intelFinding.requestId);
    }

    // 4. Sergeant Synthesis
    logger.info("[RECON] Sergeant synthesis started");
    const validEvidenceIds = evidenceCollector.values().map((e) => e.evidenceId);

    const synthesisRes = await params.provider.complete({
      model: getOrchestratorModel(),
      agentRole: "SERGEANT_SYNTHESIS",
      systemInstruction: SERGEANT_SYNTHESIS_SYSTEM_PROMPT,
      temperature: 0.15,
      maxTokens: 1500,
      timeoutMs: getOrchestratorTimeoutMs(),
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            currentSystemTimeIST: formatISTDisplay(new Date()),
            scheduledStartTimeIST: scheduledStartISTDisplay,
            officialSportmonksLiveState: liveMatchStatusSummary,
            marketId: params.market.marketId,
            fixtureId: params.market.fixtureId,
            question: params.market.question,
            resolutionCriteria: params.market.resolutionCriteria,
            validEvidenceIds,
            specialistFindings: [dataFinding, intelFinding],
          }),
        },
      ],
    });

    requestIds.push(synthesisRes.requestId);
    totalTokens += synthesisRes.usage?.totalTokens ?? 0;
    totalCostUsd += synthesisRes.usage?.estimatedCostUsd ?? 0;

    let rawSynthesisObj: unknown;
    try {
      rawSynthesisObj = extractJsonObject(synthesisRes.content);
    } catch {
      rawSynthesisObj = {
        headline: "Match Synthesis",
        summary:
          synthesisRes.content?.slice(0, 500) ||
          "Cricket match recon research synthesis completed.",
        assessment: "INCONCLUSIVE",
        keyFactors: [],
        risks: [],
        uncertainties: [],
      };
    }

    const synthesisParsed = SergeantSynthesisRawSchema.safeParse(rawSynthesisObj);
    const rawSynthesis = synthesisParsed.success
      ? synthesisParsed.data
      : {
          headline: "Match Synthesis",
          summary:
            typeof (rawSynthesisObj as any)?.summary === "string"
              ? (rawSynthesisObj as any).summary
              : synthesisRes.content?.slice(0, 500) ||
                "Cricket match recon research synthesis completed.",
          assessment: "INCONCLUSIVE" as const,
          yesProbability: null,
          keyFactors: [],
          risks: [],
          uncertainties: [],
          monitoringPlan: undefined,
        };

    const verifiedKeyFactors = verifyAndSanitizeClaims(
      rawSynthesis.keyFactors,
      evidenceCollector,
      false
    );
    const verifiedRisks = verifyAndSanitizeClaims(
      rawSynthesis.risks,
      evidenceCollector,
      true
    );

    const assessment = rawSynthesis.assessment;
    const yesProbability =
      assessment === "INCONCLUSIVE" ? null : rawSynthesis.yesProbability;
    const noProbability =
      yesProbability !== null ? Math.max(0, 100 - yesProbability) : null;

    const mpRaw = (rawSynthesis.monitoringPlan as Record<string, any>) ?? {};
    const pollSec = typeof mpRaw.pollIntervalSeconds === "number" ? mpRaw.pollIntervalSeconds : 30;
    const coolSec = typeof mpRaw.cooldownSeconds === "number" ? mpRaw.cooldownSeconds : 60;

    const monitoringPlan: MonitoringPlan = MonitoringPlanSchema.parse({
      marketId: params.market.marketId,
      pollIntervalSeconds: Math.max(15, Math.min(300, pollSec)),
      monitoredTools: ["market.get_metadata", "cricket.get_fixture_data"],
      watchedFields: ["status", "innings", "runs"],
      materialChangeCriteria: Array.isArray(mpRaw.materialChangeCriteria)
        ? mpRaw.materialChangeCriteria
        : ["Meaningful score or state change"],
      escalationConditions: Array.isArray(mpRaw.escalationConditions)
        ? mpRaw.escalationConditions
        : ["Wicket falls or run-rate surge"],
      cooldownSeconds: Math.max(45, Math.min(300, coolSec)),
      maxSentryEvaluations: 3,
      maxScoutingRuns: 2,
    });

    let report: ReconReport;
    const reportCandidate = {
      runId,
      marketId: params.market.marketId,
      fixtureId: params.market.fixtureId,
      platform: "demo" as const,
      mode: "RECON" as const,
      assessment,
      yesProbability,
      noProbability,
      estimateLabel: "AI ESTIMATE — UNCALIBRATED",
      headline: rawSynthesis.headline,
      summary: rawSynthesis.summary,
      keyFactors: verifiedKeyFactors,
      risks: verifiedRisks,
      supportingClaims: verifiedKeyFactors,
      uncertainties: rawSynthesis.uncertainties,
      dataFreshness: {
        fixtureId: params.market.fixtureId,
        fixtureStatus: fixtureData.match?.status ?? "NS",
        sportmonksRetrievedAt: fixtureData.retrievedAt ? toISTIsoString(fixtureData.retrievedAt) : null,
        tavilyRetrievedAt: toISTIsoString(new Date()),
        freshnessSummary: `Sportmonks status: ${
          fixtureData.match?.status ?? "NS"
        } (${fixtureData.freshness} • ${formatISTDisplay(new Date())}). Tavily external intelligence fresh.`,
      },
      evidenceIds: validEvidenceIds,
      specialistFindings: [dataFinding, intelFinding],
      evidenceMap: evidenceCollector.toMap(),
      monitoringPlan,
      requestIds,
      provider: "zero-g" as const,
      totalTokens,
      estimatedCostUsd: Number(totalCostUsd.toFixed(6)),
      latencyMs: Date.now() - workflowStart,
      telemetry: {
        totalTokens,
        totalCostUsd: Number(totalCostUsd.toFixed(6)),
        durationMs: Date.now() - workflowStart,
        requestIds,
        model: getOrchestratorModel(),
        provider: "zero-g",
      },
      createdAt: toISTIsoString(new Date()),
    };

    const parseResult = ReconReportSchema.safeParse(reportCandidate);
    if (parseResult.success) {
      report = parseResult.data;
    } else {
      logger.error(
        "[RECON] ReconReportSchema validation issues detected, using sanitized fallback",
        { issues: parseResult.error.issues }
      );
      report = {
        ...reportCandidate,
        keyFactors: verifiedKeyFactors.length > 0 ? verifiedKeyFactors : [],
        risks: verifiedRisks.length > 0 ? verifiedRisks : [],
        supportingClaims: verifiedKeyFactors.length > 0 ? verifiedKeyFactors : [],
        uncertainties: Array.isArray(rawSynthesis.uncertainties)
          ? rawSynthesis.uncertainties
          : [],
      } as ReconReport;
    }

    inMemoryReconReports.set(marketId, report);
    logger.info(
      `[RECON] Completed | market=${marketId} | assessment=${assessment} | yesProbability=${yesProbability}% | duration=${report.telemetry?.durationMs ?? 0}ms`
    );

    // Persist report & evidence to Firestore
    if (params.persistToFirestore !== false) {
      try {
        const db = getAdminDb();
        const runRef = db.collection("recon_runs").doc(runId);
        await runRef.set(report);

        const evidenceCollection = runRef.collection("evidence");
        for (const ev of evidenceCollector.values()) {
          await evidenceCollection.doc(ev.evidenceId).set(ev);
        }
      } catch (err) {
        logger.warn(`Could not persist recon_run to Firestore (non-fatal)`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return report;
  })();

  inFlightRecons.set(marketId, reconPromise);
  try {
    return await reconPromise;
  } finally {
    inFlightRecons.delete(marketId);
  }
}

export async function getLatestReconReportForMarket(
  marketId: string
): Promise<ReconReport | null> {
  const cached = inMemoryReconReports.get(marketId);
  if (cached) return cached;

  try {
    const db = getAdminDb();
    const snap = await db
      .collection("recon_runs")
      .where("marketId", "==", marketId)
      .get();

    if (!snap.empty) {
      const parsedReports = snap.docs
        .map((d) => {
          const res = ReconReportSchema.safeParse(d.data());
          return res.success ? res.data : null;
        })
        .filter((r): r is ReconReport => r !== null)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      if (parsedReports[0]) {
        inMemoryReconReports.set(marketId, parsedReports[0]);
        return parsedReports[0];
      }
    }
  } catch {
    // Non-fatal
  }

  return null;
}
