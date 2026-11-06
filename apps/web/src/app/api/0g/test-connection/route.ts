import { NextRequest } from "next/server";
import {
  getUserDecryptedZeroGKeys,
  resolveRequestOrDevUser,
} from "@/lib/auth/session";
import { resolveInferenceProvider } from "@/lib/inference";
import { errorResponse, jsonResponse, optionsResponse } from "@/lib/http";

export async function OPTIONS() {
  return optionsResponse();
}

/**
 * Explicit user-triggered action: "Test 0G Connection".
 * Requires explicit user consent, discloses billed request, sends a minimal prompt ("ping", max_tokens: 16)
 * to verify 0G Compute cluster responsiveness using the user's decrypted `sk-` key.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await resolveRequestOrDevUser(req);
    const keys = await getUserDecryptedZeroGKeys(user.userId);

    if (!keys.skKey) {
      return jsonResponse(
        {
          ok: false,
          error: "NO_SECRET_KEY",
          message:
            "No 0G Secret Key (sk-) found for your account. Please enter and save your 0G Secret Key first.",
        },
        400
      );
    }

    const provider = resolveInferenceProvider({
      decryptedUserSkKey: keys.skKey,
      bypassKillSwitchForConnectionTest: true,
    });

    const start = Date.now();
    const res = await provider.complete(
      {
        model: "qwen3.5-35b-a3b",
        agentRole: "SERGEANT_PLAN",
        messages: [{ role: "user", content: "ping" }],
        maxTokens: 16,
        temperature: 0,
        timeoutMs: 15000,
      },
      {
        bypassKillSwitchForConnectionTest: true,
      }
    );

    const latencyMs = Date.now() - start;

    return jsonResponse({
      ok: true,
      message: "0G Compute cluster connection verified successfully.",
      model: res.model,
      requestId: res.requestId,
      latencyMs,
      billedRequestDisclosure:
        "This minimal test executed a live token request on 0G Compute.",
      costUsd: res.usage?.estimatedCostUsd ?? 0.000001,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
