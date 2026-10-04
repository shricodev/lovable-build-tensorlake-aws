import { and, enqueueCloneProject, eq, getDb, isNull, or, projectQuotaExceeded, projects } from "@lovable-diy/db";
import { NextResponse } from "next/server";
import { HttpError, route } from "@/server/api";

/** Copy a project you own (duplicate) or one shared with a link (remix) into your account. */
export const POST = route<RouteContext<"/api/projects/[id]/remix">>(async (_req, ctx, user) => {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "Project not found");
  const { db } = getDb();
  const overProjects = await projectQuotaExceeded(getDb().db, user.id);
  if (overProjects) throw new HttpError(429, overProjects);
  const [source] = await db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.id, id),
        isNull(projects.deletedAt),
        or(eq(projects.ownerId, user.id), eq(projects.visibility, "shared")),
      ),
    );
  if (!source) throw new HttpError(404, "Project not found");
  const [copy] = await db
    .insert(projects)
    .values({
      ownerId: user.id,
      name: source.ownerId === user.id ? `${source.name} (copy)` : `${source.name} (remix)`,
      remixedFrom: source.id,
      thumbnailKey: source.thumbnailKey,
    })
    .returning();
  await enqueueCloneProject({ sourceProjectId: source.id, targetProjectId: copy!.id });
  return NextResponse.json({ id: copy!.id }, { status: 201 });
});
