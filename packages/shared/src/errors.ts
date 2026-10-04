/**
 * Base error for everything Lovable DIY throws on purpose. `userMessage` is safe to
 * show in the UI; `message` and `context` are for logs only.
 */
export class LovableDiyError extends Error {
  readonly code: string;
  readonly userMessage: string;
  readonly context: Record<string, unknown>;
  /** Transient failures (timeouts, 429s, 5xx) are worth retrying; deterministic ones are not. */
  readonly retryable: boolean;

  constructor(
    code: string,
    message: string,
    opts: {
      userMessage?: string;
      context?: Record<string, unknown>;
      retryable?: boolean;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: opts.cause });
    this.name = new.target.name;
    this.code = code;
    this.userMessage = opts.userMessage ?? "Something went wrong. Please try again.";
    this.context = opts.context ?? {};
    this.retryable = opts.retryable ?? false;
  }
}

export class TimeoutError extends LovableDiyError {
  constructor(what: string, ms: number) {
    super("timeout", `${what} timed out after ${ms}ms`, {
      userMessage: "The operation took too long and was stopped.",
      context: { what, ms },
      retryable: true,
    });
  }
}

export function isRetryable(err: unknown): boolean {
  return err instanceof LovableDiyError && err.retryable;
}
