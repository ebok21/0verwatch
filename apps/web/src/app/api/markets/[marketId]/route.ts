import { NextRequest } from "next/server";
import {
  deleteMarketCascade,
  getCanonicalMarketMetadata,
  updateMarket,
} from "@/lib/markets/store";
import { getLatestReconReportForMarket } from "@/lib/agents/orchestrator";
import { errorResponse, jsonResponse, optionsResponse } from "@/lib/http";

export async function OPTIONS() {
  return optionsResponse();
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ marketId: string }> }
) {
  try {
    const { marketId } = await context.params;
    const market = await getCanonicalMarketMetadata(marketId);

    if (!market) {
      return jsonResponse(
        {
          error: "MARKET_NOT_FOUND",
          message: `Canonical market metadata not found for "${marketId}".`,
        },
        404
      );
    }

    const latestReport = await getLatestReconReportForMarket(market.marketId);

    return jsonResponse({
      market,
      latestReport,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ marketId: string }> }
) {
  try {
    const { marketId } = await context.params;
    const body = await req.json();
    const updated = await updateMarket(marketId, body);
    return jsonResponse(updated);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ marketId: string }> }
) {
  return PUT(req, context);
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ marketId: string }> }
) {
  try {
    const { marketId } = await context.params;
    const result = await deleteMarketCascade(marketId);
    return jsonResponse(result);
  } catch (err) {
    return errorResponse(err);
  }
}
