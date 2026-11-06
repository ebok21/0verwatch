import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createDevOperatorSession,
  SESSION_COOKIE_NAME,
  verifyWalletChallengeAndCreateSession,
} from "@/lib/auth/session";
import { CORS_HEADERS, errorResponse, optionsResponse } from "@/lib/http";
import { getServerEnv } from "@/lib/env";

const VerifyBodySchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("wallet"),
    walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
  }),
  z.object({
    mode: z.enum(["dev_operator", "dev_mock"]),
  }),
]);

export async function OPTIONS() {
  return optionsResponse();
}

export async function POST(req: NextRequest) {
  try {
    const raw = (await req.json()) as Record<string, unknown>;
    const normalized = raw.mode ? raw : { mode: "wallet", ...raw };
    const parsed = VerifyBodySchema.parse(normalized);

    let sessionResult;
    if (parsed.mode === "wallet") {
      sessionResult = await verifyWalletChallengeAndCreateSession({
        walletAddress: parsed.walletAddress,
        signature: parsed.signature as `0x${string}`,
      });
    } else {
      sessionResult = await createDevOperatorSession();
    }

    const { user, sessionToken } = sessionResult;

    const env = getServerEnv();
    const res = NextResponse.json(
      {
        authenticated: true,
        user,
        sessionToken,
      },
      {
        status: 200,
        headers: CORS_HEADERS,
      }
    );

    res.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 24 * 60 * 60,
    });

    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
