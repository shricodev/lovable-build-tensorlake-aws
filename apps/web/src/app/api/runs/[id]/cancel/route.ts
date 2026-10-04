import { CANCEL_CHANNEL, and, eq, getDb, inArray, runs } from "@lovable-diy/db";
import { NextResponse } from "next/server";
import { HttpError, ownedProject, route } from "@/server/api";

export const POST = route<RouteContext<"/api/runs/[id]/cancel">>(async (_req, ctx, user) => {
  const { id } = await ctx.params;
  const { db, sql } = getDb();
  const [run] = await db.select().from(runs).where(eq(runs.id, id));
  if (!run) throw new HttpError(404, "Run not found");
  await ownedProject(user.id, run.projectId);
  if (run.status === "queued") {
    // Not picked up yet: mark it cancelled; the worker skips non-queued runs.
    await db
      .update(runs)
      .set({ status: "cancelled", finishedAt: new Date() })
      .where(and(eq(runs.id, id), inArray(runs.status, ["queued"])));
  }
  await sql.notify(CANCEL_CHANNEL, id);
  return NextResponse.json({ ok: true });
});
