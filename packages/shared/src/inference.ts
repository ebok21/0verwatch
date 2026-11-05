import { z } from "zod";

export const ToolCallSchema = z.object({
  id: z.string().min(1),
  type: z.literal("function"),
  function: z.object({
    name: z.string().min(1),
    arguments: z.string(), // JSON string of arguments
  }),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const InferenceMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string().nullable(),
  name: z.string().optional(),
  tool_call_id: z.string().optional(),
  tool_calls: z.array(ToolCallSchema).optional(),
});
export type InferenceMessage = z.infer<typeof InferenceMessageSchema>;

export const ToolDefinitionSchema = z.object({
  type: z.literal("function"),
  function: z.object({
    name: z.string().min(1),
    description: z.string(),
    parameters: z.record(z.unknown()),
  }),
});
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

export const InferenceRequestSchema = z.object({
  model: z.string().optional().default("qwen3.5-35b-a3b"),
  systemInstruction: z.string().optional(),
  messages: z.array(InferenceMessageSchema),
  tools: z.array(ToolDefinitionSchema).optional(),
  toolChoice: z
    .union([
      z.enum(["auto", "none", "required"]),
      z.object({
        type: z.literal("function"),
        function: z.object({ name: z.string() }),
      }),
    ])
    .optional(),
  temperature: z.number().min(0).max(2).optional().default(0.2),
  maxTokens: z.number().int().min(16).max(8192).optional().default(2000),
  agentRole: z
    .enum([
      "SERGEANT_PLAN",
      "DATA_SPECIALIST",
      "INTELLIGENCE_SPECIALIST",
      "SERGEANT_SYNTHESIS",
      "SENTRY",
      "SERGEANT_SCOUTING",
    ])
    .optional(),
  timeoutMs: z.number().int().min(1000).max(300000).optional().default(180000),
});
export type InferenceRequest = z.infer<typeof InferenceRequestSchema>;

export const InferenceUsageSchema = z.object({
  promptTokens: z.number().int().min(0),
  completionTokens: z.number().int().min(0),
  totalTokens: z.number().int().min(0),
  estimatedCostUsd: z.number().min(0).optional(),
});
export type InferenceUsage = z.infer<typeof InferenceUsageSchema>;

export const InferenceResponseSchema = z.object({
  content: z.string().nullable(),
  toolCalls: z.array(ToolCallSchema).default([]),
  finishReason: z.enum(["stop", "tool_calls", "length", "error"]),
  model: z.string(),
  usage: InferenceUsageSchema.optional(),
  requestId: z.string().min(1),
  provider: z.literal("zero-g").default("zero-g"),
  latencyMs: z.number().min(0).optional(),
  timeToFirstTokenMs: z.number().min(0).optional(),
});
export type InferenceResponse = z.infer<typeof InferenceResponseSchema>;
