import { describe, expect, it } from "vitest";
import { storageKeys } from "./keys.js";

describe("storageKeys", () => {
  it("builds the documented layout", () => {
    expect(storageKeys.export("p1", "e1")).toBe("exports/p1/e1.zip");
    expect(storageKeys.publishedPrefix("my-app", "v3")).toBe("published/my-app/v3/");
  });

  it("rejects segments that could escape their prefix", () => {
    expect(() => storageKeys.export("../other", "e1")).toThrow(/Unsafe/);
    expect(() => storageKeys.upload("u1", "a/b")).toThrow(/Unsafe/);
    expect(() => storageKeys.screenshot("", "v1")).toThrow(/Unsafe/);
  });
});
