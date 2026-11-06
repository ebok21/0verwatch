import OpenAI from "openai";
import {
  InferenceRequest,
  InferenceRequestSchema,
  InferenceResponse,
  InferenceResponseSchema,
  ToolCall,
} from "@overwatch/shared";
import { InferenceProvider, InferenceProviderError } from "./provider";
import { getServerEnv } from "../env";
import { inferenceBudgetGuard, getBudgetGuardConfig } from "./budget-guard";
import { logger } from "../logger";

// Published 0G catalogue pricing for 0gm-1.0-35b-a3b / qwen3.5-35b-a3b: $0.08/1M input, $0.48/1M output
const ZERO_G_INPUT_COST_PER_M = 0.08;
const ZERO_G_OUTPUT_COST_PER_M = 0.48;

export class ZeroGInferenceProvider implements InferenceProvider {
  public readonly providerName = "zero-g" as const;
  private readonly client: OpenAI;
  private readonly defaultModel: string;

  public constructor(params: { apiKey: string; baseURL?: string; model?: string }) {
    const trimmedKey = params.apiKey.trim();
    if (!trimmedKey || !trimmedKey.startsWith("sk-")) {
      throw new InferenceProviderError({
        code: "INVALID_CREDENTIALS",
        message:
          "A valid user 0G 'sk-' inference key is required for ZeroGInferenceProvider.",
        provider: "zero-g",
        statusCode: 401,
      });
    }

    const env = getServerEnv();
    this.defaultModel = params.model ?? env.ZERO_G_MODEL;
    this.client = new OpenAI({
      apiKey: trimmedKey,
      baseURL: params.baseURL ?? env.ZERO_G_BASE_URL,
      maxRetries: 1,
    });
  }

  public async complete(
    rawRequest: InferenceRequest,
    options?: {
      workflowId?: string;
      workflowType?: "RECON" | "SCOUTING" | "SENTRY";
      marketId?: string;
      bypassKillSwitchForConnectionTest?: boolean;
    }
  ): Promise<InferenceResponse> {
    const request = InferenceRequestSchema.parse(rawRequest);
    const startTime = Date.now();
    const config = getBudgetGuardConfig();
    const localReqId = `0g-req-${Date.now()}`;

    const reservation = inferenceBudgetGuard.acquireReservation({
      workflowId: options?.workflowId,
      workflowType:
        options?.workflowType ??
        (request.agentRole === "SENTRY" ? "SENTRY" : "RECON"),
      marketId: options?.marketId,
      agentRole: request.agentRole,
      bypassKillSwitchForConnectionTest: options?.bypassKillSwitchForConnectionTest,
    });

    const openAiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    if (request.systemInstruction) {
      openAiMessages.push({
        role: "system",
        content: request.systemInstruction,
      });
    }

    for (const msg of request.messages) {
      if (msg.role === "system") {
        openAiMessages.push({ role: "system", content: msg.content ?? "" });
      } else if (msg.role === "user") {
        openAiMessages.push({ role: "user", content: msg.content ?? "" });
      } else if (msg.role === "assistant") {
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          openAiMessages.push({
            role: "assistant",
            content: msg.content ?? null,
            tool_calls: msg.tool_calls.map((tc) => ({
              id: tc.id,
              type: "function" as const,
              function: {
                name: tc.function.name,
                arguments: tc.function.arguments,
              },
            })),
          });
        } else {
          openAiMessages.push({
            role: "assistant",
            content: msg.content ?? "",
          });
        }
      } else if (msg.role === "tool") {
        openAiMessages.push({
          role: "tool",
          tool_call_id: msg.tool_call_id ?? "unknown_call",
          content: msg.content ?? "",
        });
      }
    }

    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined =
      request.tools && request.tools.length > 0
        ? request.tools.map((t) => ({
            type: "function" as const,
            function: {
              name: t.function.name,
              description: t.function.description,
              parameters: t.function.parameters,
            },
          }))
        : undefined;

    const maxTokensClamped = Math.min(
      request.maxTokens ?? config.maxOutputTokens,
      config.maxOutputTokens
    );

