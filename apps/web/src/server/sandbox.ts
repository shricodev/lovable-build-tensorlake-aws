import "server-only";
import { and, appendEvent, eq, getDb, sandboxes, tryAcquireSlot } from "@kiln/db";
import { ProjectSandbox } from "@kiln/sandbox";
import { createLogger } from "@kiln/shared";
import { HttpError } from "./api";

const log = createLogger("web", { transport: undefined });

/**
 * Connect to the project's main sandbox, waking it first if it's asleep.
 * 409 when there isn't one yet, 503 when every sandbox slot is busy.
 */
export async function projectSandbox(projectId: string): Promise<ProjectSandbox> {
  const { db } = getDb();
  const [row] = await db
    .select()
    .from(sandboxes)
    .where(and(eq(sandboxes.projectId, projectId), eq(sandboxes.role, "main")));
  if (!row || row.status === "terminated")
    throw new HttpError(409, "This project has no sandbox yet. Send a prompt first.");
  const ps = await ProjectSandbox.connect(row.tensorlakeId, log);
  if (row.status === "suspended" || row.status === "waking") {
    const ok = await tryAcquireSlot(db, projectId, async (id) =>
      (await ProjectSandbox.connect(id, log)).suspend(),
    );
    if (!ok) throw new HttpError(503, "All sandboxes are busy right now. Try again in a moment.");
    await db.update(sandboxes).set({ status: "waking" }).where(eq(sandboxes.id, row.id));
    await appendEvent(db, { projectId, type: "sandbox_status", payload: { status: "waking" } });
    const ms = await ps.resume();
    await db
      .update(sandboxes)
      .set({ status: "running", lastActiveAt: new Date() })
      .where(eq(sandboxes.id, row.id));
    await appendEvent(db, { projectId, type: "sandbox_status", payload: { status: "running", wakeMs: ms } });
  } else {
    await db.update(sandboxes).set({ lastActiveAt: new Date() }).where(eq(sandboxes.id, row.id));
  }
  return ps;
}
