import { NextRequest } from "next/server";
import { z } from "zod";
import { getCanonicalMarketMetadata } from "@/lib/markets/store";
import {
  executeReconWorkflow,
  getLatestReconReportForMarket,
} from "@/lib/agents/orchestrator";
import { resolveInferenceProvider } from "@/lib/inference";
import {
  getUserDecryptedZeroGKeys,
  resolveRequestOrDevUser,
} from "@/lib/auth/session";
import { errorResponse, jsonResponse, optionsResponse } from "@/lib/http";

const RunReconBodySchema = z.object({
  marketId: z.string().min(1).max(128),
  platform: z.literal("demo").default("demo"),
});

export const maxDuration = 300;

export async function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: NextRequest) {
  try {
    const marketId = req.nextUrl.searchParams.get("marketId");
    if (!marketId) {
      return jsonResponse(
        { error: "VALIDATION_ERROR", message: "Missing marketId parameter." },
        400
      );
    }

    const report = await getLatestReconReportForMarket(marketId);
    return jsonResponse({ report });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = RunReconBodySchema.parse(body);

    const market = await getCanonicalMarketMetadata(parsed.marketId);
    if (!market) {
      return jsonResponse(
        {
          error: "MARKET_NOT_FOUND",
          message: `Market "${parsed.marketId}" not found.`,
        },
        404
      );
    }

    const user = await resolveRequestOrDevUser(req);
    const userKeys = await getUserDecryptedZeroGKeys(user.userId);

    const provider = resolveInferenceProvider({
      platform: "demo",
      decryptedUserSkKey: userKeys.skKey,
    });

    const report = await executeReconWorkflow({
      market,
      provider,
    });

    return jsonResponse({ report });
  } catch (err) {
    return errorResponse(err);
  }
}
