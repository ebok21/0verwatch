import { NextRequest } from "next/server";
import { z } from "zod";
import {
  createPaperPosition,
  listPaperPositions,
} from "@/lib/positions/store";
import { getCanonicalMarketMetadata } from "@/lib/markets/store";
import {
  executeReconWorkflow,
  getLatestReconReportForMarket,
} from "@/lib/agents/orchestrator";
import { createOrUpdateTrackedMarket, guardWatchRegistry } from "@/lib/watch/engine";
import { ensureInProcessWatcherStarted } from "@/lib/watch/in-process-watcher";
import { resolveInferenceProvider } from "@/lib/inference";
import {
  getUserDecryptedZeroGKeys,
  resolveRequestOrDevUser,
} from "@/lib/auth/session";
import { errorResponse, jsonResponse, optionsResponse } from "@/lib/http";
import { logger } from "@/lib/logger";
import { PaperPositionSideSchema } from "@overwatch/shared";

const CreatePositionBodySchema = z.object({
  marketId: z.string().min(1),
  side: PaperPositionSideSchema,
  stake: z.number().positive().max(10000),
  reconRunId: z.string().optional(),
  idempotencyKey: z.string().optional(),
});

export async function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: NextRequest) {
  try {
    const user = await resolveRequestOrDevUser(req);
    const { searchParams } = new URL(req.url);
    const marketId = searchParams.get("marketId") ?? undefined;
    const status = (searchParams.get("status") as any) ?? undefined;

    const positions = await listPaperPositions({
      userId: user.userId,
      marketId,
      status,
    });

    return jsonResponse({
      positions,
      userId: user.userId,
      count: positions.length,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await resolveRequestOrDevUser(req);
    const body = CreatePositionBodySchema.parse(await req.json());

    const position = await createPaperPosition({
      userId: user.userId,
      marketId: body.marketId,
      side: body.side,
      stake: body.stake,
      reconRunId: body.reconRunId,
      idempotencyKey: body.idempotencyKey,
    });

    // Automatically synchronize Guard Watch tracking for this position thesis
    try {
      const market = await getCanonicalMarketMetadata(body.marketId);
      if (market) {
        let latestReport = await getLatestReconReportForMarket(market.marketId);
        if (!latestReport) {
          latestReport = {
            runId: `recon-${market.marketId}-baseline`,
            marketId: market.marketId,
            fixtureId: market.fixtureId,
            platform: "demo",
            mode: "RECON",
            assessment: "INCONCLUSIVE",
            yesProbability: null,
            noProbability: null,
            estimateLabel: "AI ESTIMATE — UNCALIBRATED",
            headline: `${market.homeTeam} vs ${market.awayTeam}`,
            summary: "Paper position registered. Guard Watch monitoring active.",
            keyFactors: [],
            risks: [],
            supportingClaims: [],
            uncertainties: [],
            dataFreshness: {
              fixtureId: market.fixtureId,
              fixtureStatus: "NS",
              sportmonksRetrievedAt: null,
              tavilyRetrievedAt: null,
              freshnessSummary: "Position monitoring initialized.",
            },
            evidenceIds: [],
            specialistFindings: [],
            evidenceMap: {},
            monitoringPlan: {
              marketId: market.marketId,
              pollIntervalSeconds: 30,
              monitoredTools: ["market.get_metadata", "cricket.get_fixture_data"],
              watchedFields: ["status", "innings", "runs"],
              materialChangeCriteria: ["Meaningful score or state change"],
              escalationConditions: ["Wicket falls or run-rate surge"],
              cooldownSeconds: 60,
              maxSentryEvaluations: 3,
              maxScoutingRuns: 2,
            },
            requestIds: [],
            provider: "zero-g",
            totalTokens: 0,
            estimatedCostUsd: 0,
            latencyMs: 0,
            telemetry: {
              totalTokens: 0,
              totalCostUsd: 0,
              durationMs: 0,
              requestIds: [],
              model: "baseline",
              provider: "zero-g",
            },
            createdAt: new Date().toISOString(),
          };
        }
        const tracked = await createOrUpdateTrackedMarket({
          userId: user.userId,
          market,
          latestReconReport: latestReport,
          authorizedBackgroundInference: true,
          activeSide: body.side,
        });

        // Trigger immediate baseline Sentry sweep for the freshly registered trade
        const activeRecord = guardWatchRegistry.get(tracked.trackingId);
        if (activeRecord) {
          try {
            await guardWatchRegistry.runTickForRecord(activeRecord, { bypassCooldown: true });
          } catch (tickErr) {
            logger.warn("[POSITIONS] Immediate Sentry evaluation error", { error: tickErr });
          }
        }
        ensureInProcessWatcherStarted();

        logger.info(
          `[POSITIONS] Auto-activated Guard Watch for position thesis | marketId=${body.marketId} | side=${body.side}`
        );
      }
    } catch (watchErr) {
      logger.warn("[POSITIONS] Could not auto-activate Guard Watch for position", {
        error: watchErr instanceof Error ? watchErr.message : String(watchErr),
      });
    }

    return jsonResponse(
      {
        ok: true,
        position,
        ...position,
      },
      201
    );
  } catch (err) {
    return errorResponse(err);
  }
}

