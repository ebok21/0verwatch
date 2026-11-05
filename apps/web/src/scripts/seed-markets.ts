import { seedMarketsToFirestore } from "../lib/markets/store";
import { logger } from "../lib/logger";

async function main() {
  const seeded = await seedMarketsToFirestore();
  logger.info("Seeded canonical Overwatch demo markets to Firestore", {
    count: seeded.length,
    marketIds: seeded.map((m: any) => m.marketId),
  });
}

main().catch((err) => {
  console.error("Failed to seed markets:", err);
  process.exit(1);
});

