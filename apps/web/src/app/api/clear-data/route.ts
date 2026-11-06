import { NextRequest } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { guardWatchRegistry } from "@/lib/watch/in-memory-registry";
import { clearAllReconData } from "@/lib/agents/orchestrator";
import { jsonResponse, errorResponse, optionsResponse } from "@/lib/http";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return optionsResponse();
}

/**
 * POST /api/clear-data
 * Cleans positions, recon reports, snapshots, sentry notifications, and tracked markets.
 * Clears in-memory caches and Guard Watch state.
 * Retains all configured prediction markets in Firestore (including newly created ones)
 * and preserves user 0G credentials in vault_credentials.
 */
export async function POST(req: NextRequest) {
  try {
    const db = getAdminDb();
    const results: Record<string, number> = {};

    // 1. Clear in-memory caches immediately
    try {
      clearAllReconData();
    } catch {
      // In-memory fallback
    }

    try {
      guardWatchRegistry.clear();
    } catch {
      // In-memory fallback
    }

    // 2. Clear recon_runs and their evidence subcollections
    try {
      const reconSnap = await db.collection("recon_runs").get();
      if (!reconSnap.empty) {
        const batch = db.batch();
        for (const doc of reconSnap.docs) {
          const evSnap = await doc.ref.collection("evidence").get();
          for (const evDoc of evSnap.docs) {
            batch.delete(evDoc.ref);
          }
          batch.delete(doc.ref);
        }
        await batch.commit();
        results["recon_runs"] = reconSnap.size;
      } else {
        results["recon_runs"] = 0;
      }
    } catch (rErr) {
      logger.warn("Error clearing recon_runs", { error: String(rErr) });
      results["recon_runs"] = 0;
    }

    // 3. Clear other operational collections
    const collectionsToClear = [
      "positions",
      "tracked_markets",
      "notifications",
      "recon_reports",
      "market_snapshots",
    ];

    for (const colName of collectionsToClear) {
      try {
        const snap = await db.collection(colName).get();
        if (!snap.empty) {
          const batch = db.batch();
          for (const doc of snap.docs) {
            batch.delete(doc.ref);
          }
          await batch.commit();
          results[colName] = snap.size;
        } else {
          results[colName] = 0;
        }
      } catch (colErr) {
        logger.warn(`Error clearing collection ${colName}`, {
          error: colErr instanceof Error ? colErr.message : String(colErr),
        });
        results[colName] = 0;
      }
    }

    logger.info("[0VERWATCH] All operational data cleared successfully. Markets retained.", results);

    return jsonResponse({
      ok: true,
      message: "Positions, recon data, snapshots, and notifications cleared. Markets retained.",
      cleared: results,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
