import "server-only";
import { EventEmitter } from "node:events";
import { EVENTS_CHANNEL, getDb } from "@lovable-diy/db";

/**
 * One LISTEN connection per web process, fanned out to every open SSE
 * stream through an in-memory emitter keyed by project id.
 */
const g = globalThis as unknown as { __lovableDiyBus?: Promise<EventEmitter> };

export function eventBus(): Promise<EventEmitter> {
  g.__lovableDiyBus ??= (async () => {
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
  return g.__lovableDiyBus;
}
