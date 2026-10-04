import OpenAI from "openai";
import { LovableDiyError } from "@lovable-diy/shared";
import type { ChatRequest, ChatResult, LlmMessage, LlmProvider, StopReason } from "./types";

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export class OpenAIProvider implements LlmProvider {
  readonly provider = "openai" as const;
  readonly supportsVision = true;
  private readonly client: OpenAI;

  constructor(
    readonly model: string,
    apiKey?: string,
  ) {
    this.client = new OpenAI({ apiKey, maxRetries: 4, timeout: 5 * 60_000 });
  }

  get ref() {
    return `openai:${this.model}`;
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const messages: ChatMessage[] = [
      { role: "system", content: req.system },
      ...req.messages.flatMap(toOpenAI),
    ];
    let stream;
    try {
      stream = await this.client.chat.completions.create(
        {
          model: this.model,
          messages,
          max_completion_tokens: req.maxTokens ?? 32_000,
          stream: true,
          stream_options: { include_usage: true },
          ...(req.tools?.length
            ? {
                tools: req.tools.map((t) => ({
                  type: "function" as const,
                  function: { name: t.name, description: t.description, parameters: t.inputSchema },
                })),
              }
            : {}),
        },
        { signal: req.signal },
      );
    } catch (err) {
      throw wrap(err);
    }

    let text = "";
    let finish: string | null = null;
    let usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const calls = new Map<number, { id: string; name: string; args: string }>();

    try {
      for await (const chunk of stream) {
        if (chunk.usage) {
          const cached = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
          usage = {
            inputTokens: chunk.usage.prompt_tokens - cached,
            outputTokens: chunk.usage.completion_tokens,
            cacheReadTokens: cached,
            cacheWriteTokens: 0,
          };
        }
        const choice = chunk.choices[0];
        if (!choice) continue;
        if (choice.delta.content) {
          text += choice.delta.content;
          req.onText?.(choice.delta.content);
        }
        for (const tc of choice.delta.tool_calls ?? []) {
          const cur = calls.get(tc.index) ?? { id: "", name: "", args: "" };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          calls.set(tc.index, cur);
        }
        if (choice.finish_reason) finish = choice.finish_reason;
      }
    } catch (err) {
      throw wrap(err);
    }

    const toolCalls = [...calls.values()].map((c) => ({ id: c.id, name: c.name, input: safeJson(c.args) }));
    return {
      model: this.model,
      stopReason: mapStop(finish),
      message: { role: "assistant", text, toolCalls },
      usage,
    };
  }
}

function toOpenAI(m: LlmMessage): ChatMessage[] {
  if (m.role === "assistant") {
    return [
      {
        role: "assistant",
        content: m.text || null,
        ...(m.toolCalls.length
          ? {
              tool_calls: m.toolCalls.map((c) => ({
                id: c.id,
                type: "function" as const,
                function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) },
              })),
            }
          : {}),
      },
    ];
  }
  if (typeof m.content === "string") return [{ role: "user", content: m.content }];
  // Tool results become separate `tool` messages; other parts form one user message.
  const out: ChatMessage[] = [];
  const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];
  for (const p of m.content) {
    if (p.type === "tool_result") {
      out.push({
        role: "tool",
        tool_call_id: p.toolCallId,
        content: p.isError ? `ERROR: ${p.content}` : p.content,
      });
    } else if (p.type === "text") {
      parts.push({ type: "text", text: p.text });
    } else {
      parts.push({ type: "image_url", image_url: { url: `data:${p.mediaType};base64,${p.dataBase64}` } });
    }
  }
  if (parts.length) out.push({ role: "user", content: parts });
  return out;
}

function mapStop(s: string | null): StopReason {
  switch (s) {
    case "stop":
      return "end";
    case "tool_calls":
      return "tool_use";
    case "length":
      return "max_tokens";
    case "content_filter":
      return "refusal";
    default:
      return "other";
  }
}

/** Malformed tool arguments become an object the tool's Zod schema will reject with a clear error. */
function safeJson(s: string): unknown {
  try {
    return s ? JSON.parse(s) : {};
  } catch {
    return { __invalid_json: s.slice(0, 500) };
  }
}

function wrap(err: unknown): unknown {
  if (err instanceof OpenAI.APIUserAbortError) return err;
  if (err instanceof OpenAI.AuthenticationError) {
    return new LovableDiyError("llm_auth", "OpenAI rejected the API key", {
      userMessage: "The AI provider key is invalid.",
      cause: err,
    });
  }
  if (err instanceof OpenAI.RateLimitError) {
    return new LovableDiyError("llm_rate_limited", err.message, {
      userMessage: "The AI provider is busy. Try again shortly.",
      retryable: true,
      cause: err,
    });
  }
  if (err instanceof OpenAI.APIError) {
    const retryable = err.status === undefined || err.status >= 500;
    return new LovableDiyError("llm_error", `OpenAI API error ${err.status}: ${err.message}`, {
      retryable,
      cause: err,
    });
  }
  return err;
}
