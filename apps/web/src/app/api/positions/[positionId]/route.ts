import { NextRequest } from "next/server";
import { z } from "zod";
import {
  closePaperPosition,
  getPaperPositionById,
} from "@/lib/positions/store";
import { resolveRequestOrDevUser } from "@/lib/auth/session";
import { errorResponse, jsonResponse, optionsResponse } from "@/lib/http";

export async function OPTIONS() {
  return optionsResponse();
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ positionId: string }> }
) {
  try {
    const { positionId } = await context.params;
    const position = await getPaperPositionById(positionId);
    if (!position) {
      return jsonResponse({ error: "Position not found" }, 404);
    }
    return jsonResponse(position);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ positionId: string }> }
) {
  try {
    const { positionId } = await context.params;
    const user = await resolveRequestOrDevUser(req);
    const body = (await req.json().catch(() => ({}))) as { action?: string };

    if (body.action === "close" || !body.action) {
      const closed = await closePaperPosition(positionId, user.userId);
      return jsonResponse(closed);
    }

    return jsonResponse({ error: "Unsupported position action" }, 400);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ positionId: string }> }
) {
  return POST(req, context);
}

