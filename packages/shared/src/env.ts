import { z } from "zod";

/**
 * Env config is split into small schemas so each app validates only what it
 * actually uses. The worker doesn't need GitHub OAuth secrets, and the gateway
 * doesn't need LLM keys. Keeping secrets out of processes that don't need them
 * is part of the security story (see docs/SECURITY.md).
 */

const bool = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");

export const coreEnv = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  DATABASE_URL: z.url(),
});

export const tensorlakeEnv = z.object({
  TENSORLAKE_API_KEY: z.string().min(1),
  TENSORLAKE_API_URL: z.url().optional(),
  TENSORLAKE_SANDBOX_PROXY_URL: z.url().optional(),
  // Free tier allows 1 concurrent sandbox. Raise this when the plan allows more.
  SANDBOX_CONCURRENCY_LIMIT: z.coerce.number().int().positive().default(1),
  SANDBOX_IDLE_TIMEOUT_SECS: z.coerce.number().int().positive().default(600),
  SANDBOX_CPUS: z.coerce.number().positive().default(1),
  SANDBOX_MEMORY_MB: z.coerce.number().int().positive().default(1024),
});

export const storageEnv = z.object({
  S3_BUCKET: z.string().min(1),
  S3_REGION: z.string().default("us-east-1"),
  // Set for MinIO in local dev; leave unset to talk to real AWS S3.
  S3_ENDPOINT: z.url().optional(),
  S3_FORCE_PATH_STYLE: bool.default(false),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
});

/** `provider:model`, e.g. `anthropic:claude-sonnet-5` or `openai:gpt-5.5`. */
const modelRef = z.string().regex(/^(anthropic|openai):.+$/, "expected provider:model");

export const llmEnv = z.object({
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  LLM_CODER: modelRef.default("anthropic:claude-sonnet-5"),
  LLM_SUMMARIZER: modelRef.default("anthropic:claude-haiku-4-5"),
  MAX_HEAL_ROUNDS: z.coerce.number().int().min(0).default(3),
});

export const authEnv = z.object({
  AUTH_SECRET: z.string().min(32),
  AUTH_GITHUB_ID: z.string().optional(),
  AUTH_GITHUB_SECRET: z.string().optional(),
  // Dev-only email login so the app works before a GitHub OAuth app exists.
  // Ignored when NODE_ENV=production, no matter what this says.
  DEV_LOGIN: bool.default(false),
  ADMIN_GITHUB_USERNAMES: z
    .string()
    .default("")
    .transform((s) =>
      s
        .split(",")
        .map((u) => u.trim())
        .filter(Boolean),
    ),
});

export const urlsEnv = z.object({
  APP_URL: z.url().default("http://localhost:3000"),
  // Previews live on a different origin so generated apps can't read app cookies.
  PREVIEW_BASE_DOMAIN: z.string().default("preview.localhost:4000"),
  PREVIEW_PROTOCOL: z.enum(["http", "https"]).default("http"),
});

export type Env<S extends z.ZodType> = z.infer<S>;

/**
 * Parse `process.env` against a schema and fail fast with a readable list of
 * problems. Called once at process start-up.
 */
export function loadEnv<S extends z.ZodType>(schema: S, source: NodeJS.ProcessEnv = process.env): z.infer<S> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
