import "server-only";
import { EventEmitter } from "node:events";
import { EVENTS_CHANNEL, getDb } from "@kiln/db";

/**
 * One LISTEN connection per web process, fanned out to every open SSE
 * stream through an in-memory emitter keyed by project id.
 */
const g = globalThis as unknown as { __kilnBus?: Promise<EventEmitter> };

export function eventBus(): Promise<EventEmitter> {
  g.__kilnBus ??= (async () => {
    const bus = new EventEmitter();
    bus.setMaxListeners(0);
    await getDb().sql.listen(EVENTS_CHANNEL, (payload) => {
      try {
        const { projectId, id } = JSON.parse(payload) as { projectId: string; id: number };
        bus.emit(projectId, id);
      } catch {
        /* ignore malformed notifications */
      }
    });
    return bus;
  })();
  return g.__kilnBus;
}
