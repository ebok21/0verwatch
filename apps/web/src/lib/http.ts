import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { InferenceProviderError } from "./inference";
import { logger } from "./logger";

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-worker-auth",
};

export function jsonResponse<T>(data: T, status = 200): NextResponse<T> {
  return NextResponse.json(data, {
    status,
    headers: CORS_HEADERS,
  });
}

export function optionsResponse(): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ZodError) {
    const issueSummary = err.issues
      .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
      .join("; ");
    logger.error("Request validation failed at application boundary", {
      issues: err.issues,
    });
    return jsonResponse(
      {
        error: "VALIDATION_ERROR",
        message: `Request validation failed at application boundary: ${issueSummary}`,
        issues: err.issues,
      },
      400
    );
  }

  if (err instanceof InferenceProviderError) {
    return jsonResponse(
      {
        error: err.code,
        provider: err.provider,
        message: err.message,
      },
      err.statusCode
    );
  }

  const message =
    err instanceof Error ? err.message : "Unexpected server error.";
  logger.error("API route error", { message });

  const status = /not found/i.test(message)
    ? 404
    : /authentication required|invalid wallet|expired/i.test(message)
    ? 401
    : /invalid|disallowed|blocked/i.test(message)
    ? 400
    : 500;

  return jsonResponse(
    {
      error: "SERVER_ERROR",
      message,
    },
    status
  );
}

