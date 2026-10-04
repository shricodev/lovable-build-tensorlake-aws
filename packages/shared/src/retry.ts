import { TimeoutError, isRetryable } from "./errors";

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Decide whether an error is transient. Defaults to `LovableDiyError.retryable`. */
  shouldRetry?: (err: unknown) => boolean;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
  signal?: AbortSignal;
}

/**
 * Exponential backoff with "full jitter": each wait is a random value in
 * [0, base * 2^attempt]. Jitter keeps many workers from retrying in lockstep
 * after a shared outage.
 */
export function backoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number, random = Math.random) {
  const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  return Math.floor(random() * ceiling);
}

export async function retry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const {
    attempts = 3,
    baseDelayMs = 250,
    maxDelayMs = 8_000,
    shouldRetry = isRetryable,
    onRetry,
    signal,
  } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    signal?.throwIfAborted();
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt === attempts - 1 || !shouldRetry(err)) throw err;
      const delay = backoffDelay(attempt, baseDelayMs, maxDelayMs);
      onRetry?.(err, attempt + 1, delay);
      await sleep(delay, signal);
    }
  }
  throw lastErr;
}

export async function withTimeout<T>(
  what: string,
  ms: number,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(what, ms));
    }, ms);
  });
  try {
    return await Promise.race([fn(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
