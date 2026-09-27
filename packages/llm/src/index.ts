import { KilnError } from "@kiln/shared";
import { AnthropicProvider } from "./anthropic";
import { OpenAIProvider } from "./openai";
import type { LlmProvider } from "./types";

export * from "./types";
export * from "./pricing";
export { AnthropicProvider, OpenAIProvider };

/**
 * Build a provider from a `provider:model` ref (from env, e.g. LLM_CODER).
 * Ollama was dropped for the demo; adding it back is one adapter
 * against its OpenAI-compatible endpoint.
 */
export function createProvider(
  ref: string,
  keys: { anthropic?: string; openai?: string } = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
  },
): LlmProvider {
  const i = ref.indexOf(":");
  const provider = ref.slice(0, i);
  const model = ref.slice(i + 1);
  if (i < 1 || !model)
    throw new KilnError("llm_bad_ref", `Expected provider:model, got ${JSON.stringify(ref)}`);
  switch (provider) {
    case "anthropic":
      if (!keys.anthropic) throw new KilnError("llm_no_key", "ANTHROPIC_API_KEY is not set");
      return new AnthropicProvider(model, keys.anthropic);
    case "openai":
      if (!keys.openai) throw new KilnError("llm_no_key", "OPENAI_API_KEY is not set");
      return new OpenAIProvider(model, keys.openai);
    default:
      throw new KilnError("llm_bad_ref", `Unsupported provider ${JSON.stringify(provider)}`);
  }
}
