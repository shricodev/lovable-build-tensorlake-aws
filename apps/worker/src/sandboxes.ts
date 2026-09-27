import { acquireSlot, appendEvent, and, eq, sandboxes, type Db } from "@kiln/db";
import { ProjectSandbox } from "@kiln/sandbox";
import { readBaseSnapshot } from "@kiln/sandbox/base";
import type { Logger } from "@kiln/shared";

type Status = (typeof sandboxes.$inferSelect)["status"];

async function setStatus(
  db: Db,
  projectId: string,
  rowId: string,
  status: Status,
  extra: Record<string, unknown> = {},
) {
  await db.update(sandboxes).set({ status, lastActiveAt: new Date() }).where(eq(sandboxes.id, rowId));
  await appendEvent(db, { projectId, type: "sandbox_status", payload: { status, ...extra } });
}

/**
 * Return a running main sandbox for the project: reuse it, wake it if
 * suspended, or create one from the warm base snapshot.
 */
export async function ensureMainSandbox(
  db: Db,
  projectId: string,
  log: Logger,
  opts: { runId?: string; waitingSince?: Date; signal?: AbortSignal } = {},
): Promise<ProjectSandbox> {
  // Respect SANDBOX_CONCURRENCY_LIMIT: may suspend an idle sandbox or wait in line.
  await acquireSlot(db, {
    projectId,
    runId: opts.runId,
    waitingSince: opts.waitingSince,
    signal: opts.signal,
    suspend: async (id) => (await ProjectSandbox.connect(id, log)).suspend(),
  });

  const [row] = await db
    .select()
    .from(sandboxes)
    .where(and(eq(sandboxes.projectId, projectId), eq(sandboxes.role, "main")))
    .limit(1);

  if (row && row.status !== "terminated") {
    const ps = await ProjectSandbox.connect(row.tensorlakeId, log);
    const state = await ps.state().catch(() => "terminated" as const);
    if (state === "running") {
      if (row.status !== "running") await setStatus(db, projectId, row.id, "running");
      return ps;
    }
    if (state === "suspended") {
      await setStatus(db, projectId, row.id, "waking");
      const ms = await ps.resume();
      await setStatus(db, projectId, row.id, "running", { wakeMs: ms });
      return ps;
    }
    // Gone on the Tensorlake side: fall through and create a fresh one.
    await db.update(sandboxes).set({ status: "terminated" }).where(eq(sandboxes.id, row.id));
    if (row) await db.delete(sandboxes).where(eq(sandboxes.id, row.id));
  }

  const base = readBaseSnapshot();
  if (!base) throw new Error("No base snapshot. Run `pnpm sandbox:build-base`.");
  await appendEvent(db, { projectId, type: "sandbox_status", payload: { status: "creating" } });
  const t0 = performance.now();
  const ps = await ProjectSandbox.createFromSnapshot({
    snapshotId: base.snapshotId,
    name: `kiln-${projectId.slice(0, 8)}-${Date.now().toString(36)}`,
    log,
    idleTimeoutSecs: Number(process.env.SANDBOX_IDLE_TIMEOUT_SECS ?? 600),
  });
  const [created] = await db
    .insert(sandboxes)
    .values({ projectId, tensorlakeId: ps.id, role: "main", status: "running" })
    .returning();
  await appendEvent(db, {
    projectId,
    type: "sandbox_status",
    payload: { status: "running", createdMs: Math.round(performance.now() - t0) },
  });
  log.info({ sandboxId: ps.id, rowId: created!.id }, "main sandbox created");
  return ps;
}
