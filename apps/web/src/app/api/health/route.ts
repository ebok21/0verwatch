import { getServerEnv } from "@/lib/env";
import { jsonResponse, optionsResponse } from "@/lib/http";

export async function OPTIONS() {
  return optionsResponse();
}

export async function GET() {
  const env = getServerEnv();
  return jsonResponse({
    status: "OK",
    service: "overwatch-intelligence-backend",
    version: "0.1.0",
    inferenceProvider: "zero-g",
    zeroGModel: env.ZERO_G_MODEL,
    zeroGBaseUrl: env.ZERO_G_BASE_URL,
    timestamp: new Date().toISOString(),
  });
}
