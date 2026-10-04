import { and, appendEvent, eq, getDb, inArray, isNotNull, lt, ne, projects, runs, sandboxes } from "@lovable-diy/db";
import { deleteHostedRepo, ProjectSandbox } from "@lovable-diy/sandbox";
import { readBaseSnapshot } from "@lovable-diy/sandbox/base";
import type { Logger } from "@lovable-diy/shared";

const IDLE_MINUTES = Number(process.env.SANDBOX_IDLE_SUSPEND_MINUTES ?? 10);
const PROJECT_SANDBOX_NAME = /^lovable-diy-[0-9a-f]{8}-/;

/**
 * Runs every minute:
 *  1. suspend main sandboxes idle for IDLE_MINUTES (no run, preview or terminal traffic),
 *  2. terminate sandboxes of deleted projects,
 *  3. reconcile our rows with Tensorlake's real state,
 *  4. terminate orphans (project-named sandboxes we have no row for),
 *  5. delete implicit copy-/suspend- snapshots whose sandbox is gone (they're billed).
 */
export async function reap(log: Logger) {
  const { db } = getDb();
  const busy = new Set(
    (
      await db
        .select({ p: runs.projectId })
        .from(runs)
        .where(inArray(runs.status, ["queued", "running"]))
    ).map((r) => r.p),
  );

  // 1. Idle suspension
  const idle = await db
    .select()
    .from(sandboxes)
    .where(
      and(
        eq(sandboxes.status, "running"),
        lt(sandboxes.lastActiveAt, new Date(Date.now() - IDLE_MINUTES * 60_000)),
      ),
    );
  for (const s of idle.filter((s) => !busy.has(s.projectId))) {
    try {
      await (await ProjectSandbox.connect(s.tensorlakeId, log)).suspend();
      await db.update(sandboxes).set({ status: "suspended" }).where(eq(sandboxes.id, s.id));
      await appendEvent(db, {
        projectId: s.projectId,
        type: "sandbox_status",
        payload: { status: "suspended", reason: "idle" },
      });
      log.info({ sandboxId: s.tensorlakeId }, "suspended idle sandbox");
    } catch (err) {
      log.warn({ err, sandboxId: s.tensorlakeId }, "idle suspend failed");
    }
  }

  // 2. Deleted projects
  const deleted = await db
    .select({ row: sandboxes, repo: projects.gitRepo })
    .from(sandboxes)
    .innerJoin(projects, eq(projects.id, sandboxes.projectId))
    .where(and(isNotNull(projects.deletedAt), ne(sandboxes.status, "terminated")));
  for (const { row, repo } of deleted) {
    await (await ProjectSandbox.connect(row.tensorlakeId, log)).terminate().catch(() => {});
    await db.update(sandboxes).set({ status: "terminated" }).where(eq(sandboxes.id, row.id));
    if (repo) await deleteHostedRepo(repo);
    log.info({ sandboxId: row.tensorlakeId }, "terminated sandbox of deleted project");
  }

  // 3. Reconcile
  const live = await ProjectSandbox.list();
  const byId = new Map(live.map((s) => [s.sandboxId, s]));
  const rows = await db.select().from(sandboxes).where(ne(sandboxes.status, "terminated"));
  for (const r of rows) {
    const tl = byId.get(r.tensorlakeId);
    const actual =
      !tl || tl.status === "terminated" || tl.status === "timeout" || tl.status === "failed"
        ? "terminated"
        : tl.status === "suspended" || tl.status === "suspending"
          ? "suspended"
          : tl.status === "running"
            ? "running"
            : null;
    if (actual && actual !== r.status && !(r.status === "waking" && actual === "suspended")) {
      await db.update(sandboxes).set({ status: actual }).where(eq(sandboxes.id, r.id));
      await appendEvent(db, {
        projectId: r.projectId,
        type: "sandbox_status",
        payload: { status: actual, reason: "reconciled" },
      });
    }
  }

  // 4. Orphans (older than 15 minutes, so we never race a create in flight)
  const known = new Set(rows.map((r) => r.tensorlakeId));
  for (const s of live) {
    const old = s.createdAt ? Date.now() - s.createdAt.getTime() > 15 * 60_000 : false;
    if (
      s.name &&
      PROJECT_SANDBOX_NAME.test(s.name) &&
      !known.has(s.sandboxId) &&
      old &&
      s.status !== "terminated"
    ) {
      await (await ProjectSandbox.connect(s.sandboxId, log)).terminate().catch(() => {});
      log.info({ sandboxId: s.sandboxId, name: s.name }, "terminated orphan sandbox");
    }
  }

  // 5. Implicit snapshots of sandboxes that no longer exist
  const alive = new Set(live.filter((s) => s.status !== "terminated").map((s) => s.sandboxId));
  const base = readBaseSnapshot()?.snapshotId;
  for (const snap of await ProjectSandbox.listSnapshots()) {
    const implicit = /^(copy|suspend)-/.test(snap.snapshotId);
    if (implicit && snap.snapshotId !== base && !alive.has(snap.sandboxId)) {
      await ProjectSandbox.deleteSnapshot(snap.snapshotId).catch(() => {});
    }
  }
}
