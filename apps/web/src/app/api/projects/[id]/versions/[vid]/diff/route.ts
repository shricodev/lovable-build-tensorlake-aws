import { changedFilesBetween } from "@lovable-diy/sandbox";
import { NextResponse } from "next/server";
import { ownedProject, route } from "@/server/api";
import { projectSandbox } from "@/server/sandbox";
import { getVersion, previousVersion } from "@/server/versions";

/** Files changed in a version compared with the version before it. */
export const GET = route<RouteContext<"/api/projects/[id]/versions/[vid]/diff">>(async (_req, ctx, user) => {
  const { id, vid } = await ctx.params;
  const p = await ownedProject(user.id, id);
  const v = await getVersion(p.id, vid);
  const prev = await previousVersion(v);
  const ps = await projectSandbox(p.id);
  const base = prev?.commitSha ?? (await ps.exec("git rev-list --max-parents=0 HEAD")).stdout.trim();
  const files = await changedFilesBetween(ps, base, v.commitSha);
  return NextResponse.json({ from: prev?.number ?? 0, to: v.number, base, head: v.commitSha, files });
});
