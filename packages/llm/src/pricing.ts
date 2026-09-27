import type { Usage } from "./types.js";

/** USD per 1M tokens. Cache reads bill at 0.1x input, cache writes at 1.25x (Anthropic). */
interface Price {
  input: number;
  output: number;
}

const PRICES: Record<string, Price> = {
  "anthropic:claude-opus-5": { input: 5, output: 25 },
  "anthropic:claude-sonnet-5": { input: 2, output: 10 },
  "anthropic:claude-haiku-4-5": { input: 1, output: 5 },
  // OpenAI list prices change often; unknown models cost 0 and are flagged in logs.
};

export function priceFor(ref: string): Price | undefined {
  return PRICES[ref];
}

export function costUsd(ref: string, u: Usage): number {
  const p = PRICES[ref];
  if (!p) return 0;
  const usd =
    (u.inputTokens * p.input +
      u.cacheReadTokens * p.input * 0.1 +
      u.cacheWriteTokens * p.input * 1.25 +
      u.outputTokens * p.output) /
    1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}
