import type { AgentTurnJob, Db } from "@kiln/db";
import { and, appendEvent, asc, browserErrors, desc, eq, gt, messages, projects, runs } from "@kiln/db";
import { createProvider } from "@kiln/llm";
import type { Logger } from "@kiln/shared";
import type { AgentEvent } from "../agent/events";
import { runAgentTurn } from "../agent/loop";
import type { PriorTurn } from "../agent/context";
import { ensureMainSandbox } from "../sandboxes";

export async function handleAgentTurn(
  job: AgentTurnJob,
  deps: { db: Db; log: Logger; cancelSignals: Map<string, AbortController> },
) {
  const { db } = deps;
  const log = deps.log.child({ runId: job.runId });
  const [run] = await db.select().from(runs).where(eq(runs.id, job.runId));
  if (!run) return log.warn("run not found");
  const projectId = run.projectId;
  const emit = (type: string, payload: unknown) =>
    appendEvent(db, { projectId, runId: run.id, type, payload });

  if (run.status === "running") {
    // Picked up again after a worker crash. The sandbox keeps whatever the agent
    // wrote; we fail the run clearly instead of guessing where it stopped.
    await finishRun(db, run.id, {
      status: "failed",
      error:
        "The worker restarted during this turn. Your files are as the agent left them; send the request again to continue.",
    });
    await emit("run_done", { status: "failed" });
    return;
  }
  if (run.status !== "queued") return;

  const ac = new AbortController();
  deps.cancelSignals.set(run.id, ac);
  await db.update(runs).set({ status: "running", startedAt: new Date() }).where(eq(runs.id, run.id));
  await emit("run_started", { model: run.model });

  const [userMsg] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.runId, run.id), eq(messages.role, "user")))
    .limit(1);

  // Events are written through one promise chain so they land in run_events in
  // the order they happened. Streamed text is coalesced to one row per ~250 ms.
  let chain: Promise<unknown> = Promise.resolve();
  const enqueue = (fn: () => Promise<unknown>) => {
    chain = chain.then(fn).catch((err) => log.warn({ err }, "failed to record event"));
  };
  let buffered = "";
  let flushTimer: NodeJS.Timeout | undefined;
  const flush = () => {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = undefined;
    if (!buffered) return;
    const text = buffered;
    buffered = "";
    enqueue(() => emit("message_delta", { text }));
  };
  const onEvent = (e: AgentEvent) => {
    if (e.type === "message_delta") {
      buffered += e.text;
      flushTimer ??= setTimeout(flush, 250);
      return;
    }
    if (e.type === "usage") return; // aggregated on the run row instead
    flush();
    enqueue(() => emit(e.type, e));
  };

  try {
    const sandbox = await ensureMainSandbox(db, projectId, log);
    const priorTurns = await loadPriorTurns(db, projectId, run.id);
    const startedAt = new Date();
    const result = await runAgentTurn({
      sandbox,
      llm: createProvider(run.model),
      prompt: userMsg?.content ?? "",
      priorTurns,
      log,
      signal: ac.signal,
      onEvent,
      maxHealRounds: Number(process.env.MAX_HEAL_ROUNDS ?? 3),
      getPreviewErrors: async () => {
        const rows = await db
          .select()
          .from(browserErrors)
          .where(and(eq(browserErrors.projectId, projectId), gt(browserErrors.createdAt, startedAt)))
          .orderBy(desc(browserErrors.createdAt))
          .limit(20);
        return rows.map((r) => ({
          message: r.message,
          stack: r.stack ?? undefined,
          url: r.url ?? undefined,
          source: "preview" as const,
        }));
      },
    });
    flush();
    await chain;

    await finishRun(db, run.id, {
      status: result.status,
      summary: result.summary,
      suggestions: result.suggestions,
      changedFiles: result.changedFiles,
      healRounds: result.healRounds,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      cacheReadTokens: result.usage.cacheReadTokens,
      costUsd: result.costUsd,
      error: result.error ?? null,
    });
    const reply =
      result.status === "succeeded"
        ? result.summary
        : result.status === "cancelled"
          ? "Stopped. Changes made so far are kept."
          : `I couldn't finish this one. ${result.error?.split("\n")[0] ?? ""}`;
    await db.insert(messages).values({ projectId, role: "assistant", content: reply, runId: run.id });
    await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
    await emit("run_done", {
      status: result.status,
      summary: reply,
      suggestions: result.suggestions,
      costUsd: result.costUsd,
    });
  } catch (err) {
    flush();
    await chain;
    log.error({ err }, "agent turn crashed");
    const msg = err instanceof Error ? err.message : String(err);
    await finishRun(db, run.id, { status: "failed", error: msg });
    await db
      .insert(messages)
      .values({ projectId, role: "assistant", content: `Something went wrong: ${msg}`, runId: run.id });
    await emit("run_done", { status: "failed", summary: msg });
  } finally {
    deps.cancelSignals.delete(run.id);
  }
}

async function finishRun(db: Db, runId: string, values: Partial<typeof runs.$inferInsert>) {
  await db
    .update(runs)
    .set({ ...values, finishedAt: new Date() })
    .where(eq(runs.id, runId));
}

/** Earlier successful turns as prompt → summary pairs (ADR-015). */
async function loadPriorTurns(db: Db, projectId: string, currentRunId: string): Promise<PriorTurn[]> {
  const rows = await db
    .select({ runId: runs.id, summary: runs.summary, prompt: messages.content })
    .from(runs)
    .innerJoin(messages, and(eq(messages.runId, runs.id), eq(messages.role, "user")))
    .where(and(eq(runs.projectId, projectId), eq(runs.status, "succeeded")))
    .orderBy(asc(runs.createdAt));
  return rows
    .filter((r) => r.runId !== currentRunId)
    .map((r) => ({ prompt: r.prompt, summary: r.summary ?? "" }));
}
