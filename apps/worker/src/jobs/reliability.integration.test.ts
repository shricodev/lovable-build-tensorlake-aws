import { and, eq, getDb, messages, projects, runEvents, runQuotaExceeded, runs, users } from "@kiln/db";
import { createLogger } from "@kiln/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleAgentTurn } from "./agent-turn";

/** Crash recovery, cancellation and quotas against the local Postgres (no sandbox needed). */
describe("agent job reliability", () => {
  const { db, sql } = getDb();
  const log = createLogger("test", { level: "silent" });
  let userId: string;
  let projectId: string;

  beforeAll(async () => {
    const [u] = await db
      .insert(users)
      .values({ username: `test-${Date.now()}` })
      .returning();
    userId = u!.id;
    const [p] = await db.insert(projects).values({ ownerId: userId, name: "reliability test" }).returning();
    projectId = p!.id;
  });
  afterAll(async () => {
    await db.delete(users).where(eq(users.id, userId));
    await sql.end();
  });

  async function newRun(status: (typeof runs.$inferInsert)["status"]) {
    const [r] = await db
      .insert(runs)
      .values({ projectId, userId, model: "anthropic:claude-sonnet-5", status })
      .returning();
    await db.insert(messages).values({ projectId, role: "user", content: "hi", runId: r!.id });
    return r!;
  }

  it("fails a run cleanly when a worker picks it up again after a crash", async () => {
    const run = await newRun("running"); // what a crashed worker leaves behind
    await handleAgentTurn({ runId: run.id }, { db, log, cancelSignals: new Map() });
    const [after] = await db.select().from(runs).where(eq(runs.id, run.id));
    expect(after!.status).toBe("failed");
    expect(after!.error).toMatch(/worker restarted/i);
    const done = await db
      .select()
      .from(runEvents)
      .where(and(eq(runEvents.runId, run.id), eq(runEvents.type, "run_done")));
    expect(done).toHaveLength(1);
  });

  it("skips runs cancelled before a worker picked them up", async () => {
    const run = await newRun("cancelled");
    await handleAgentTurn({ runId: run.id }, { db, log, cancelSignals: new Map() });
    const [after] = await db.select().from(runs).where(eq(runs.id, run.id));
    expect(after!.status).toBe("cancelled");
    expect(await db.select().from(runEvents).where(eq(runEvents.runId, run.id))).toHaveLength(0);
  });

  it("rate-limits bursts of runs", async () => {
    process.env.MAX_RUNS_PER_MINUTE = "3";
    for (let i = 0; i < 3; i++) await newRun("succeeded");
    expect(await runQuotaExceeded(db, userId)).toMatch(/too quickly/);
    delete process.env.MAX_RUNS_PER_MINUTE;
  });
});
