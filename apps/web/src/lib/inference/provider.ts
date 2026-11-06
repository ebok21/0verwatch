import {
  InferenceMessage,
  InferenceRequest,
  InferenceRequestSchema,
  InferenceResponse,
  ToolOperationName,
} from "@overwatch/shared";
import { ToolRegistry } from "../connectors/registry";

export type InferenceErrorCode =
  | "TIMEOUT"
  | "UNKNOWN_OUTCOME"
  | "INVALID_CREDENTIALS"
  | "RATE_LIMITED"
  | "INSUFFICIENT_CREDITS"
  | "PROVIDER_ERROR"
  | "CONFIGURATION_ERROR"
  | "INFERENCE_DISABLED"
  | "INFERENCE_BUDGET_EXCEEDED";

export class InferenceProviderError extends Error {
  public readonly code: InferenceErrorCode;
  public readonly provider: "zero-g";
  public readonly statusCode: number;

  public constructor(params: {
    code: InferenceErrorCode;
    message: string;
    provider?: "zero-g";
    statusCode?: number;
  }) {
    super(params.message);
    this.name = "InferenceProviderError";
    this.code = params.code;
    this.provider = params.provider ?? "zero-g";
    this.statusCode = params.statusCode ?? 500;
  }
}

export interface InferenceProvider {
  readonly providerName: "zero-g";
  complete(request: InferenceRequest): Promise<InferenceResponse>;
}

/**
 * Tool-calling orchestration loop used by `ZeroGInferenceProvider`.
 *
 * Model requests a tool -> backend validates and executes via ToolRegistry ->
 * tool result is appended to messages -> model receives follow-up completion request ->
 * model returns final result.
 */
export async function runCompletionWithToolLoop(params: {
  provider: InferenceProvider;
  initialRequest: InferenceRequest;
  toolRegistry: ToolRegistry;
  allowedTools: ToolOperationName[];
  maxToolRoundtrips?: number;
  maxToolCallsTotal?: number;
}): Promise<{
  finalResponse: InferenceResponse;
  allResponses: InferenceResponse[];
  messages: InferenceMessage[];
}> {
  const validatedReq = InferenceRequestSchema.parse(params.initialRequest);
  const maxRoundtrips = params.maxToolRoundtrips ?? 2;
  const maxToolCallsTotal = params.maxToolCallsTotal ?? 3;

  const messages: InferenceMessage[] = [...validatedReq.messages];
  const allResponses: InferenceResponse[] = [];
  let totalToolsExecuted = 0;

  for (let round = 0; round <= maxRoundtrips; round++) {
    const isFinalAllowedRound =
      round === maxRoundtrips || totalToolsExecuted >= maxToolCallsTotal;

    const currentRequest: InferenceRequest = {
      ...validatedReq,
      messages,
      tools: isFinalAllowedRound
        ? undefined
        : params.toolRegistry.getToolDefinitions(params.allowedTools),
      toolChoice: isFinalAllowedRound ? "none" : validatedReq.toolChoice ?? "auto",
    };

    const response = await params.provider.complete(currentRequest);
    allResponses.push(response);

    if (
      response.finishReason !== "tool_calls" ||
      response.toolCalls.length === 0 ||
      isFinalAllowedRound
    ) {
      messages.push({
        role: "assistant",
        content: response.content,
      });
      return {
        finalResponse: response,
        allResponses,
        messages,
      };
    }

    messages.push({
      role: "assistant",
      content: response.content,
      tool_calls: response.toolCalls,
    });

    for (const toolCall of response.toolCalls) {
      if (totalToolsExecuted >= maxToolCallsTotal) {
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: JSON.stringify({
            error: "Tool call budget reached for this specialist.",
          }),
        });
        continue;
      }

      totalToolsExecuted += 1;
      try {
        const execResult = await params.toolRegistry.executeToolCall(
          toolCall.function.name,
          toolCall.function.arguments,
          params.allowedTools
        );
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: execResult.serializedModelOutput,
        });
      } catch (err) {
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          }),
        });
      }
    }
  }

  const last = allResponses[allResponses.length - 1]!;
  return {
    finalResponse: last,
    allResponses,
    messages,
  };
}
