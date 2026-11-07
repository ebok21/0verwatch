import { NextRequest } from "next/server";
import { z } from "zod";
import {
  GuardWatchEvent,
  ReconReport,
  ReconReportSchema,
  SnapshotRecordSchema,
  TrackedMarketSchema,
} from "@overwatch/shared";
import { getAdminDb } from "@/lib/firebase-admin";
import { getCanonicalMarketMetadata } from "@/lib/markets/store";
import {
  getLatestReconReportForMarket,
  storeReconReportInMemoryAndDb,
} from "@/lib/agents/orchestrator";
import {
  closePaperPosition,
  createPaperPosition,
  listPaperPositions,
} from "@/lib/positions/store";
import {
  createIdempotentNotification,
  guardWatchRegistry,
} from "@/lib/watch/in-memory-registry";
import { resolveRequestOrDevUser } from "@/lib/auth/session";
import { errorResponse, jsonResponse, optionsResponse } from "@/lib/http";
import { logger } from "@/lib/logger";

const SimulateBodySchema = z.object({
  step: z.enum(["RECON", "OPEN_POSITION", "SHOCK"]),
  marketId: z.string().default("ind-nz-match-winner"),
});

export async function OPTIONS() {
  return optionsResponse();
}

export async function POST(req: NextRequest) {
  try {
    const user = await resolveRequestOrDevUser(req);
    const body = SimulateBodySchema.parse(await req.json().catch(() => ({})));
    const targetMarketId = body.marketId || "ind-nz-match-winner";

    const market = await getCanonicalMarketMetadata(targetMarketId);
    if (!market) {
      return jsonResponse(
        {
          error: "MARKET_NOT_FOUND",
          message: `Market "${targetMarketId}" not found in registry.`,
        },
        404
      );
    }

    const now = new Date().toISOString();

    if (body.step === "RECON") {
      const runId = `recon-${market.marketId}-sim-${Date.now()}`;
      const ev01 = {
        evidenceId: "EV-01",
        toolOperation: "cricket.get_fixture_data" as const,
        sourceUrlOrOrigin: `https://cricket.sportmonks.com/api/v2.0/fixtures/${market.fixtureId}`,
        retrievedAt: now,
        title: `Sportmonks Live Fixture #${market.fixtureId} (IND vs NZ — 1st Innings, Over 14.2)`,
        summary:
          "India 89/1 in 14.2 overs (RR 6.21). Shubman Gill 48* (44 balls, 6x4, 1x6), Virat Kohli 27* (26 balls, 3x4). Partnership: 62 runs off 51 balls.",
        extractedData: {
          status: "1st Innings",
          inningNumber: 1,
          battingTeam: "India",
          bowlingTeam: "New Zealand",
          totalRuns: 89,
          wickets: 1,
          oversBowled: 14.2,
          runRate: 6.21,
        },
      };

      const ev02 = {
        evidenceId: "EV-02",
        toolOperation: "cricket.get_fixture_data" as const,
        sourceUrlOrOrigin: `https://cricket.sportmonks.com/api/v2.0/fixtures/${market.fixtureId}?include=balls,batting`,
        retrievedAt: now,
        title: "DLS Par Trajectory & Powerplay Acceleration Telemetry",
        summary:
          "India scored 58/1 in Powerplay 1 (overs 1–10) and accelerated to 7.75 RPO across overs 10–14.2, putting them +18 runs ahead of Seddon Park DLS par (71/1).",
        extractedData: {
          dlsParAt14Overs: 71,
          actualScore: 89,
          projectedTotal: 318,
        },
      };

      const ev03 = {
        evidenceId: "EV-03",
        toolOperation: "web.search" as const,
        sourceUrlOrOrigin: "https://www.espncricinfo.com/series/india-in-new-zealand-2026",
        retrievedAt: now,
        title: "Seddon Park Hamilton Pitch & Live Match-Day Weather Telemetry",
        summary:
          "Clear skies in Hamilton (19°C, 0% rain probability). Pitch report confirms true bounce with minimal lateral seam movement after the 12th over.",
        extractedData: {
          venue: "Seddon Park, Hamilton",
          weather: "Clear, 19°C",
          pitchCondition: "Flat batting track, minimal seam movement",
        },
      };

      const keyFactors = [
        {
          id: "KF-01",
          text: "Dominant Top-Order Foundation: India is 89/1 after 14.2 overs (RR 6.21) with 9 wickets in hand, +18 runs ahead of the DLS par trajectory at Seddon Park.",
          evidenceIds: ["EV-01", "EV-02"],
          type: "EVIDENCE" as const,
          impact: "HIGH" as const,
        },
        {
          id: "KF-02",
          text: "Unbroken 2nd-Wicket Stand: Shubman Gill (48* off 44) and Virat Kohli (27* off 26) have added 62 runs off 51 deliveries, neutralizing New Zealand's new-ball attack.",
          evidenceIds: ["EV-01"],
          type: "EVIDENCE" as const,
          impact: "HIGH" as const,
        },
        {
          id: "KF-03",
          text: "Favorable Venue & Pitch Conditions: Seddon Park pitch has flattened out after the first 10 overs with 318 projected; teams defending 305+ at Hamilton win 78% of ODIs.",
          evidenceIds: ["EV-02", "EV-03"],
          type: "EVIDENCE" as const,
          impact: "MEDIUM" as const,
        },
      ];

      const risks = [
        {
          id: "RK-01",
          text: "Double-wicket burst from Matt Henry's return spell or Mitchell Santner's left-arm spin in the middle overs (15–25) could abruptly stall India's scoring rate.",
          evidenceIds: [],
          type: "HYPOTHETICAL_OBJECTION" as const,
          impact: "HIGH" as const,
        },
        {
          id: "RK-02",
          text: "Short square boundaries at Seddon Park (62m) allow New Zealand's middle order to chase targets under 290 if India loses momentum.",
          evidenceIds: [],
          type: "HYPOTHETICAL_OBJECTION" as const,
          impact: "MEDIUM" as const,
        },
      ];

      const simulatedReport: ReconReport = ReconReportSchema.parse({
        runId,
        marketId: market.marketId,
        fixtureId: market.fixtureId,
        platform: "demo",
        mode: "RECON",
        assessment: "YES",
        yesProbability: 68,
        noProbability: 32,
        estimateLabel: "AI ESTIMATE — LIVE MATCH SIMULATION",
        headline: "India Commanding at 89/1 (14.2 Overs) — 68% Win Probability",
        summary:
          "Live Sportmonks telemetry shows India cruising at 89/1 after 14.2 overs (Run Rate: 6.21), +18 runs ahead of the DLS par score at Seddon Park. Shubman Gill (48* off 44) and Virat Kohli (27* off 26) have neutralized New Zealand's new-ball swing. With 9 wickets in hand and a projected total of 318, India holds a strong 68% win probability.",
        keyFactors,
        risks,
        supportingClaims: keyFactors,
        uncertainties: [
          "Dew factor under floodlights in the second innings could assist New Zealand's top order.",
        ],
        dataFreshness: {
          fixtureId: market.fixtureId,
          fixtureStatus: "1st Innings (Live — Over 14.2)",
          sportmonksRetrievedAt: now,
          tavilyRetrievedAt: now,
          freshnessSummary: "LIVE SIMULATION • IND 89/1 (14.2 ov, RR 6.21)",
        },
        evidenceIds: ["EV-01", "EV-02", "EV-03"],
        specialistFindings: [
          {
            specialist: "DATA",
            summary:
              "India is 89/1 in 14.2 overs (RR 6.21), projecting 318 runs. Gill (48*) and Kohli (27*) lead a 62-run partnership.",
            claims: [keyFactors[0], keyFactors[1]],
            dataLimitations: [],
            requestId: `sim-data-${Date.now()}`,
            provider: "zero-g",
            latencyMs: 1420,
          },
          {
            specialist: "INTELLIGENCE",
            summary:
              "Hamilton weather is clear (19°C) and Seddon Park pitch is playing true with minimal seam movement.",
            claims: [keyFactors[2]],
            dataLimitations: [],
            requestId: `sim-intel-${Date.now()}`,
            provider: "zero-g",
            latencyMs: 1680,
          },
        ],
        evidenceMap: {
          "EV-01": ev01,
          "EV-02": ev02,
          "EV-03": ev03,
        },
        monitoringPlan: {
          marketId: market.marketId,
          pollIntervalSeconds: 20,
          monitoredTools: ["market.get_metadata", "cricket.get_fixture_data"],
          watchedFields: ["status", "note", "totalRuns", "wickets", "oversBowled"],
          materialChangeCriteria: [
            "Wicket falls in middle overs",
            "Run-rate drop > 1.0 RPO",
          ],
          escalationConditions: [
            "Dismissal of set batters (Gill / Kohli) or multi-wicket collapse",
          ],
          cooldownSeconds: 45,
          maxSentryEvaluations: 3,
          maxScoutingRuns: 2,
        },
        requestIds: [`sim-plan-${Date.now()}`, `sim-synth-${Date.now()}`],
        provider: "zero-g",
        totalTokens: 1840,
        estimatedCostUsd: 0.0018,
        latencyMs: 3100,
        telemetry: {
          totalTokens: 1840,
          totalCostUsd: 0.0018,
          durationMs: 3100,
          requestIds: [`sim-plan-${Date.now()}`, `sim-synth-${Date.now()}`],
          model: "qwen3.5-35b-a3b (0G Live Sim)",
          provider: "zero-g",
        },
        createdAt: now,
      });

      await storeReconReportInMemoryAndDb(simulatedReport);
      logger.info(
        `[SIMULATION] Step 1 (RECON) completed | market=${market.marketId} | assessment=YES (68%)`
      );

      return jsonResponse({
        ok: true,
        step: "RECON",
        market,
        report: simulatedReport,
      });
    }

    if (body.step === "OPEN_POSITION") {
      // Close any prior open positions on this market for a clean simulation
      const existingOpen = await listPaperPositions({
        userId: user.userId,
        marketId: market.marketId,
        status: "OPEN",
      });
      for (const pos of existingOpen) {
        await closePaperPosition(pos.positionId, user.userId);
      }

      const latestReport = await getLatestReconReportForMarket(market.marketId);

      const position = await createPaperPosition({
        userId: user.userId,
        marketId: market.marketId,
        side: "YES",
        stake: 100,
        reconRunId: latestReport?.runId ?? `recon-${market.marketId}-sim`,
        idempotencyKey: `sim-pos-${Date.now()}`,
      });

      const trackingId = `watch-${user.userId}-${market.marketId}`;
      const initialNormalizedState = {
        status: "1st Innings",
        note: "India 89/1 (14.2 ov) • Gill 48*, Kohli 27*",
        totalRuns: 89,
        wickets: 1,
        oversBowled: 14.2,
        runRate: 6.21,
      };

      const trackedRecord = TrackedMarketSchema.parse({
        trackingId,
        userId: user.userId,
        marketId: market.marketId,
        platform: "demo",
        question: market.question,
        status: "WATCHING",
        monitoringPlan: latestReport?.monitoringPlan ?? {
          marketId: market.marketId,
          pollIntervalSeconds: 20,
          monitoredTools: ["market.get_metadata", "cricket.get_fixture_data"],
          watchedFields: ["status", "note", "totalRuns", "wickets", "oversBowled"],
          materialChangeCriteria: ["Wicket fall or run-rate shift"],
          escalationConditions: ["Top-order collapse"],
          cooldownSeconds: 45,
          maxSentryEvaluations: 3,
          maxScoutingRuns: 2,
        },
        baselineReconRunId: latestReport?.runId ?? `recon-${market.marketId}-sim`,
        latestReconRunId: latestReport?.runId ?? `recon-${market.marketId}-sim`,
        positionIds: [position.positionId],
        activeSide: "YES",
        authorizedBackgroundInference: true,
        lastPolledAt: now,
        lastInferenceAt: null,
        sentryCallCount: 0,
        scoutingRunCount: 0,
        snapshotCount: 1,
        latestNormalizedState: initialNormalizedState,
        recentEvents: [
          {
            eventId: `evt-sim-arm-${Date.now()}`,
            timestamp: now,
            type: "SNAPSHOT_CAPTURED",
            summary:
              "Guard Watch armed for $100 YES position at IND 89/1 (14.2 ov, RR 6.21).",
          },
        ],
        createdAt: now,
        updatedAt: now,
      });

      const db = getAdminDb();
      await db.collection("tracked_markets").doc(trackingId).set(trackedRecord);

      guardWatchRegistry.registerMarket({
        trackedMarket: trackedRecord,
        market,
        activeSide: "YES",
        latestReconReport: latestReport,
      });

      logger.info(
        `[SIMULATION] Step 2 (OPEN_POSITION) completed | positionId=${position.positionId} | YES $100`
      );

      return jsonResponse({
        ok: true,
        step: "OPEN_POSITION",
        position,
        trackedMarket: trackedRecord,
      });
    }

    if (body.step === "SHOCK") {
      const trackingId = `watch-${user.userId}-${market.marketId}`;
      const db = getAdminDb();
      const docRef = db.collection("tracked_markets").doc(trackingId);
      const snap = await docRef.get();

      const shockState = {
        status: "1st Innings",
        note: "SHOCK COLLAPSE: Matt Henry & Mitchell Santner trigger 3-wicket burst! Gill (49), Kohli (29) & Iyer (0) dismissed. India 94/4 (16.4 ov)",
        totalRuns: 94,
        wickets: 4,
        oversBowled: 16.4,
        runRate: 5.64,
      };

      const alertTitle = `⚠️ Sentry Alert [POSITION_THESIS_WEAKENED] • ${market.marketId}`;
      const alertSummary =
        "CRITICAL MATCH SHOCK (Over 16.4): India collapsed from 89/1 to 94/4 — Gill (49), Kohli (29), and Iyer (0) dismissed in 14 balls! Live win probability plunged from 68% → 38%, severely threatening your $100 YES position.";

      const sentryEvent: GuardWatchEvent = {
        eventId: `evt-sim-shock-${Date.now()}`,
        timestamp: now,
        type: "SENTRY_DECISION",
        summary: `Sentry [POSITION_THESIS_WEAKENED]: ${alertSummary}`,
        sentryDecision: "NOTIFY_ONLY",
        requestId: `sim-sentry-${Date.now()}`,
      };

      let updatedTracked = snap.exists
        ? TrackedMarketSchema.parse(snap.data())
        : null;

      if (updatedTracked) {
        updatedTracked = {
          ...updatedTracked,
          snapshotCount: (updatedTracked.snapshotCount || 1) + 2,
          sentryCallCount: (updatedTracked.sentryCallCount || 0) + 1,
          lastPolledAt: now,
          lastInferenceAt: now,
          latestNormalizedState: shockState,
          recentEvents: [sentryEvent, ...(updatedTracked.recentEvents || [])].slice(
            0,
            15
          ),
          updatedAt: now,
        };
        await docRef.set(updatedTracked, { merge: true });
      }

      const activeMem = guardWatchRegistry.get(trackingId);
      if (activeMem && updatedTracked) {
        activeMem.trackedMarket = updatedTracked;
        activeMem.sentryCallCount = updatedTracked.sentryCallCount;
        activeMem.lastPolledAt = now;
        activeMem.lastInferenceAt = now;
        activeMem.latestSnapshot = SnapshotRecordSchema.parse({
          snapshotId: `snap-sim-shock-${Date.now()}`,
          trackingId,
          marketId: market.marketId,
          capturedAt: now,
          normalizedState: shockState,
          evidenceIds: ["EV-01"],
          isSyntheticStep: true,
        });
      }

      const notification = await createIdempotentNotification({
        notificationId: `notif-sim-shock-${Date.now()}`,
        userId: user.userId,
        trackingId,
        marketId: market.marketId,
        type: "SENTRY_ALERT",
        alertCategory: "POSITION_THESIS_WEAKENED",
        title: alertTitle,
        message: alertSummary,
        severity: "CRITICAL",
        requestId: sentryEvent.requestId,
        acknowledged: false,
        createdAt: now,
      });

      // Also update the ReconReport in memory/DB with the post-shock Scouting probability shift (68% -> 38%)
      const priorReport = await getLatestReconReportForMarket(market.marketId);
      let updatedReport: ReconReport | null = null;
      if (priorReport) {
        updatedReport = ReconReportSchema.parse({
          ...priorReport,
          runId: `recon-${market.marketId}-sim-shock-${Date.now()}`,
          mode: "SCOUTING",
          assessment: "NO",
          yesProbability: 38,
          noProbability: 62,
          estimateLabel: "AI ESTIMATE — SENTRY POST-SHOCK UPDATE",
          headline:
            "THESIS WEAKENED: India Reels at 94/4 (16.4 Overs) — Win Probability Drops to 38%",
          summary:
            "Sentry triggered an emergency reassessment after India lost 3 wickets for 5 runs in 14 balls (Gill 49, Kohli 29, Iyer 0). Reeling at 94/4 in 16.4 overs (RR 5.64) with New Zealand's pace and spin attack in full control, India's win probability has fallen from 68% down to 38%.",
          dataFreshness: {
            ...priorReport.dataFreshness,
            fixtureStatus: "1st Innings (Live Shock — Over 16.4)",
            sportmonksRetrievedAt: now,
            freshnessSummary:
              "SENTRY ALERT • IND 94/4 (16.4 ov) — 3 Wickets in 14 Balls!",
          },
          scoutingTriggerSummary: alertSummary,
          createdAt: now,
        });
        await storeReconReportInMemoryAndDb(updatedReport);
      }

      logger.info(
        `[SIMULATION] Step 3 (SHOCK) completed | notifId=${notification.notificationId} | prob=68%->38%`
      );

      return jsonResponse({
        ok: true,
        step: "SHOCK",
        trackedMarket: updatedTracked,
        notification,
        report: updatedReport,
      });
    }

    return jsonResponse({ error: "INVALID_STEP" }, 400);
  } catch (err) {
    return errorResponse(err);
  }
}