    const envTimeout = Number(process.env.OG_INFERENCE_TIMEOUT_MS ?? "180000");
    const effectiveTimeoutMs = Math.max(
      request.timeoutMs ?? envTimeout,
      15000
    );

    let targetModel =
      this.defaultModel && this.defaultModel !== "0gm-1.0-35b-a3b"
        ? this.defaultModel
        : request.model && request.model !== "0gm-1.0-35b-a3b"
        ? request.model
        : "qwen3.5-35b-a3b";

    logger.info(
      `[0G] Inference request started | role=${request.agentRole ?? "agent"} requestId=${localReqId}`
    );

    try {
      let responseTuple;
      try {
        responseTuple = await this.client.chat.completions
          .create(
            {
              model: targetModel,
              messages: openAiMessages,
              tools,
              tool_choice: tools ? request.toolChoice : undefined,
              temperature: request.temperature,
              max_tokens: maxTokensClamped,
            },
            {
              timeout: effectiveTimeoutMs,
            }
          )
          .withResponse();
      } catch (firstErr) {
        const errStatus = (firstErr as any)?.status;
        const errMsg = firstErr instanceof Error ? firstErr.message : String(firstErr);
        const isUpstream502 =
          errStatus === 502 ||
          errStatus === 503 ||
          errStatus === 504 ||
          /502|503|504|EOF|provider quote|upstream|bad gateway|gateway timeout|reset|ECONNRESET|ETIMEDOUT|socket hang up/i.test(
            errMsg
          );

        if (isUpstream502) {
          logger.warn(
            `[0G] Upstream router/provider quote error (502/EOF). Retrying with backoff...`,
            { error: errMsg, status: errStatus }
          );

          let lastErr: Error =
            firstErr instanceof Error ? firstErr : new Error(String(firstErr));
          let succeeded = false;

          // Attempt retry on target model with backoff
          const retryAttempts = [
            { model: targetModel, delayMs: 1500 },
            { model: targetModel, delayMs: 3000 },
          ];

          for (const attempt of retryAttempts) {
            await new Promise((r) => setTimeout(r, attempt.delayMs));
            try {
              logger.info(`[0G] Retrying request with model=${attempt.model} after ${attempt.delayMs}ms...`);
              responseTuple = await this.client.chat.completions
                .create(
                  {
                    model: attempt.model,
                    messages: openAiMessages,
                    tools,
                    tool_choice: tools ? request.toolChoice : undefined,
                    temperature: request.temperature,
                    max_tokens: maxTokensClamped,
                  },
                  {
                    timeout: effectiveTimeoutMs,
                  }
                )
                .withResponse();
              targetModel = attempt.model;
              succeeded = true;
              logger.info(`[0G] Retry succeeded with model=${attempt.model}`);
              break;
            } catch (retryErr) {
              lastErr =
                retryErr instanceof Error ? retryErr : new Error(String(retryErr));
              logger.warn(`[0G] Retry failed: ${lastErr.message}`);
            }
          }

          if (!succeeded || !responseTuple) {
            throw lastErr;
          }
        } else {
          throw firstErr;
        }
      }

      const { data: completion, response: rawHttpResponse } = responseTuple;

      const choice = completion.choices[0];
      const rawToolCalls = choice?.message?.tool_calls ?? [];
      const toolCalls: ToolCall[] = rawToolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      }));

      const rawTrace = (
        completion as unknown as { x_0g_trace?: { request_id?: string } }
      ).x_0g_trace?.request_id;
      const headerTrace =
        rawHttpResponse.headers.get("x-0g-trace-id") ??
        rawHttpResponse.headers.get("x-request-id");
      const requestId =
        rawTrace || headerTrace || completion.id || localReqId;

      const promptTokens = completion.usage?.prompt_tokens ?? 0;
      const completionTokens = completion.usage?.completion_tokens ?? 0;
      const totalTokens =
        completion.usage?.total_tokens ?? promptTokens + completionTokens;
      const estimatedCostUsd = Number(
        (
          (promptTokens / 1_000_000) * ZERO_G_INPUT_COST_PER_M +
          (completionTokens / 1_000_000) * ZERO_G_OUTPUT_COST_PER_M
        ).toFixed(6)
      );

      const finishReason =
        toolCalls.length > 0 || choice?.finish_reason === "tool_calls"
          ? "tool_calls"
          : choice?.finish_reason === "length"
          ? "length"
          : "stop";

      const latencyMs = Date.now() - startTime;

      logger.info(
        `[0G] Inference completed | role=${request.agentRole ?? "agent"} duration=${latencyMs}ms tokens=${totalTokens}`
      );

      reservation.recordSuccess({
        requestId,
        model: completion.model || targetModel,
        provider: "zero-g",
        workflowId: options?.workflowId,
        agentRole: request.agentRole,
        timestamp: new Date().toISOString(),
        promptTokens,
        completionTokens,
        totalTokens,
        durationMs: latencyMs,
        estimatedCostUsd,
      });

      const rawMessage = choice?.message as Record<string, unknown> | undefined;
      const rawContent =
        typeof rawMessage?.content === "string" && rawMessage.content.trim().length > 0
          ? rawMessage.content
          : typeof rawMessage?.reasoning_content === "string" &&
            rawMessage.reasoning_content.trim().length > 0
          ? rawMessage.reasoning_content
          : null;

      return InferenceResponseSchema.parse({
        content: rawContent,
        toolCalls,
        finishReason,
        model: completion.model || targetModel,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens,
          estimatedCostUsd,
        },
        requestId,
        provider: "zero-g",
        isMock: false,
        latencyMs,
      });
    } catch (err) {
      const elapsedMs = Date.now() - startTime;
      reservation.recordFailure({
        requestId: `0g-failed-${Date.now()}`,
        model: request.model || this.defaultModel,
        provider: "zero-g",
        workflowId: options?.workflowId,
        agentRole: request.agentRole,
        timestamp: new Date().toISOString(),
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        durationMs: elapsedMs,
        estimatedCostUsd: 0,
        errorCode: err instanceof Error ? err.name : "UNKNOWN",
      });

      if (err instanceof OpenAI.APIError) {
        const msg = err.message || "0G Compute Router API error";
        if (err.status === 401 || err.status === 403) {
          throw new InferenceProviderError({
            code: "INVALID_CREDENTIALS",
            message: "0G Router rejected the provided sk- key (HTTP 401/403).",
            provider: "zero-g",
            statusCode: err.status,
          });
        }
        if (
          err.status === 402 ||
          /insufficient|credit|balance|quota/i.test(msg)
        ) {
          throw new InferenceProviderError({
            code: "INSUFFICIENT_CREDITS",
            message: "0G Compute credits exhausted or insufficient balance.",
            provider: "zero-g",
            statusCode: 402,
          });
        }
        if (err.status === 429) {
          const retryAfter = err.headers?.["retry-after"];
          throw new InferenceProviderError({
            code: "RATE_LIMITED",
            message: retryAfter
              ? `0G Compute Router rate limit reached (HTTP 429). Retry after ${retryAfter} seconds.`
              : "0G Compute Router rate limit reached (HTTP 429).",
            provider: "zero-g",
            statusCode: 429,
          });
        }
      }
      if (err instanceof Error && /timeout|timed out|abort/i.test(err.message)) {
        logger.error(
          "[0G] Request timed out (UNKNOWN_OUTCOME) - manual retry required",
          {
            role: request.agentRole,
            durationMs: elapsedMs,
            timeoutConfigured: effectiveTimeoutMs,
          }
        );
        throw new InferenceProviderError({
          code: "TIMEOUT",
          message:
            "0G Compute inference request timed out. The decentralized compute node did not complete within the timeout window. Please retry.",
          provider: "zero-g",
          statusCode: 504,
        });
      }
      if (err instanceof InferenceProviderError) {
        throw err;
      }
      const rawMsg = err instanceof Error ? err.message : "Unknown 0G Router failure";
      const isRouter502 = /502|EOF|quote/i.test(rawMsg);
      throw new InferenceProviderError({
        code: "PROVIDER_ERROR",
        message: isRouter502
          ? `0G Router temporary node error: 502 Bad Gateway (provider quote EOF). The 0G compute node connection dropped. Please retry the request.`
          : `0G Router error: ${rawMsg}`,
        provider: "zero-g",
        statusCode: 502,
      });
    }
  }
}
