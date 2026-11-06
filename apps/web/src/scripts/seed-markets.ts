import * as dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), "apps/web/.env.local") });

import { seedMarketsToFirestore } from "../lib/markets/store";
import { logger } from "../lib/logger";

async function main() {
  const seeded = await seedMarketsToFirestore();
  logger.info("Seeded canonical 0verwatch demo markets to Firestore", {
    count: seeded.length,
    marketIds: seeded.map((m: any) => m.marketId),
  });
}

main().catch((err) => {
  console.error("Failed to seed markets:", err);
  process.exit(1);
});

