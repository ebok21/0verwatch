import { NextRequest } from "next/server";
import { z } from "zod";
import { createWalletChallenge } from "@/lib/auth/session";
import { errorResponse, jsonResponse, optionsResponse } from "@/lib/http";

const ChallengeBodySchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

export async function OPTIONS() {
  return optionsResponse();
}

export async function POST(req: NextRequest) {
  try {
    const body = ChallengeBodySchema.parse(await req.json());
    const challenge = await createWalletChallenge(body.walletAddress);
    return jsonResponse(challenge);
  } catch (err) {
    return errorResponse(err);
  }
}

