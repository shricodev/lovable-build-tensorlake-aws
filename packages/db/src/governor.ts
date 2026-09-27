import { and, asc, eq, inArray, lt, notInArray, sql } from "drizzle-orm";
import type { Db } from "./client";
import { appendEvent } from "./events";
import { runs, sandboxes } from "./schema";

/** Sandbox states that occupy a concurrency slot on Tensorlake. */
const LIVE = ["running", "waking", "creating"] as const;
const LOCK_KEY = 7_411_001; // arbitrary constant for pg_advisory_xact_lock

export function concurrencyLimit(): number {
  return Math.max(1, Number(process.env.SANDBOX_CONCURRENCY_LIMIT ?? 1));
}

type Decision =
  | { kind: "ok" }
  | { kind: "evict"; tensorlakeId: string; projectId: string }
  | { kind: "wait"; position: number };

/**
 * Decide, under a global advisory lock, whether `projectId` may run a sandbox
 * now. Frees a slot by picking the least-recently-active sandbox that isn't
 * busy with an agent run; the caller suspends it outside the lock.
 */
async function decide(db: Db, projectId: string, waitingSince: Date | null): Promise<Decision> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_KEY})`);
    const live = await tx
      .select({ projectId: sandboxes.projectId, tensorlakeId: sandboxes.tensorlakeId, rowId: sandboxes.id })
      .from(sandboxes)
      .where(inArray(sandboxes.status, [...LIVE]))
      .orderBy(asc(sandboxes.lastActiveAt));
    if (live.some((s) => s.projectId === projectId)) return { kind: "ok" };

    // FIFO: runs that started waiting before us get the next free slot first.
    const ahead = waitingSince
      ? await tx
          .select({ id: runs.id, projectId: runs.projectId })
          .from(runs)
          .where(
            and(
              eq(runs.status, "running"),
              lt(runs.startedAt, waitingSince),
              live.length
                ? notInArray(
                    runs.projectId,
                    live.map((s) => s.projectId),
                  )
                : undefined,
            ),
          )
      : [];
    const position = ahead.filter((r) => r.projectId !== projectId).length + 1;

    if (live.length < concurrencyLimit() && position === 1) return { kind: "ok" };

    const busy = new Set(
      (
        await tx
          .select({ projectId: runs.projectId })
          .from(runs)
          .where(inArray(runs.status, ["queued", "running"]))
      ).map((r) => r.projectId),
    );
    const victim = position === 1 ? live.find((s) => !busy.has(s.projectId)) : undefined;
    if (victim) {
      await tx.update(sandboxes).set({ status: "suspended" }).where(eq(sandboxes.id, victim.rowId));
      return { kind: "evict", tensorlakeId: victim.tensorlakeId, projectId: victim.projectId };
    }
    return { kind: "wait", position };
  });
}

/**
 * Block until the project may run a sandbox. Emits `queue` events with the
 * current position so the UI can show "waiting for a free sandbox (#2)".
 */
export async function acquireSlot(
  db: Db,
  opts: {
    projectId: string;
    runId?: string;
    waitingSince?: Date;
    suspend: (tensorlakeId: string) => Promise<void>;
    signal?: AbortSignal;
  },
): Promise<void> {
  let lastPosition = 0;
  for (;;) {
    opts.signal?.throwIfAborted();
    const d = await decide(db, opts.projectId, opts.waitingSince ?? null);
    if (d.kind === "ok") break;
    if (d.kind === "evict") {
      await opts.suspend(d.tensorlakeId).catch(() => {});
      await appendEvent(db, {
        projectId: d.projectId,
        type: "sandbox_status",
        payload: { status: "suspended", reason: "slot_reclaimed" },
      });
      continue;
    }
    if (d.position !== lastPosition) {
      lastPosition = d.position;
      await appendEvent(db, {
        projectId: opts.projectId,
        runId: opts.runId,
        type: "queue",
        payload: { position: d.position, limit: concurrencyLimit() },
      });
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (lastPosition) {
    await appendEvent(db, {
      projectId: opts.projectId,
      runId: opts.runId,
      type: "queue",
      payload: { position: 0 },
    });
  }
}

/** Non-blocking variant for preview wake-ups: true if a slot is (or was made) available. */
export async function tryAcquireSlot(
  db: Db,
  projectId: string,
  suspend: (tensorlakeId: string) => Promise<void>,
): Promise<boolean> {
  for (let i = 0; i < 3; i++) {
    const d = await decide(db, projectId, null);
    if (d.kind === "ok") return true;
    if (d.kind === "wait") return false;
    await suspend(d.tensorlakeId).catch(() => {});
    await appendEvent(db, {
      projectId: d.projectId,
      type: "sandbox_status",
      payload: { status: "suspended", reason: "slot_reclaimed" },
    });
  }
  return false;
}
