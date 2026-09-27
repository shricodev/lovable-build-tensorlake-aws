import { describe, expect, it, vi } from "vitest";
import { KilnError, TimeoutError } from "./errors.js";
import { backoffDelay, retry, withTimeout } from "./retry.js";

const transient = () => new KilnError("flaky", "flaky", { retryable: true });

describe("backoffDelay", () => {
  it("grows exponentially and respects the cap", () => {
    expect(backoffDelay(0, 100, 10_000, () => 0.999)).toBe(99);
    expect(backoffDelay(3, 100, 10_000, () => 0.999)).toBe(799);
    expect(backoffDelay(20, 100, 1_000, () => 0.999)).toBe(999);
  });
});

describe("retry", () => {
  it("retries transient errors until success", async () => {
    const fn = vi.fn().mockRejectedValueOnce(transient()).mockResolvedValue("ok");
    await expect(retry(fn, { baseDelayMs: 1 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry deterministic errors", async () => {
    const fn = vi.fn().mockRejectedValue(new KilnError("bad_input", "nope"));
    await expect(retry(fn, { baseDelayMs: 1 })).rejects.toThrow("nope");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after the configured attempts", async () => {
    const fn = vi.fn().mockRejectedValue(transient());
    await expect(retry(fn, { attempts: 3, baseDelayMs: 1 })).rejects.toThrow("flaky");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe("withTimeout", () => {
  it("rejects with TimeoutError and aborts the signal", async () => {
    let aborted = false;
    const p = withTimeout("slow thing", 10, (signal) => {
      signal.addEventListener("abort", () => (aborted = true));
      return new Promise(() => {});
    });
    await expect(p).rejects.toBeInstanceOf(TimeoutError);
    expect(aborted).toBe(true);
  });
});
