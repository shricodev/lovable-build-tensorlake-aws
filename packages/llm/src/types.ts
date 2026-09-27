/**
 * Provider-neutral chat types. The agent loop only speaks these; each
 * provider adapter translates to and from its own SDK types.
 */

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the tool input (generated from the tool's Zod schema). */
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export type UserPart =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"; dataBase64: string }
  | { type: "tool_result"; toolCallId: string; content: string; isError?: boolean };

export interface UserMessage {
  role: "user";
  content: string | UserPart[];
}

export interface AssistantMessage {
  role: "assistant";
  text: string;
  toolCalls: ToolCall[];
  /**
   * The provider's own content, replayed verbatim when the same provider
   * continues the conversation. For Anthropic this keeps thinking blocks
   * intact, which the API requires within a tool-use turn.
   */
  native?: { provider: string; content: unknown };
}

export type LlmMessage = UserMessage | AssistantMessage;

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export type StopReason = "end" | "tool_use" | "max_tokens" | "refusal" | "other";

export interface ChatRequest {
  system: string;
  messages: LlmMessage[];
  tools?: ToolSpec[];
  maxTokens?: number;
  signal?: AbortSignal;
  /** Called with each streamed text delta. */
  onText?: (delta: string) => void;
}

export interface ChatResult {
  message: AssistantMessage;
  stopReason: StopReason;
  usage: Usage;
  model: string;
}

export interface LlmProvider {
  /** `provider:model`, e.g. `anthropic:claude-sonnet-5`. */
  readonly ref: string;
  readonly provider: "anthropic" | "openai";
  readonly model: string;
  readonly supportsVision: boolean;
  chat(req: ChatRequest): Promise<ChatResult>;
}

export const emptyUsage = (): Usage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}
