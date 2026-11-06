import { InferenceProviderError } from "./provider";

export interface InferenceUsageRecord {
  requestId: string;
  model: string;
  provider: "zero-g";
  workflowId?: string;
  agentRole?: string;
  timestamp: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationMs: number;
  estimatedCostUsd: number;
  success: boolean;
  errorCode?: string;
}

export interface BudgetGuardConfig {
  inferenceEnabled: boolean;
  sentryEnabled: boolean;
  maxDailyModelCalls: number;
  maxDailyInputTokens: number;
  maxDailyOutputTokens: number;
  maxModelCallsPerRecon: number;
  maxModelCallsPerScouting: number;
  maxToolRoundsPerAgent: number;
  maxOutputTokens: number;
  maxConcurrentModelCalls: number;
  maxSentryCallsPerMarketPerDay: number;
}

let runtimeInferenceEnabledOverride: boolean | null = null;
let runtimeSentryEnabledOverride: boolean | null = null;

export function setRuntimeInferenceFlags(flags: {
  inferenceEnabled?: boolean | null;
  sentryEnabled?: boolean | null;
}): void {
  if (flags.inferenceEnabled !== undefined) {
    runtimeInferenceEnabledOverride = flags.inferenceEnabled;
  }
  if (flags.sentryEnabled !== undefined) {
    runtimeSentryEnabledOverride = flags.sentryEnabled;
  }
}

export function getBudgetGuardConfig(): BudgetGuardConfig {
  const envInferenceEnabled = process.env.OG_INFERENCE_ENABLED === "true";
  const envSentryEnabled = process.env.OG_SENTRY_ENABLED === "true";

  return {
    inferenceEnabled:
      runtimeInferenceEnabledOverride !== null
        ? runtimeInferenceEnabledOverride
        : envInferenceEnabled,
    sentryEnabled:
      runtimeSentryEnabledOverride !== null
        ? runtimeSentryEnabledOverride
        : envSentryEnabled,
    maxDailyModelCalls: Number(process.env.OG_MAX_DAILY_MODEL_CALLS ?? "60"),
    maxDailyInputTokens: Number(process.env.OG_MAX_DAILY_INPUT_TOKENS ?? "500000"),
    maxDailyOutputTokens: Number(process.env.OG_MAX_DAILY_OUTPUT_TOKENS ?? "100000"),
    maxModelCallsPerRecon: Number(process.env.OG_MAX_MODEL_CALLS_PER_RECON ?? "16"),
    maxModelCallsPerScouting: Number(process.env.OG_MAX_MODEL_CALLS_PER_SCOUTING ?? "8"),
    maxToolRoundsPerAgent: Number(process.env.OG_MAX_TOOL_ROUNDS_PER_AGENT ?? "2"),
    maxOutputTokens: Number(process.env.OG_MAX_OUTPUT_TOKENS ?? "2000"),
    maxConcurrentModelCalls: Number(process.env.OG_MAX_CONCURRENT_MODEL_CALLS ?? "3"),
    maxSentryCallsPerMarketPerDay: Number(
      process.env.OG_MAX_SENTRY_CALLS_PER_MARKET_PER_DAY ?? "3"
    ),
  };
}

export class InferenceBudgetGuard {
  private dailyDateStr: string = new Date().toISOString().slice(0, 10);
  private dailyCallsCount = 0;
  private dailyInputTokensCount = 0;
  private dailyOutputTokensCount = 0;
  private activeConcurrentCalls = 0;
  private workflowCallCounts = new Map<string, number>();
  private marketSentryDailyCounts = new Map<string, number>();
  private usageHistory: InferenceUsageRecord[] = [];

  private ensureDayCurrent(): void {
    const today = new Date().toISOString().slice(0, 10);
    if (this.dailyDateStr !== today) {
      this.dailyDateStr = today;
      this.dailyCallsCount = 0;
      this.dailyInputTokensCount = 0;
      this.dailyOutputTokensCount = 0;
      this.marketSentryDailyCounts.clear();
      this.workflowCallCounts.clear();
    }
  }

