import "server-only";
import {
  and,
  enqueueAgentTurn,
  eq,
  getDb,
  inArray,
  messages,
  projects,
  runQuotaExceeded,
  runs,
} from "@kiln/db";
import { llmEnv, loadEnv } from "@kiln/shared";
import { HttpError } from "./api";

/** Record the prompt, create a queued run and hand it to the worker. */
export async function startTurn(opts: { projectId: string; userId: string; prompt: string; model?: string }) {
  const { db } = getDb();
  const active = await db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.projectId, opts.projectId), inArray(runs.status, ["queued", "running"])));
  if (active.length) throw new HttpError(409, "The agent is still working on the previous request.");
  const over = await runQuotaExceeded(db, opts.userId);
  if (over) throw new HttpError(429, over);

  const model = opts.model ?? loadEnv(llmEnv).LLM_CODER;
  const run = await db.transaction(async (tx) => {
    const [r] = await tx
      .insert(runs)
      .values({ projectId: opts.projectId, userId: opts.userId, model })
      .returning();
    await tx
      .insert(messages)
      .values({ projectId: opts.projectId, role: "user", content: opts.prompt, runId: r!.id });
    await tx.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, opts.projectId));
    return r!;
  });
  await enqueueAgentTurn({ runId: run.id });
  return run;
}
