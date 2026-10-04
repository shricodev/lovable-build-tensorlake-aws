import { eq, getDb, projects } from "@lovable-diy/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ownedProject, parseBody, route } from "@/server/api";

type Ctx = RouteContext<"/api/projects/[id]">;

export const PATCH = route<Ctx>(async (req, ctx, user) => {
  const p = await ownedProject(user.id, (await ctx.params).id);
  const body = await parseBody(
    req,
    z.object({
      name: z.string().trim().min(1).max(80).optional(),
      visibility: z.enum(["private", "shared"]).optional(),
    }),
  );
  await getDb()
    .db.update(projects)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(projects.id, p.id));
  return NextResponse.json({ ok: true });
});

/** Soft delete; the reaper (Phase 4) terminates the sandbox. */
export const DELETE = route<Ctx>(async (_req, ctx, user) => {
  const p = await ownedProject(user.id, (await ctx.params).id);
  await getDb().db.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, p.id));
  return NextResponse.json({ ok: true });
});