  /**
   * Non-throwing pre-flight check to see whether an inference call is currently permitted.
   */
  public isCallAllowed(params?: {
    workflowId?: string;
    workflowType?: "RECON" | "SCOUTING" | "SENTRY";
    marketId?: string;
    bypassKillSwitchForConnectionTest?: boolean;
  }): { allowed: boolean; code?: string; reason?: string } {
    const config = getBudgetGuardConfig();
    this.ensureDayCurrent();

    if (!params?.bypassKillSwitchForConnectionTest) {
      if (!config.inferenceEnabled) {
        return {
          allowed: false,
          code: "INFERENCE_DISABLED",
          reason:
            "0G Inference is disabled by safety kill switch (OG_INFERENCE_ENABLED=false). Enable inference in Overwatch Settings or .env.local.",
        };
      }

      if (params?.workflowType === "SENTRY" && !config.sentryEnabled) {
        return {
          allowed: false,
          code: "SENTRY_DISABLED",
          reason:
            "0G Sentry inference is disabled by safety kill switch (OG_SENTRY_ENABLED=false).",
        };
      }
    }

    if (this.dailyCallsCount >= config.maxDailyModelCalls) {
      return {
        allowed: false,
        code: "INFERENCE_BUDGET_EXCEEDED",
        reason: `Global daily 0G model call budget exhausted (${this.dailyCallsCount}/${config.maxDailyModelCalls} requests used today). Reset at midnight UTC.`,
      };
    }

    if (this.dailyOutputTokensCount >= config.maxDailyOutputTokens) {
      return {
        allowed: false,
        code: "INFERENCE_BUDGET_EXCEEDED",
        reason: `Global daily 0G output token budget exhausted (${this.dailyOutputTokensCount}/${config.maxDailyOutputTokens} tokens used today). Reset at midnight UTC.`,
      };
    }

    if (params?.workflowId) {
      const currentInWorkflow = this.workflowCallCounts.get(params.workflowId) ?? 0;
      const limit =
        params.workflowType === "SCOUTING"
          ? config.maxModelCallsPerScouting
          : config.maxModelCallsPerRecon;

      if (currentInWorkflow >= limit) {
        return {
          allowed: false,
          code: "INFERENCE_BUDGET_EXCEEDED",
          reason: `Workflow inference budget exhausted for workflow ${params.workflowId} (${currentInWorkflow}/${limit} calls made).`,
        };
      }
    }

    if (params?.marketId && params.workflowType === "SENTRY") {
      const marketSentryUsed = this.marketSentryDailyCounts.get(params.marketId) ?? 0;
      if (marketSentryUsed >= config.maxSentryCallsPerMarketPerDay) {
        return {
          allowed: false,
          code: "INFERENCE_BUDGET_EXCEEDED",
          reason: `Daily Sentry inference evaluation cap reached for market ${params.marketId} (${marketSentryUsed}/${config.maxSentryCallsPerMarketPerDay}).`,
        };
      }
    }

    if (this.activeConcurrentCalls >= config.maxConcurrentModelCalls) {
      return {
        allowed: false,
        code: "RATE_LIMITED",
        reason: `Maximum concurrent 0G model requests active (${this.activeConcurrentCalls}/${config.maxConcurrentModelCalls}). Concurrency throttle active.`,
      };
    }

    return { allowed: true };
  }

  /**
   * Checks whether an inference request is permitted by the kill switch and budget thresholds.
   * Throws `InferenceProviderError` if prohibited.
   */
  public checkCallAllowed(params?: {
    workflowId?: string;
    workflowType?: "RECON" | "SCOUTING" | "SENTRY";
    marketId?: string;
    bypassKillSwitchForConnectionTest?: boolean;
  }): void {
    const check = this.isCallAllowed(params);
    if (!check.allowed) {
      throw new InferenceProviderError({
        code:
          check.code === "RATE_LIMITED"
            ? "RATE_LIMITED"
            : check.code === "INFERENCE_DISABLED" || check.code === "SENTRY_DISABLED"
            ? "INFERENCE_DISABLED"
            : "INFERENCE_BUDGET_EXCEEDED",
        message: check.reason ?? "Inference disallowed by safety policy.",
        provider: "zero-g",
        statusCode:
          check.code === "RATE_LIMITED" || check.code === "INFERENCE_BUDGET_EXCEEDED"
            ? 429
            : 403,
      });
    }
  }

