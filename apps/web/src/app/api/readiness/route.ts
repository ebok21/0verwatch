import { NextRequest } from "next/server";
import {
  getUserDecryptedZeroGKeys,
  resolveRequestOrDevUser,
} from "@/lib/auth/session";
import { fetchZeroGBalanceAndUsage } from "@/lib/inference/zero-g-balance";
import { getServerEnv } from "@/lib/env";
import { getAdminDb } from "@/lib/firebase-admin";
import { inferenceBudgetGuard } from "@/lib/inference/budget-guard";
import { errorResponse, jsonResponse, optionsResponse } from "@/lib/http";

export async function OPTIONS() {
  return optionsResponse();
}

/**
 * Startup readiness check endpoint:
 * Inspects all service dependencies without making any billed 0G inference calls.
 */
export async function GET(req: NextRequest) {
  try {
    let hasUserSk = false;
    let hasUserMk = false;
    let skPreview: string | null = null;
    let userId: string | null = null;
    let zeroGBalance: any = null;

    try {
      const user = await resolveRequestOrDevUser(req);
      userId = user.userId;
      const keys = await getUserDecryptedZeroGKeys(user.userId);
      hasUserSk = Boolean(keys.skKey);
      hasUserMk = Boolean(keys.mkKey);
      skPreview = keys.skMaskedPreview;

      if (keys.mkKey) {
        zeroGBalance = await fetchZeroGBalanceAndUsage(keys.mkKey);
      }
    } catch {
      // Unauthenticated or dev user resolution failed
    }

    const env = getServerEnv();
    const hasEncryptionKey = Boolean(
      env.ZERO_G_ENCRYPTION_KEY && env.ZERO_G_ENCRYPTION_KEY.length >= 32
    );
    const hasSportmonksToken = Boolean(
      env.SPORTMONKS_API_TOKEN && env.SPORTMONKS_API_TOKEN.length > 5
    );
    const hasTavilyKey = Boolean(
      env.TAVILY_API_KEY && env.TAVILY_API_KEY.length > 5
    );

    let firestoreConnected = false;
    try {
      const db = getAdminDb();
      await db.collection("_system_health").doc("ping").set(
        { lastPing: new Date().toISOString() },
        { merge: true }
      );
      firestoreConnected = true;
    } catch {
      firestoreConnected = false;
    }

    const budgetTelemetry = inferenceBudgetGuard.getTelemetrySummary();

    const isSystemReady =
      hasUserSk &&
      hasEncryptionKey &&
      hasSportmonksToken &&
      hasTavilyKey &&
      firestoreConnected &&
      budgetTelemetry.config.inferenceEnabled;

    return jsonResponse({
      ready: isSystemReady,
      timestamp: new Date().toISOString(),
      user: {
        userId,
        hasSkKey: hasUserSk,
        skMaskedPreview: skPreview,
        hasMkKey: hasUserMk,
      },
      zeroGBalance,
      services: {
        zeroGInferenceKey: {
          configured: hasUserSk,
          status: hasUserSk ? "CONFIGURED" : "MISSING_USER_KEY",
          notice: hasUserSk
            ? "User 0G inference secret key (sk-) linked in encrypted vault."
            : "No user 0G Secret Key configured. Enter your sk- key in Settings.",
        },
        vaultEncryptionKey: {
          configured: hasEncryptionKey,
          status: hasEncryptionKey ? "HEALTHY" : "MISSING_ENV_SECRET",
        },
        sportmonksApi: {
          configured: hasSportmonksToken,
          status: hasSportmonksToken ? "CONFIGURED" : "TOKEN_NOT_CONFIGURED",
        },
        tavilySearchApi: {
          configured: hasTavilyKey,
          status: hasTavilyKey ? "CONFIGURED" : "KEY_NOT_CONFIGURED",
        },
        firestoreDatabase: {
          connected: firestoreConnected,
          status: firestoreConnected ? "CONNECTED" : "CONNECTION_FAILED",
        },
      },
      budgetTelemetry,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

