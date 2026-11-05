import { NextRequest } from "next/server";
import { z } from "zod";
import { validateSportmonksFixtureById } from "@/lib/connectors/cricket-sportmonks";
import { errorResponse, jsonResponse, optionsResponse } from "@/lib/http";

const ValidateFixtureBodySchema = z.object({
  fixtureId: z.coerce.number().int().positive(),
});

export async function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const rawId = searchParams.get("fixtureId");
    if (!rawId) {
      return jsonResponse({ error: "Missing fixtureId query parameter" }, 400);
    }

    const { fixtureId } = ValidateFixtureBodySchema.parse({ fixtureId: rawId });
    const verified = await validateSportmonksFixtureById(fixtureId);
    return jsonResponse(verified);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = ValidateFixtureBodySchema.parse(await req.json());
    const verified = await validateSportmonksFixtureById(body.fixtureId);
    return jsonResponse(verified);
  } catch (err) {
    return errorResponse(err);
  }
}

