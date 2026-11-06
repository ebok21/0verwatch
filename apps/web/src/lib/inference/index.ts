import { PlatformId } from "@overwatch/shared";
import { getServerEnv } from "../env";
import { InferenceProvider, InferenceProviderError } from "./provider";
import { ZeroGInferenceProvider } from "./zero-g-provider";
import { getBudgetGuardConfig } from "./budget-guard";

export * from "./provider";
export * from "./zero-g-provider";
export * from "./budget-guard";

/**
 * Resolves the active `ZeroGInferenceProvider` using the user's decrypted `sk-` key.
 * - No mock inference provider exists in normal runtime.
 * - Fails closed with `INFERENCE_DISABLED` if 0G Inference kill switch is active.
 * - Fails closed with `INVALID_CREDENTIALS` if user has not linked an `sk-` key.
 */
export function resolveInferenceProvider(options?: {
  platform?: PlatformId;
  decryptedUserSkKey?: string | null;
  bypassKillSwitchForConnectionTest?: boolean;
}): ZeroGInferenceProvider {
  const env = getServerEnv();
  const budgetConfig = getBudgetGuardConfig();

  if (!options?.bypassKillSwitchForConnectionTest && !budgetConfig.inferenceEnabled) {
    throw new InferenceProviderError({
      code: "INFERENCE_DISABLED",
      message:
        "0G Inference is disabled by safety kill switch (OG_INFERENCE_ENABLED=false). Enable inference in Overwatch Settings or set OG_INFERENCE_ENABLED=true.",
      provider: "zero-g",
      statusCode: 403,
    });
  }

  if (!options?.decryptedUserSkKey || !options.decryptedUserSkKey.trim().startsWith("sk-")) {
    throw new InferenceProviderError({
      code: "INVALID_CREDENTIALS",
      message:
        "A user-owned 0G 'sk-' inference key is required. Configure your 0G Secret Key in Overwatch Settings.",
      provider: "zero-g",
      statusCode: 401,
    });
  }

  return new ZeroGInferenceProvider({
    apiKey: options.decryptedUserSkKey.trim(),
    baseURL: env.ZERO_G_BASE_URL,
    model: env.ZERO_G_MODEL,
  });
}
