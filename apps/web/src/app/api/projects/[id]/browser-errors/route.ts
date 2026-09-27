import { browserErrors, desc, eq, getDb } from "@kiln/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ownedProject, parseBody, route } from "@/server/api";

type Ctx = RouteContext<"/api/projects/[id]/browser-errors">;

const Body = z.object({
  errors: z
    .array(
      z.object({
        kind: z.enum(["error", "unhandledrejection", "console.error"]),
        message: z.string().max(2000),
        stack: z.string().max(4000).optional(),
        url: z.string().max(500).optional(),
      }),
    )
    .min(1)
    .max(20),
});

/** The workspace relays errors the preview posts to it (see kiln/error-capture.ts in the template). */
export const POST = route<Ctx>(async (req, ctx, user) => {
  const p = await ownedProject(user.id, (await ctx.params).id);
  const { errors } = await parseBody(req, Body);
  await getDb()
    .db.insert(browserErrors)
    .values(errors.map((e) => ({ projectId: p.id, ...e })));
  return NextResponse.json({ ok: true });
});

export const GET = route<Ctx>(async (_req, ctx, user) => {
  const p = await ownedProject(user.id, (await ctx.params).id);
  const rows = await getDb()
    .db.select()
    .from(browserErrors)
    .where(eq(browserErrors.projectId, p.id))
    .orderBy(desc(browserErrors.createdAt))
    .limit(100);
  return NextResponse.json({ errors: rows });
});
