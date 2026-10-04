import type { Db } from "./client";
import { runEvents } from "./schema";

/** Postgres channel that announces new rows in run_events: payload `{ projectId, id }`. */
export const EVENTS_CHANNEL = "lovable_diy_events";
/** Channel the web app uses to ask the worker to cancel a run: payload = run id. */
export const CANCEL_CHANNEL = "lovable_diy_cancel";

export async function appendEvent(
  db: Db,
  e: { projectId: string; runId?: string | null; type: string; payload: unknown },
): Promise<number> {
  const [row] = await db
    .insert(runEvents)
    .values({ projectId: e.projectId, runId: e.runId ?? null, type: e.type, payload: e.payload })
    .returning({ id: runEvents.id });
  await db.$client.notify(EVENTS_CHANNEL, JSON.stringify({ projectId: e.projectId, id: row!.id }));
  return row!.id;
}
