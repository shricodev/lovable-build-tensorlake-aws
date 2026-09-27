import { describe, expect, it } from "vitest";
import { createProvider } from "./index.js";
import { costUsd } from "./pricing.js";

describe("createProvider", () => {
  it("parses provider:model refs", () => {
    const p = createProvider("anthropic:claude-sonnet-5", { anthropic: "k" });
    expect(p.provider).toBe("anthropic");
    expect(p.model).toBe("claude-sonnet-5");
    expect(createProvider("openai:gpt-5.5", { openai: "k" }).ref).toBe("openai:gpt-5.5");
  });

  it("rejects bad refs and missing keys", () => {
    expect(() => createProvider("claude-sonnet-5", {})).toThrow(/provider:model/);
    expect(() => createProvider("ollama:qwen", {})).toThrow(/Unsupported/);
    expect(() => createProvider("openai:gpt-5.5", {})).toThrow(/OPENAI_API_KEY/);
  });
});

describe("costUsd", () => {
  it("prices input, output and cache tokens", () => {
    const usd = costUsd("anthropic:claude-sonnet-5", {
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 0,
    });
    expect(usd).toBeCloseTo(2 + 1 + 0.2, 6);
  });

  it("returns 0 for unknown models", () => {
    expect(
      costUsd("openai:gpt-5.5", { inputTokens: 5, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 }),
    ).toBe(0);
  });
});
