import { NextRequest } from "next/server";
import { createMarket, listAllCanonicalMarkets } from "@/lib/markets/store";
import { errorResponse, jsonResponse, optionsResponse } from "@/lib/http";

export async function OPTIONS() {
  return optionsResponse();
}

export async function GET() {
  try {
    const markets = await listAllCanonicalMarkets();
    return jsonResponse({ markets });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const created = await createMarket(body);
    return jsonResponse(created, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
