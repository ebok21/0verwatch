import { z } from "zod";

const ServerEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  ZERO_G_BASE_URL: z.string().url().default("https://router-api.0g.ai/v1"),
  ZERO_G_MODEL: z.string().min(1).default("qwen3.5-35b-a3b"),
  ZERO_G_ENCRYPTION_KEY: z.string().min(32).optional(),
  SPORTMONKS_API_TOKEN: z.string().optional(),
  TAVILY_API_KEY: z.string().optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  GOOGLE_CLOUD_PROJECT: z.string().optional(),
  SESSION_SECRET: z
    .string()
    .min(16)
    .default("overwatch_dev_session_secret_key_2026_swiss_grid_99a8b7c6d5e4f3"),
  ADMIN_SECRET: z.string().default("overwatch-admin-dev"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  GUARD_WORKER_PORT: z.string().default("3002"),
  GUARD_WORKER_URL: z.string().url().default("http://127.0.0.1:3002"),
  OG_INFERENCE_ENABLED: z.string().optional(),
  OG_SENTRY_ENABLED: z.string().optional(),
  OG_MAX_DAILY_MODEL_CALLS: z.string().optional(),
  OG_MAX_DAILY_INPUT_TOKENS: z.string().optional(),
  OG_MAX_DAILY_OUTPUT_TOKENS: z.string().optional(),
  OG_MAX_MODEL_CALLS_PER_RECON: z.string().optional(),
  OG_MAX_MODEL_CALLS_PER_SCOUTING: z.string().optional(),
  OG_MAX_TOOL_ROUNDS_PER_AGENT: z.string().optional(),
  OG_MAX_OUTPUT_TOKENS: z.string().optional(),
  OG_MAX_CONCURRENT_MODEL_CALLS: z.string().optional(),
  OG_MAX_SENTRY_CALLS_PER_MARKET_PER_DAY: z.string().optional(),
  OG_INFERENCE_TIMEOUT_MS: z.string().optional(),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

let cachedEnv: ServerEnv | null = null;

/**
 * Reads application-level configuration from environment variables.
 * Strictly never reads user 0G provider credentials (SK/MK) from environment variables.
 */
export function getServerEnv(): ServerEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  const parsed = ServerEnvSchema.safeParse({
    NODE_ENV: process.env.NODE_ENV,
    ZERO_G_BASE_URL: process.env.ZERO_G_BASE_URL,
    ZERO_G_MODEL: process.env.ZERO_G_MODEL,
    ZERO_G_ENCRYPTION_KEY: process.env.ZERO_G_ENCRYPTION_KEY,
    SPORTMONKS_API_TOKEN: process.env.SPORTMONKS_API_TOKEN,
    TAVILY_API_KEY: process.env.TAVILY_API_KEY,
    GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT,
    SESSION_SECRET: process.env.SESSION_SECRET,
    ADMIN_SECRET: process.env.ADMIN_SECRET,
    APP_URL: process.env.APP_URL,
    GUARD_WORKER_PORT: process.env.GUARD_WORKER_PORT,
    GUARD_WORKER_URL: process.env.GUARD_WORKER_URL,
    OG_INFERENCE_ENABLED: process.env.OG_INFERENCE_ENABLED,
    OG_SENTRY_ENABLED: process.env.OG_SENTRY_ENABLED,
    OG_MAX_DAILY_MODEL_CALLS: process.env.OG_MAX_DAILY_MODEL_CALLS,
    OG_MAX_DAILY_INPUT_TOKENS: process.env.OG_MAX_DAILY_INPUT_TOKENS,
    OG_MAX_DAILY_OUTPUT_TOKENS: process.env.OG_MAX_DAILY_OUTPUT_TOKENS,
    OG_MAX_MODEL_CALLS_PER_RECON: process.env.OG_MAX_MODEL_CALLS_PER_RECON,
    OG_MAX_MODEL_CALLS_PER_SCOUTING: process.env.OG_MAX_MODEL_CALLS_PER_SCOUTING,
    OG_MAX_TOOL_ROUNDS_PER_AGENT: process.env.OG_MAX_TOOL_ROUNDS_PER_AGENT,
    OG_MAX_OUTPUT_TOKENS: process.env.OG_MAX_OUTPUT_TOKENS,
    OG_MAX_CONCURRENT_MODEL_CALLS: process.env.OG_MAX_CONCURRENT_MODEL_CALLS,
    OG_MAX_SENTRY_CALLS_PER_MARKET_PER_DAY:
      process.env.OG_MAX_SENTRY_CALLS_PER_MARKET_PER_DAY,
    OG_INFERENCE_TIMEOUT_MS: process.env.OG_INFERENCE_TIMEOUT_MS,
  });

  if (!parsed.success) {
    throw new Error(
      `Invalid Overwatch environment configuration: ${parsed.error.message}`
    );
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}

export function resetEnvCacheForTests(): void {
  cachedEnv = null;
}
