import { and, asc, desc, eq, getDb, gt, inArray, runEvents, runs } from "@kiln/db";
import { ownedProject, route } from "@/server/api";
import { eventBus } from "@/server/event-bus";

export const dynamic = "force-dynamic";

/**
 * Server-Sent Events for one project. On connect it replays everything after
 * `?after=<event id>`, or, when absent, the whole active run (so a refresh
 * mid-run rebuilds the timeline), then tails new events via LISTEN/NOTIFY.
 */
export const GET = route<RouteContext<"/api/projects/[id]/stream">>(async (req, ctx, user) => {
  const project = await ownedProject(user.id, (await ctx.params).id);
  const { db } = getDb();
  const url = new URL(req.url);
  let cursor = Number(url.searchParams.get("after") ?? NaN);

  if (!Number.isFinite(cursor)) {
    const [active] = await db
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.projectId, project.id), inArray(runs.status, ["queued", "running"])))
      .orderBy(desc(runs.createdAt))
      .limit(1);
    const [first] = active
      ? await db
          .select({ id: runEvents.id })
          .from(runEvents)
          .where(eq(runEvents.runId, active.id))
          .orderBy(asc(runEvents.id))
          .limit(1)
      : [];
    const [last] = await db
      .select({ id: runEvents.id })
      .from(runEvents)
      .where(eq(runEvents.projectId, project.id))
      .orderBy(desc(runEvents.id))
      .limit(1);
    cursor = first ? first.id - 1 : (last?.id ?? 0);
  }

  const bus = await eventBus();
  const enc = new TextEncoder();
  let closed = false;
  let pumping = Promise.resolve();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (s: string) => {
        if (!closed) controller.enqueue(enc.encode(s));
      };
      const pump = () => {
        pumping = pumping.then(async () => {
          const rows = await db
            .select()
            .from(runEvents)
            .where(and(eq(runEvents.projectId, project.id), gt(runEvents.id, cursor)))
            .orderBy(asc(runEvents.id))
            .limit(500);
          for (const r of rows) {
            cursor = r.id;
            send(
              `id: ${r.id}\ndata: ${JSON.stringify({ id: r.id, runId: r.runId, type: r.type, payload: r.payload, at: r.createdAt })}\n\n`,
            );
          }
        });
      };
      const onEvent = () => pump();
      bus.on(project.id, onEvent);
      const ping = setInterval(() => send(": ping\n\n"), 15_000);
      send("retry: 2000\n\n");
      pump();
      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(ping);
        bus.off(project.id, onEvent);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
});
