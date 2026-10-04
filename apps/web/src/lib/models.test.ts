import { describe, expect, it } from "vitest";
import { CODER_MODELS, isCoderModel } from "./models";

describe("isCoderModel", () => {
  it("accepts every model offered by the workspace", () => {
    for (const model of CODER_MODELS) expect(isCoderModel(model.ref)).toBe(true);
  });

  it("rejects models that are not offered by the workspace", () => {
    expect(isCoderModel("openai:gpt-unknown")).toBe(false);
    expect(isCoderModel("other:model")).toBe(false);
  });
});
