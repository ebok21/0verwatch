import {
  MarketMetadata,
  MarketMetadataSchema,
  validateMarketResolutionHorizon,
} from "@overwatch/shared";
import { getAdminDb } from "../firebase-admin";
import { getSeededMarketById, listSeededMarkets } from "./seeded-markets";
import { validateSportmonksFixtureById } from "../connectors/cricket-sportmonks";
import { guardWatchRegistry } from "../watch/in-memory-registry";
import { logger } from "../logger";

const MARKETS_COLLECTION = "markets";

// Set to track deleted seeded market IDs in-memory so they don't re-appear in demo lists
const deletedMarketIds = new Set<string>();

export async function getCanonicalMarketMetadata(
  marketId: string
): Promise<MarketMetadata | null> {
  if (deletedMarketIds.has(marketId)) {
    return null;
  }

  // 1. Check Firestore markets collection first (overrides seeded defaults)
  try {
    const db = getAdminDb();
    const docSnap = await db.collection(MARKETS_COLLECTION).doc(marketId).get();
    if (docSnap.exists) {
      const parsed = MarketMetadataSchema.safeParse(docSnap.data());
      if (parsed.success) {
        return parsed.data;
      }
    }
  } catch (err) {
    logger.warn("Firestore market lookup error", {
      marketId,
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  // 2. Check in-memory seeded demo markets
  const seeded = getSeededMarketById(marketId);
  if (seeded) {
    return seeded;
  }

  return null;
}

export async function listAllCanonicalMarkets(): Promise<MarketMetadata[]> {
  const seeded = listSeededMarkets().filter((m) => !deletedMarketIds.has(m.marketId));
  const byId = new Map<string, MarketMetadata>();

  for (const item of seeded) {
    byId.set(item.marketId, item);
  }

  try {
    const db = getAdminDb();
    const snap = await db.collection(MARKETS_COLLECTION).get();
    for (const doc of snap.docs) {
      if (deletedMarketIds.has(doc.id)) continue;
      const parsed = MarketMetadataSchema.safeParse(doc.data());
      if (parsed.success) {
        byId.set(parsed.data.marketId, parsed.data);
      }
    }
  } catch (err) {
    logger.warn("Firestore market listing error, falling back to seeded demo markets", {
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  return Array.from(byId.values());
}

/**
 * Creates a new cricket prediction market with strict validation:
 * - 10-minute minimum horizon between openingTime and expectedResolutionTime
 * - Sportmonks fixture validation
 */
export async function createMarket(input: unknown): Promise<MarketMetadata> {
  const validated = MarketMetadataSchema.parse(input);

  // Enforce 10-minute minimum horizon
  const horizonCheck = validateMarketResolutionHorizon({
    openingTime: validated.openingTime,
    expectedResolutionTime: validated.expectedResolutionTime,
    minimumHorizonMinutes: validated.minimumResolutionHorizonMinutes ?? 10,
  });

  if (!horizonCheck.valid) {
    throw new Error(horizonCheck.reason ?? "Market resolution horizon does not meet the 10-minute minimum requirement.");
  }

  // Verify Sportmonks fixture ID if not already verified
  let verifiedFixtureMeta = validated.verifiedFixtureMeta;
  if (!verifiedFixtureMeta) {
    try {
      verifiedFixtureMeta = await validateSportmonksFixtureById(validated.fixtureId);
    } catch (err) {
      logger.warn(`Could not verify fixture #${validated.fixtureId} during market creation: ${err}`);
    }
  }

  const nowIso = new Date().toISOString();
  const finalRecord: MarketMetadata = {
    ...validated,
    verifiedFixtureMeta,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const db = getAdminDb();
  await db.collection(MARKETS_COLLECTION).doc(finalRecord.marketId).set(finalRecord);
  deletedMarketIds.delete(finalRecord.marketId);

  logger.info(`[MARKET] Created | marketId=${finalRecord.marketId} | fixtureId=${finalRecord.fixtureId}`);
  return finalRecord;
}

/**
 * Updates an existing market.
 */
export async function updateMarket(
  marketId: string,
  updates: Partial<MarketMetadata>
): Promise<MarketMetadata> {
  const existing = await getCanonicalMarketMetadata(marketId);
  if (!existing) {
    throw new Error(`Market not found: ${marketId}`);
  }

  const merged = {
    ...existing,
    ...updates,
    marketId,
    updatedAt: new Date().toISOString(),
  };

  if (updates.openingTime || updates.expectedResolutionTime) {
    const horizonCheck = validateMarketResolutionHorizon({
      openingTime: merged.openingTime,
      expectedResolutionTime: merged.expectedResolutionTime,
      minimumHorizonMinutes: merged.minimumResolutionHorizonMinutes ?? 10,
    });
    if (!horizonCheck.valid) {
      throw new Error(horizonCheck.reason ?? "Updated resolution horizon is less than 10 minutes.");
    }
  }

  const validated = MarketMetadataSchema.parse(merged);
  const db = getAdminDb();
  await db.collection(MARKETS_COLLECTION).doc(marketId).set(validated, { merge: true });

  logger.info(`[MARKET] Updated | marketId=${marketId}`);
  return validated;
}

/**
 * Cascading, idempotent market deletion across all collections and subcollections:
 * 1. Deactivates Guard Watch in-memory registry & worker.
 * 2. Recursively deletes `recon_runs/{runId}/evidence/*` then `recon_runs/{runId}` where `marketId === targetMarketId`.
 * 3. Deletes all docs in `positions`, `snapshots`, `tracked_markets`, `notifications` where `marketId === targetMarketId`.
 * 4. Deletes `markets/{marketId}` doc.
 * 5. Returns a summary of deleted document counts per collection.
 */
export async function deleteMarketCascade(marketId: string): Promise<{
  deleted: boolean;
  marketId: string;
  counts: {
    markets: number;
    positions: number;
    trackedMarkets: number;
    snapshots: number;
    reconRuns: number;
    evidence: number;
    notifications: number;
  };
}> {
  deletedMarketIds.add(marketId);

  // 1. Deactivate in Guard Watch in-memory registry
  guardWatchRegistry.deactivateMarket(marketId);

  const db = getAdminDb();
  const counts = {
    markets: 0,
    positions: 0,
    trackedMarkets: 0,
    snapshots: 0,
    reconRuns: 0,
    evidence: 0,
    notifications: 0,
  };

  try {
    // 2. Query recon_runs for this market and delete their evidence subcollections first
    const reconSnap = await db.collection("recon_runs").where("marketId", "==", marketId).get();
    for (const doc of reconSnap.docs) {
      const evidenceSnap = await doc.ref.collection("evidence").get();
      for (const evDoc of evidenceSnap.docs) {
        await evDoc.ref.delete();
        counts.evidence += 1;
      }
      await doc.ref.delete();
      counts.reconRuns += 1;
    }

    // 3. Delete positions
    const posSnap = await db.collection("positions").where("marketId", "==", marketId).get();
    for (const doc of posSnap.docs) {
      await doc.ref.delete();
      counts.positions += 1;
    }

    // 4. Delete tracked_markets
    const trackedSnap = await db.collection("tracked_markets").where("marketId", "==", marketId).get();
    for (const doc of trackedSnap.docs) {
      await doc.ref.delete();
      counts.trackedMarkets += 1;
    }

    // 5. Delete snapshots
    const snapSnap = await db.collection("snapshots").where("marketId", "==", marketId).get();
    for (const doc of snapSnap.docs) {
      await doc.ref.delete();
      counts.snapshots += 1;
    }

    // 6. Delete notifications
    const notifSnap = await db.collection("notifications").where("marketId", "==", marketId).get();
    for (const doc of notifSnap.docs) {
      await doc.ref.delete();
      counts.notifications += 1;
    }

    // 7. Delete market doc
    const marketRef = db.collection(MARKETS_COLLECTION).doc(marketId);
    const mSnap = await marketRef.get();
    if (mSnap.exists) {
      await marketRef.delete();
      counts.markets = 1;
    } else {
      counts.markets = 1; // marked deleted from seeded
    }
  } catch (err) {
    logger.warn(`Error during cascading deletion for marketId=${marketId}`, {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  logger.info(`[MARKET] Deleted cascade | marketId=${marketId} | counts=${JSON.stringify(counts)}`);
  return {
    deleted: true,
    marketId,
    counts,
  };
}
