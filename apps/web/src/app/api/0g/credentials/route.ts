import { NextRequest } from "next/server";
import { z } from "zod";
import {
  getAuthenticatedUserFromRequest,
  getUserDecryptedZeroGKeys,
  resolveRequestOrDevUser,
  revokeUserZeroGCredentials,
  saveUserZeroGCredentials,
} from "@/lib/auth/session";
import { getServerEnv } from "@/lib/env";
import { errorResponse, jsonResponse, optionsResponse } from "@/lib/http";
import {
  inferenceBudgetGuard,
  setRuntimeInferenceFlags,
} from "@/lib/inference/budget-guard";
import { fetchZeroGBalanceAndUsage } from "@/lib/inference/zero-g-balance";

const LinkZeroGKeysSchema = z.object({
  skKey: z
    .string()
    .min(10)
    .regex(/^sk-[a-zA-Z0-9_-]+$/, "0G inference key must start with 'sk-'"),
  mkKey: z
    .string()
    .regex(/^mk-[a-zA-Z0-9_-]+$/, "0G management key must start with 'mk-'")
    .optional()
    .nullable(),
});

const PatchZeroGConfigSchema = z.object({
  inferenceEnabled: z.boolean().optional(),
  sentryEnabled: z.boolean().optional(),
});

export async function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: NextRequest) {
  try {
    const env = getServerEnv();
    const explicitUser = getAuthenticatedUserFromRequest(req);
    const activeUser =
      explicitUser ??
      (env.NODE_ENV !== "production"
        ? await resolveRequestOrDevUser(req)
        : null);

    if (!activeUser) {
      const telemetry = inferenceBudgetGuard.getTelemetrySummary();
      return jsonResponse({
        authenticated: false,
        userId: null,
        walletAddress: null,
        isDevTestAccount: false,
        hasSkKey: false,
        skMaskedPreview: null,
        hasMkKey: false,
        mkMaskedPreview: null,
        mkPermissionScope: "account:read",
        inferenceProvider: "zero-g",
        zeroGModel: env.ZERO_G_MODEL,
        budgetSummary: telemetry,
      });
    }

    const keys = await getUserDecryptedZeroGKeys(activeUser.userId);
    const telemetry = inferenceBudgetGuard.getTelemetrySummary();

    let balance = null;
    if (keys.mkKey) {
      balance = await fetchZeroGBalanceAndUsage(keys.mkKey);
    }

    return jsonResponse({
      authenticated: true,
      userId: activeUser.userId,
      walletAddress: activeUser.walletAddress,
      isDevTestAccount: activeUser.isDevTestAccount,
      hasSkKey: Boolean(keys.skKey),
      skMaskedPreview: keys.skMaskedPreview,
      hasMkKey: Boolean(keys.mkKey),
      mkMaskedPreview: keys.mkMaskedPreview,
      balance,
      mkPermissionScope: "account:read",
      mkDisclosure:
        "Optional: used only to display your 0G account balance and usage. Create this key with account:read permission only.",
      inferenceProvider: "zero-g",
      zeroGModel: env.ZERO_G_MODEL,
      budgetSummary: telemetry,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await resolveRequestOrDevUser(req);
    const body = LinkZeroGKeysSchema.parse(await req.json());

    const saved = await saveUserZeroGCredentials({
      userId: user.userId,
      skKey: body.skKey,
      mkKey: body.mkKey ?? null,
    });

    let balance = null;
    if (body.mkKey) {
      balance = await fetchZeroGBalanceAndUsage(body.mkKey);
    }

    return jsonResponse({
      linked: true,
      userId: user.userId,
      skMaskedPreview: saved.skMaskedPreview,
      mkMaskedPreview: saved.mkMaskedPreview,
      balance,
      mkPermissionScope: "account:read",
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await resolveRequestOrDevUser(req);
    const body = PatchZeroGConfigSchema.parse(await req.json());
    setRuntimeInferenceFlags({
      inferenceEnabled: body.inferenceEnabled,
      sentryEnabled: body.sentryEnabled,
    });
    return jsonResponse({
      updated: true,
      budgetSummary: inferenceBudgetGuard.getTelemetrySummary(),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await resolveRequestOrDevUser(req);
    await revokeUserZeroGCredentials(user.userId);
    return jsonResponse({ revoked: true, userId: user.userId });
  } catch (err) {
    return errorResponse(err);
  }
}
