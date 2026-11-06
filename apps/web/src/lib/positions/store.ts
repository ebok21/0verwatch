import {
  PaperPosition,
  PaperPositionSchema,
  PaperPositionSide,
  PaperPositionStatus,
} from "@overwatch/shared";
import { getAdminDb } from "../firebase-admin";
import { getCanonicalMarketMetadata } from "../markets/store";
import { logger } from "../logger";

const POSITIONS_COLLECTION = "positions";

// In-memory cache & deduplication registry
const memoryPositions = new Map<string, PaperPosition>();
const idempotencyRegistry = new Map<string, { positionId: string; timestamp: number }>();

export interface CreatePaperPositionInput {
  userId: string;
  marketId: string;
  side: PaperPositionSide;
  stake: number;
  reconRunId?: string;
  idempotencyKey?: string;
}

/**
 * Creates a new binary paper position for demo trading:
 * - Prevents duplicate position creation on double-clicks or retries.
 * - Links to the market's verified fixtureId.
 * - Automatically registers position and logs.
 */
export async function createPaperPosition(
  input: CreatePaperPositionInput
): Promise<PaperPosition> {
  const { userId, marketId, side, stake, reconRunId, idempotencyKey } = input;
  const now = Date.now();

  // Deduplication 1: Idempotency Key check
  if (idempotencyKey) {
    const existing = idempotencyRegistry.get(idempotencyKey);
    if (existing && now - existing.timestamp < 60000) {
      const pos = await getPaperPositionById(existing.positionId);
      if (pos) return pos;
    }
  }

  // Deduplication 2: Rapid duplicate submission check (same user, market, side, stake within 15s)
  const dedupKey = `${userId}:${marketId}:${side}:${stake}`;
  const existingRecent = idempotencyRegistry.get(dedupKey);
  if (existingRecent && now - existingRecent.timestamp < 15000) {
    const pos = await getPaperPositionById(existingRecent.positionId);
    if (pos) return pos;
  }

  const market = await getCanonicalMarketMetadata(marketId);
  if (!market) {
    throw new Error(`Market not found: ${marketId}`);
  }

  const positionId = `pos-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const nowIso = new Date().toISOString();

  const record: PaperPosition = PaperPositionSchema.parse({
    positionId,
    userId,
    marketId,
    fixtureId: market.fixtureId,
    question: market.question,
    side,
    stake,
    openedAt: nowIso,
    closedAt: null,
    status: "OPEN",
    reconRunId: reconRunId || `recon-${marketId}-initial`,
    label: "PAPER POSITION — DEMO ONLY",
    idempotencyKey,
  });

  // Save to in-memory store
  memoryPositions.set(positionId, record);
  if (idempotencyKey) {
    idempotencyRegistry.set(idempotencyKey, { positionId, timestamp: now });
  }
  idempotencyRegistry.set(dedupKey, { positionId, timestamp: now });

  // Save to Firestore
  try {
    const db = getAdminDb();
    await db.collection(POSITIONS_COLLECTION).doc(positionId).set(record);
  } catch (err) {
    logger.warn(`Could not persist position ${positionId} to Firestore (offline/test mode)`, {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  logger.info(
    `[POSITION] Paper position opened | positionId=${positionId} | marketId=${marketId} | side=${side} | stake=$${stake}`
  );

  return record;
}

export async function getPaperPositionById(
  positionId: string
): Promise<PaperPosition | null> {
  if (memoryPositions.has(positionId)) {
    return memoryPositions.get(positionId)!;
  }

  try {
    const db = getAdminDb();
    const snap = await db.collection(POSITIONS_COLLECTION).doc(positionId).get();
    if (snap.exists) {
      const parsed = PaperPositionSchema.safeParse(snap.data());
      if (parsed.success) {
        memoryPositions.set(positionId, parsed.data);
        return parsed.data;
      }
    }
  } catch {
    // Non-fatal
  }

  return null;
}

export async function listPaperPositions(params: {
  userId?: string;
  marketId?: string;
  status?: PaperPositionStatus;
}): Promise<PaperPosition[]> {
  const results: PaperPosition[] = [];

  try {
    const db = getAdminDb();
    let query: FirebaseFirestore.Query = db.collection(POSITIONS_COLLECTION);
    if (params.userId) {
      query = query.where("userId", "==", params.userId);
    }
    if (params.marketId) {
      query = query.where("marketId", "==", params.marketId);
    }
    if (params.status) {
      query = query.where("status", "==", params.status);
    }

    const snap = await query.get();
    for (const doc of snap.docs) {
      const parsed = PaperPositionSchema.safeParse(doc.data());
      if (parsed.success) {
        results.push(parsed.data);
        memoryPositions.set(parsed.data.positionId, parsed.data);
      }
    }
  } catch {
    // Offline or test mode fallback
  }

  // Merge in-memory registry to guarantee instant visibility
  const seen = new Set<string>(results.map((r) => r.positionId));
  for (const pos of memoryPositions.values()) {
    if (seen.has(pos.positionId)) continue;
    if (params.userId && pos.userId !== params.userId) continue;
    if (params.marketId && pos.marketId !== params.marketId) continue;
    if (params.status && pos.status !== params.status) continue;
    results.push(pos);
    seen.add(pos.positionId);
  }

  return results.sort((a, b) => b.openedAt.localeCompare(a.openedAt));
}

export async function closePaperPosition(
  positionId: string,
  userId?: string
): Promise<PaperPosition> {
  const existing = await getPaperPositionById(positionId);
  if (!existing) {
    throw new Error(`Position not found: ${positionId}`);
  }

  if (userId && existing.userId !== userId) {
    throw new Error("Unauthorized to close this paper position.");
  }

  if (existing.status !== "OPEN") {
    return existing;
  }

  const closedAt = new Date().toISOString();
  const updated: PaperPosition = {
    ...existing,
    status: "CLOSED",
    closedAt,
  };

  memoryPositions.set(positionId, updated);

  try {
    const db = getAdminDb();
    await db
      .collection(POSITIONS_COLLECTION)
      .doc(positionId)
      .set(updated, { merge: true });
  } catch {
    // Non-fatal in memory mode
  }

  logger.info(`[POSITION] Paper position closed | positionId=${positionId} | marketId=${existing.marketId}`);
  return updated;
}

