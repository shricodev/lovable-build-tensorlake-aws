import { desc, eq, getDb, recordVersion, versions } from "@kiln/db";
import { commitAll } from "@kiln/sandbox";
import { NextResponse } from "next/server";
import { assertIdle, HttpError, ownedProject, route } from "@/server/api";
import { projectSandbox } from "@/server/sandbox";

type Ctx = RouteContext<"/api/projects/[id]/versions">;

export const GET = route<Ctx>(async (_req, ctx, user) => {
  const p = await ownedProject(user.id, (await ctx.params).id);
  const rows = await getDb()
    .db.select()
    .from(versions)
    .where(eq(versions.projectId, p.id))
    .orderBy(desc(versions.number));
  return NextResponse.json({ versions: rows });
});

/** "Save version": commit manual edits made in the code editor. */
export const POST = route<Ctx>(async (_req, ctx, user) => {
  const p = await ownedProject(user.id, (await ctx.params).id);
  await assertIdle(p.id);
  const commit = await commitAll(await projectSandbox(p.id), "Manual edits");
  if (!commit) throw new HttpError(409, "No changes since the last version.");
  const v = await recordVersion(getDb().db, {
    projectId: p.id,
    commitSha: commit.sha,
    source: "manual",
    title: "Manual edits",
    changedFiles: commit.files,
  });
  return NextResponse.json({ version: v }, { status: 201 });
});
