import Anthropic from "@anthropic-ai/sdk";
import { KilnError } from "@kiln/shared";
import type {
  AssistantMessage,
  ChatRequest,
  ChatResult,
  LlmMessage,
  LlmProvider,
  StopReason,
} from "./types.js";

export class AnthropicProvider implements LlmProvider {
  readonly provider = "anthropic" as const;
  readonly supportsVision = true;
  private readonly client: Anthropic;

  constructor(
    readonly model: string,
    apiKey?: string,
  ) {
    // The SDK retries 408/409/429/5xx and connection errors with backoff.
    this.client = new Anthropic({ apiKey, maxRetries: 4, timeout: 5 * 60_000 });
  }

  get ref() {
    return `anthropic:${this.model}`;
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const stream = this.client.messages.stream(
      {
        model: this.model,
        max_tokens: req.maxTokens ?? 32_000,
        // Auto-cache the growing prefix (system + tools + history) each call.
        cache_control: { type: "ephemeral" },
        system: req.system,
        tools: req.tools?.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
        })),
        messages: req.messages.map(toAnthropic),
      },
      { signal: req.signal },
    );
    if (req.onText) stream.on("text", req.onText);

    let msg: Anthropic.Message;
    try {
      msg = await stream.finalMessage();
    } catch (err) {
      throw wrap(err);
    }

    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const toolCalls = msg.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
      .map((b) => ({ id: b.id, name: b.name, input: b.input }));

    return {
      model: msg.model,
      stopReason: mapStop(msg.stop_reason),
      message: {
        role: "assistant",
        text,
        toolCalls,
        native: { provider: "anthropic", content: msg.content },
      },
      usage: {
        inputTokens: msg.usage.input_tokens,
        outputTokens: msg.usage.output_tokens,
        cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: msg.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }
}

function toAnthropic(m: LlmMessage): Anthropic.MessageParam {
  if (m.role === "assistant") return { role: "assistant", content: assistantContent(m) };
  if (typeof m.content === "string") return { role: "user", content: m.content };
  return {
    role: "user",
    content: m.content.map((p): Anthropic.ContentBlockParam => {
      switch (p.type) {
        case "text":
          return { type: "text", text: p.text };
        case "image":
          return { type: "image", source: { type: "base64", media_type: p.mediaType, data: p.dataBase64 } };
        case "tool_result":
          return { type: "tool_result", tool_use_id: p.toolCallId, content: p.content, is_error: p.isError };
      }
    }),
  };
}

function assistantContent(m: AssistantMessage): Anthropic.MessageParam["content"] {
  // Replay our own blocks unchanged (thinking blocks must round-trip as-is).
  if (m.native?.provider === "anthropic") return m.native.content as Anthropic.ContentBlockParam[];
  const blocks: Anthropic.ContentBlockParam[] = [];
  if (m.text) blocks.push({ type: "text", text: m.text });
  for (const c of m.toolCalls) blocks.push({ type: "tool_use", id: c.id, name: c.name, input: c.input });
  return blocks;
}

function mapStop(s: Anthropic.Message["stop_reason"]): StopReason {
  switch (s) {
    case "end_turn":
    case "stop_sequence":
      return "end";
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    case "refusal":
      return "refusal";
    default:
      return "other";
  }
}

function wrap(err: unknown): unknown {
  if (err instanceof Anthropic.APIUserAbortError) return err;
  if (err instanceof Anthropic.AuthenticationError) {
    return new KilnError("llm_auth", "Anthropic rejected the API key", {
      userMessage: "The AI provider key is invalid.",
      cause: err,
    });
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new KilnError("llm_rate_limited", err.message, {
      userMessage: "The AI provider is busy. Try again shortly.",
      retryable: true,
      cause: err,
    });
  }
  if (err instanceof Anthropic.APIError) {
    const retryable = err.status === undefined || err.status >= 500;
    return new KilnError("llm_error", `Anthropic API error ${err.status}: ${err.message}`, {
      retryable,
      cause: err,
    });
  }
  return err;
}
