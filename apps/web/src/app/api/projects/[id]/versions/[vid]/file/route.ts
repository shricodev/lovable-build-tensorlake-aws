import { fileAt } from "@lovable-diy/sandbox";
import { NextResponse } from "next/server";
import { HttpError, ownedProject, route } from "@/server/api";
import { projectSandbox } from "@/server/sandbox";
import { getVersion } from "@/server/versions";

/** Before/after content of one file for the diff editor. */
export const GET = route<RouteContext<"/api/projects/[id]/versions/[vid]/file">>(async (req, ctx, user) => {
  const { id, vid } = await ctx.params;
  const p = await ownedProject(user.id, id);
  const v = await getVersion(p.id, vid);
  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  const base = url.searchParams.get("base");
  if (!path || !base || !/^[0-9a-f]{7,40}$/.test(base))
    throw new HttpError(400, "path and base are required");
  const ps = await projectSandbox(p.id);
  const [before, after] = await Promise.all([fileAt(ps, base, path), fileAt(ps, v.commitSha, path)]);
  return NextResponse.json({ path, before, after });
});
