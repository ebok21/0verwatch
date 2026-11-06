import * as dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), "apps/web/.env.local") });

import { getAdminDb } from "../lib/firebase-admin";
import { listSeededMarkets } from "../lib/markets/seeded-markets";
import { logger } from "../lib/logger";

async function main() {
  const db = getAdminDb();

  // 1. Clear operational collections
  const collectionsToClear = [
    "positions",
    "tracked_markets",
    "notifications",
    "recon_reports",
    "recon_runs",
    "market_snapshots",
  ];

  for (const colName of collectionsToClear) {
    const snap = await db.collection(colName).get();
    if (!snap.empty) {
      const batch = db.batch();
      for (const doc of snap.docs) {
        batch.delete(doc.ref);
      }
      await batch.commit();
      console.log(`Cleared ${snap.size} docs from ${colName}`);
    } else {
      console.log(`Collection ${colName} is empty`);
    }
  }

  // 2. Clear old markets and write ONLY the 2 canonical markets
  const marketsSnap = await db.collection("markets").get();
  if (!marketsSnap.empty) {
    const batch = db.batch();
    for (const doc of marketsSnap.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    console.log(`Purged ${marketsSnap.size} prior markets from markets collection`);
  }

  const seeded = listSeededMarkets();
  const seedBatch = db.batch();
  for (const market of seeded) {
    const docRef = db.collection("markets").doc(market.marketId);
    seedBatch.set(docRef, market);
  }
  await seedBatch.commit();

  console.log(`Successfully seeded ${seeded.length} canonical markets into Firestore:`, seeded.map(m => m.marketId));
  logger.info("[0VERWATCH] Database cleaned. Exactly 2 open market wagers active in Firestore.");
}

main().catch((err) => {
  console.error("Clean & seed failed:", err);
  process.exit(1);
});
