export const CODER_MODELS = [
  { ref: "anthropic:claude-sonnet-5", label: "Claude Sonnet 5" },
  { ref: "anthropic:claude-opus-5", label: "Claude Opus 5" },
  { ref: "openai:gpt-5.5", label: "GPT-5.5" },
] as const;

export type CoderModelRef = (typeof CODER_MODELS)[number]["ref"];

export function isCoderModel(ref: string): ref is CoderModelRef {
  return CODER_MODELS.some((model) => model.ref === ref);
}
