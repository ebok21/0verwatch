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
import { logger } from "@/lib/logger";

const RunReconBodySchema = z.object({
  marketId: z.preprocess(
    (val) => (typeof val === "string" ? val.trim() : val),
    z.string().min(1).max(128)
  ),
  platform: z
    .preprocess((val) => (typeof val === "string" && val ? val.toLowerCase() : "demo"), z.literal("demo"))
    .default("demo"),
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
    const body = await req.json().catch(() => ({}));
    const parseResult = RunReconBodySchema.safeParse(body);
    if (!parseResult.success) {
      logger.error("[API /api/recon] Request validation failed", {
        body,
        issues: parseResult.error.issues,
      });
      return jsonResponse(
        {
          error: "VALIDATION_ERROR",
          message: `Request validation failed: ${parseResult.error.issues
            .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
            .join("; ")}`,
          issues: parseResult.error.issues,
        },
        400
      );
    }

    const parsed = parseResult.data;
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
    logger.error("[API /api/recon] Workflow execution error", {
      error: err instanceof Error ? err.message : String(err),
    });
    if (err instanceof z.ZodError) {
      const issueSummary = err.issues
        .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
        .join("; ");
      return jsonResponse(
        {
          error: "RECON_WORKFLOW_ERROR",
          message: `Recon workflow schema processing error: ${issueSummary}`,
          issues: err.issues,
        },
        500
      );
    }
    return errorResponse(err);
  }
}
