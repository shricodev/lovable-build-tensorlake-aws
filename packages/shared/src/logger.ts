import { pino, type Logger, type LoggerOptions } from "pino";

export type { Logger };

/**
 * IDs we attach to every log line whenever they're known. Using fixed names
 * makes it possible to follow one run across web, worker and gateway logs.
 */
export interface LogContext {
  requestId?: string;
  projectId?: string;
  runId?: string;
  sandboxId?: string;
  userId?: string;
  jobId?: string;
}

export function createLogger(service: string, opts: LoggerOptions = {}): Logger {
  const pretty = process.env.NODE_ENV !== "production" && process.env.LOG_PRETTY !== "0";
  return pino({
    level: process.env.LOG_LEVEL ?? "info",
    base: { service },
    redact: {
      paths: [
        "*.apiKey",
        "*.token",
        "*.password",
        "*.authorization",
        "headers.authorization",
        "headers.cookie",
      ],
      censor: "[redacted]",
    },
    ...(pretty
      ? { transport: { target: "pino-pretty", options: { colorize: true, singleLine: true } } }
      : {}),
    ...opts,
  });
}

export function withContext(logger: Logger, ctx: LogContext): Logger {
  return logger.child(ctx);
}
