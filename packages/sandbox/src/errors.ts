import { KilnError, TimeoutError } from "@kiln/shared";

export class SandboxError extends KilnError {}

export class SandboxPathError extends SandboxError {
  constructor(path: string, reason: string) {
    super("sandbox_path_rejected", `Rejected path ${JSON.stringify(path)}: ${reason}`, {
      userMessage: `The path "${path}" is not allowed.`,
      context: { path, reason },
    });
  }
}

/**
 * Map SDK/transport errors onto SandboxError so callers get a stable `code`
 * and a correct `retryable` flag (timeouts, 429 and 5xx are transient; 4xx are not).
 */
export function toSandboxError(err: unknown, op: string, context: Record<string, unknown> = {}): KilnError {
  if (err instanceof KilnError) return err;
  const e = err as { name?: string; message?: string; statusCode?: number };
  const status = e.statusCode;
  const notFound = status === 404 || e.name === "SandboxNotFoundError";
  const retryable =
    !notFound &&
    (status === undefined ||
      status === 408 ||
      status === 429 ||
      status >= 500 ||
      e.name === "SandboxConnectionError");
  return new SandboxError(
    notFound ? "sandbox_not_found" : "sandbox_call_failed",
    `${op} failed: ${e.message ?? String(err)}`,
    {
      userMessage: notFound
        ? "The sandbox or file could not be found."
        : "The sandbox didn't respond as expected.",
      context: { op, status, ...context },
      retryable,
      cause: err,
    },
  );
}

export { TimeoutError };
