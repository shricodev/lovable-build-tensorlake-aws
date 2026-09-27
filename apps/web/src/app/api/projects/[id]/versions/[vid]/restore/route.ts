import { getDb, recordVersion } from "@kiln/db";
import { commitAll, restoreTree } from "@kiln/sandbox";
import { NextResponse } from "next/server";
import { assertIdle, ownedProject, route } from "@/server/api";
import { projectSandbox } from "@/server/sandbox";
import { getVersion } from "@/server/versions";

/** Roll the app back to a version. History is kept: the restore becomes a new version on top. */
export const POST = route<RouteContext<"/api/projects/[id]/versions/[vid]/restore">>(
  async (_req, ctx, user) => {
    const { id, vid } = await ctx.params;
    const p = await ownedProject(user.id, id);
    await assertIdle(p.id);
    const target = await getVersion(p.id, vid);
    const ps = await projectSandbox(p.id);
    await restoreTree(ps, target.commitSha);
    const title = `Restored version ${target.number}`;
    const commit = await commitAll(ps, title);
    if (!commit) return NextResponse.json({ version: null, unchanged: true });
    const v = await recordVersion(getDb().db, {
      projectId: p.id,
      commitSha: commit.sha,
      source: "restore",
      title,
      changedFiles: commit.files,
      restoredFrom: target.number,
    });
    return NextResponse.json({ version: v }, { status: 201 });
  },
);
