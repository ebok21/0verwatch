import { NextRequest } from "next/server";
import { z } from "zod";
import {
  createPaperPosition,
  listPaperPositions,
} from "@/lib/positions/store";
import { resolveRequestOrDevUser } from "@/lib/auth/session";
import { errorResponse, jsonResponse, optionsResponse } from "@/lib/http";
import { PaperPositionSideSchema } from "@overwatch/shared";

const CreatePositionBodySchema = z.object({
  marketId: z.string().min(1),
  side: PaperPositionSideSchema,
  stake: z.number().positive().max(10000),
  reconRunId: z.string().optional(),
  idempotencyKey: z.string().optional(),
});

export async function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: NextRequest) {
  try {
    const user = await resolveRequestOrDevUser(req);
    const { searchParams } = new URL(req.url);
    const marketId = searchParams.get("marketId") ?? undefined;
    const status = (searchParams.get("status") as any) ?? undefined;

    const positions = await listPaperPositions({
      userId: user.userId,
      marketId,
      status,
    });

    return jsonResponse({
      positions,
      userId: user.userId,
      count: positions.length,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await resolveRequestOrDevUser(req);
    const body = CreatePositionBodySchema.parse(await req.json());

    const position = await createPaperPosition({
      userId: user.userId,
      marketId: body.marketId,
      side: body.side,
      stake: body.stake,
      reconRunId: body.reconRunId,
      idempotencyKey: body.idempotencyKey,
    });

    return jsonResponse(position, 201);
  } catch (err) {
    return errorResponse(err);
  }
}

