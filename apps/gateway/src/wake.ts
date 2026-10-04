import { appendEvent, eq, getDb, sandboxes, tryAcquireSlot } from "@lovable-diy/db";
import { ProjectSandbox } from "@lovable-diy/sandbox";
import type { Logger } from "@lovable-diy/shared";

const inflight = new Map<string, Promise<"running" | "busy" | "failed">>();

/**
 * Resume a project's suspended main sandbox (deduplicated per project).
 * Respects the concurrency limit: may suspend another idle sandbox first,
 * or report "busy" when every slot is taken by active work.
 */
export function wake(projectId: string, row: { id: string; tensorlakeId: string }, log: Logger) {
  let p = inflight.get(projectId);
  if (!p) {
    p = (async () => {
      const { db } = getDb();
      const ok = await tryAcquireSlot(db, projectId, async (id) =>
        (await ProjectSandbox.connect(id, log)).suspend(),
      );
      if (!ok) return "busy" as const;
      await db.update(sandboxes).set({ status: "waking" }).where(eq(sandboxes.id, row.id));
      await appendEvent(db, { projectId, type: "sandbox_status", payload: { status: "waking" } });
      try {
        const ms = await (await ProjectSandbox.connect(row.tensorlakeId, log)).resume();
        await db
          .update(sandboxes)
          .set({ status: "running", lastActiveAt: new Date() })
          .where(eq(sandboxes.id, row.id));
        await appendEvent(db, {
          projectId,
          type: "sandbox_status",
          payload: { status: "running", wakeMs: ms },
        });
        log.info({ projectId, wakeMs: ms }, "sandbox woke up");
        return "running" as const;
      } catch (err) {
        log.warn({ err, projectId }, "wake failed");
        await db.update(sandboxes).set({ status: "suspended" }).where(eq(sandboxes.id, row.id));
        return "failed" as const;
      }
    })().finally(() => setTimeout(() => inflight.delete(projectId), 1000));
    inflight.set(projectId, p);
  }
  return p;
}
