import { and, count, eq, gt, isNull, sql } from "drizzle-orm";
import type { Db } from "./client";
import { projects, runs } from "./schema";

const limit = (name: string, fallback: number) => Number(process.env[name] ?? fallback);

/**
 * Per-user limits (env-configurable). Returns a human-readable reason when
 * the user is over a limit, or null when the action is allowed.
 */
export async function runQuotaExceeded(db: Db, userId: string): Promise<string | null> {
  const perMinute = limit("MAX_RUNS_PER_MINUTE", 6);
  const perDay = limit("MAX_RUNS_PER_DAY", 100);
  const tokensPerDay = limit("MAX_TOKENS_PER_DAY", 5_000_000);

  const [day] = await db
    .select({
      runs: count(),
      tokens: sql<number>`coalesce(sum(${runs.inputTokens} + ${runs.outputTokens}), 0)::int`,
      lastMinute: sql<number>`count(*) filter (where ${runs.createdAt} > now() - interval '1 minute')::int`,
    })
    .from(runs)
    .where(and(eq(runs.userId, userId), gt(runs.createdAt, sql`now() - interval '1 day'`)));

  if (day!.lastMinute >= perMinute)
    return "You're sending requests too quickly. Wait a minute and try again.";
  if (day!.runs >= perDay) return `You've reached the limit of ${perDay} requests per day.`;
  if (day!.tokens >= tokensPerDay)
    return "You've used today's AI token budget. It resets over the next 24 hours.";
  return null;
}

export async function projectQuotaExceeded(db: Db, userId: string): Promise<string | null> {
  const max = limit("MAX_PROJECTS", 25);
  const [row] = await db
    .select({ n: count() })
    .from(projects)
    .where(and(eq(projects.ownerId, userId), isNull(projects.deletedAt)));
  return row!.n >= max ? `You can have up to ${max} projects. Delete one to create another.` : null;
}