  /**
   * Atomically reserves a slot for an inference request.
   * Call `release()` in a finally block once the request concludes.
   */
  public acquireReservation(params?: {
    workflowId?: string;
    workflowType?: "RECON" | "SCOUTING" | "SENTRY";
    marketId?: string;
    agentRole?: string;
    bypassKillSwitchForConnectionTest?: boolean;
  }): {
    release: () => void;
    recordSuccess: (record: Omit<InferenceUsageRecord, "success">) => void;
    recordFailure: (record: Omit<InferenceUsageRecord, "success">) => void;
  } {
    this.checkCallAllowed(params);

    this.activeConcurrentCalls += 1;

    let released = false;
    const release = () => {
      if (!released) {
        this.activeConcurrentCalls = Math.max(0, this.activeConcurrentCalls - 1);
        released = true;
      }
    };

    const recordSuccess = (rec: Omit<InferenceUsageRecord, "success">) => {
      this.recordOperation({ ...rec, success: true }, params);
      release();
    };

    const recordFailure = (rec: Omit<InferenceUsageRecord, "success">) => {
      this.recordOperation({ ...rec, success: false }, params);
      release();
    };

    return { release, recordSuccess, recordFailure };
  }

  private recordOperation(
    rec: InferenceUsageRecord,
    params?: {
      workflowId?: string;
      workflowType?: "RECON" | "SCOUTING" | "SENTRY";
      marketId?: string;
    }
  ): void {
    this.dailyCallsCount += 1;
    this.dailyInputTokensCount += rec.promptTokens || 0;
    this.dailyOutputTokensCount += rec.completionTokens || 0;
    if (params?.workflowId) {
      const current = this.workflowCallCounts.get(params.workflowId) ?? 0;
      this.workflowCallCounts.set(params.workflowId, current + 1);
    }
    if (params?.marketId && params?.workflowType === "SENTRY") {
      const current = this.marketSentryDailyCounts.get(params.marketId) ?? 0;
      this.marketSentryDailyCounts.set(params.marketId, current + 1);
    }

    this.usageHistory.unshift(rec);
    if (this.usageHistory.length > 50) {
      this.usageHistory = this.usageHistory.slice(0, 50);
    }
  }

  public getTelemetrySummary(): {
    config: BudgetGuardConfig;
    dailyDate: string;
    dailyCallsUsed: number;
    dailyCallsRemaining: number;
    dailyInputTokensUsed: number;
    dailyOutputTokensUsed: number;
    activeConcurrentCalls: number;
    recentUsageLogs: InferenceUsageRecord[];
  } {
    const config = getBudgetGuardConfig();
    this.ensureDayCurrent();

    return {
      config,
      dailyDate: this.dailyDateStr,
      dailyCallsUsed: this.dailyCallsCount,
      dailyCallsRemaining: Math.max(
        0,
        config.maxDailyModelCalls - this.dailyCallsCount
      ),
      dailyInputTokensUsed: this.dailyInputTokensCount,
      dailyOutputTokensUsed: this.dailyOutputTokensCount,
      activeConcurrentCalls: this.activeConcurrentCalls,
      recentUsageLogs: this.usageHistory.slice(0, 20),
    };
  }

  public resetForTesting(): void {
    runtimeInferenceEnabledOverride = null;
    runtimeSentryEnabledOverride = null;
    this.dailyCallsCount = 0;
    this.dailyInputTokensCount = 0;
    this.dailyOutputTokensCount = 0;
    this.activeConcurrentCalls = 0;
    this.workflowCallCounts.clear();
    this.marketSentryDailyCounts.clear();
    this.usageHistory = [];
  }
}

export const inferenceBudgetGuard = new InferenceBudgetGuard();
