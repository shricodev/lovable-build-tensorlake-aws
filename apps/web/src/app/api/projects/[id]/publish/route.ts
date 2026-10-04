import { eq, getDb, publishedSites, versions } from "@lovable-diy/db";
import { NextResponse } from "next/server";
import { assertIdle, ownedProject, route } from "@/server/api";
import { publish, publishedUrl, unpublish } from "@/server/publish";

type Ctx = RouteContext<"/api/projects/[id]/publish">;

export const GET = route<Ctx>(async (_req, ctx, user) => {
  const p = await ownedProject(user.id, (await ctx.params).id);
  const { db } = getDb();
  const [row] = await db
    .select({ site: publishedSites, number: versions.number })
    .from(publishedSites)
    .leftJoin(versions, eq(versions.id, publishedSites.versionId))
    .where(eq(publishedSites.projectId, p.id));
  if (!row) return NextResponse.json({ published: null });
  return NextResponse.json({
    published: { url: publishedUrl(row.site.slug), version: row.number, publishedAt: row.site.publishedAt },
  });
});

export const POST = route<Ctx>(async (_req, ctx, user) => {
  const p = await ownedProject(user.id, (await ctx.params).id);
  await assertIdle(p.id);
  return NextResponse.json(await publish(p));
});

export const DELETE = route<Ctx>(async (_req, ctx, user) => {
  const p = await ownedProject(user.id, (await ctx.params).id);
  await unpublish(p.id);
  return NextResponse.json({ ok: true });
});
