import { NextRequest } from "next/server";
import { z } from "zod";
import { TrackedMarketSchema } from "@overwatch/shared";
import { getAdminDb } from "@/lib/firebase-admin";
import { getCanonicalMarketMetadata } from "@/lib/markets/store";
import {
  executeReconWorkflow,
  getLatestReconReportForMarket,
} from "@/lib/agents/orchestrator";
import {
  createOrUpdateTrackedMarket,
  guardWatchRegistry,
  notifyWorkerOfTrackUpdate,
  processGuardWatchCycleForMarket,
} from "@/lib/watch/engine";
import {
  ensureInProcessWatcherStarted,
  runInProcessSweep,
} from "@/lib/watch/in-process-watcher";
import {
  getUserDecryptedZeroGKeys,
  resolveRequestOrDevUser,
} from "@/lib/auth/session";
import { resolveInferenceProvider } from "@/lib/inference";
import { errorResponse, jsonResponse, optionsResponse } from "@/lib/http";

const TrackMarketBodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("TRACK").default("TRACK"),
    marketId: z.string().min(1),
    authorizedBackgroundInference: z.boolean().default(true),
    activeSide: z.enum(["YES", "NO"]).optional(),
  }),
  z.object({
    action: z.literal("TICK"),
    trackingId: z.string().min(1),
    bypassCooldown: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("SWEEP"),
    bypassCooldown: z.boolean().optional(),
  }),
]);

const UpdateWatchBodySchema = z.object({
  trackingId: z.string().min(1),
  status: z.enum(["WATCHING", "PAUSED_USER", "STOPPED"]),
});

export async function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: NextRequest) {
  try {
    ensureInProcessWatcherStarted();
    const user = await resolveRequestOrDevUser(req);
    const marketId = req.nextUrl.searchParams.get("marketId");
    const db = getAdminDb();

    let query = db
      .collection("tracked_markets")
      .where("userId", "==", user.userId);
    if (marketId) {
      query = query.where("marketId", "==", marketId);
    }

    const snap = await query.get();
    const trackedMarkets = snap.docs
      .map((d) => TrackedMarketSchema.safeParse(d.data()))
      .filter((r) => r.success)
      .map((r) => r.data);

    return jsonResponse({ trackedMarkets });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    ensureInProcessWatcherStarted();
    const user = await resolveRequestOrDevUser(req);
    const rawBody = (await req.json()) as Record<string, unknown>;
    const normalizedBody = rawBody.action
      ? rawBody
      : { action: "TRACK", ...rawBody };

    const parsed = TrackMarketBodySchema.parse(normalizedBody);

    if (parsed.action === "SWEEP") {
      const sweepRes = await runInProcessSweep({
        bypassCooldown: parsed.bypassCooldown,
      });
      return jsonResponse(sweepRes);
    }

    if (parsed.action === "TICK") {
      const db = getAdminDb();
      const snap = await db
        .collection("tracked_markets")
        .doc(parsed.trackingId)
        .get();
      if (!snap.exists) {
        return jsonResponse(
          { error: "NOT_FOUND", message: "Tracked market not found." },
          404
        );
      }
      const existing = TrackedMarketSchema.parse(snap.data());
      if (existing.userId !== user.userId) {
        return jsonResponse(
          { error: "FORBIDDEN", message: "Resource ownership check failed." },
          403
        );
      }

      const cycleResult = await processGuardWatchCycleForMarket({
        trackingId: parsed.trackingId,
        bypassCooldownForManualTest: parsed.bypassCooldown ?? true,
      });

      return jsonResponse(cycleResult);
    }

    const market = await getCanonicalMarketMetadata(parsed.marketId);
    if (!market) {
      return jsonResponse(
        { error: "MARKET_NOT_FOUND", message: "Market not found." },
        404
      );
    }

    let latestReport = await getLatestReconReportForMarket(market.marketId);
    if (!latestReport) {
      const userKeys = await getUserDecryptedZeroGKeys(user.userId);
      const provider = resolveInferenceProvider({
        platform: "demo",
        decryptedUserSkKey: userKeys.skKey,
      });
      latestReport = await executeReconWorkflow({ market, provider });
    }

    const trackedMarket = await createOrUpdateTrackedMarket({
      userId: user.userId,
      market,
      latestReconReport: latestReport,
      authorizedBackgroundInference: parsed.authorizedBackgroundInference,
      activeSide: parsed.activeSide,
    });

    // Run immediate baseline Sentry evaluation
    const activeRec = guardWatchRegistry.get(trackedMarket.trackingId);
    if (activeRec) {
      try {
        await guardWatchRegistry.runTickForRecord(activeRec, { bypassCooldown: true });
      } catch {
        // Non-fatal
      }
    }

    return jsonResponse({ trackedMarket }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await resolveRequestOrDevUser(req);
    const body = UpdateWatchBodySchema.parse(await req.json());
    const db = getAdminDb();
    const docRef = db.collection("tracked_markets").doc(body.trackingId);
    const snap = await docRef.get();

    if (!snap.exists) {
      return jsonResponse(
        { error: "NOT_FOUND", message: "Tracked market not found." },
        404
      );
    }

    const existing = TrackedMarketSchema.parse(snap.data());
    if (existing.userId !== user.userId) {
      return jsonResponse(
        { error: "FORBIDDEN", message: "Resource ownership check failed." },
        403
      );
    }

    const updated = {
      ...existing,
      status: body.status,
      updatedAt: new Date().toISOString(),
    };
    await docRef.set(updated);

    guardWatchRegistry.updateStatus(body.trackingId, body.status);
    void notifyWorkerOfTrackUpdate({
      action: body.status === "WATCHING" ? "TRACK" : "UPDATE",
      trackingId: body.trackingId,
      status: body.status,
      trackedMarket: updated,
    });

    return jsonResponse({ trackedMarket: updated });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await resolveRequestOrDevUser(req);
    const trackingId = req.nextUrl.searchParams.get("trackingId");
    if (!trackingId) {
      return jsonResponse(
        { error: "VALIDATION_ERROR", message: "Missing trackingId query param." },
        400
      );
    }

    const db = getAdminDb();
    const docRef = db.collection("tracked_markets").doc(trackingId);
    const snap = await docRef.get();
    if (!snap.exists) {
      guardWatchRegistry.unregisterMarket(trackingId);
      void notifyWorkerOfTrackUpdate({
        action: "UNTRACK",
        trackingId,
      });
      return jsonResponse({ deleted: true });
    }

    const existing = TrackedMarketSchema.parse(snap.data());
    if (existing.userId !== user.userId) {
      return jsonResponse(
        { error: "FORBIDDEN", message: "Resource ownership check failed." },
        403
      );
    }

    await docRef.delete();
    guardWatchRegistry.unregisterMarket(trackingId);
    void notifyWorkerOfTrackUpdate({
      action: "UNTRACK",
      trackingId,
    });
    return jsonResponse({ deleted: true });
  } catch (err) {
    return errorResponse(err);
  }
}
