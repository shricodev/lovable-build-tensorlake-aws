import { randomUUID } from "node:crypto";
import { storageKeys } from "@lovable-diy/storage";
import { NextResponse } from "next/server";
import { HttpError, ownedProject, route } from "@/server/api";
import { projectSandbox } from "@/server/sandbox";
import { storage } from "@/server/storage";

/**
 * Zip the project source (including edits not saved as a version yet) and
 * return a 15-minute download link. The bucket stays private.
 */
export const POST = route<RouteContext<"/api/projects/[id]/export">>(async (_req, ctx, user) => {
  const p = await ownedProject(user.id, (await ctx.params).id);
  const ps = await projectSandbox(p.id);
  const name =
    p.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "app";
  const r = await ps.exec(
    `ref=$(git stash create 2>/dev/null); git archive --format=zip --prefix="$NAME/" -o /tmp/lovable-diy-export.zip "\${ref:-HEAD}"`,
    { env: { NAME: name }, timeoutSecs: 60 },
  );
  if (r.exitCode !== 0) throw new HttpError(500, "Couldn't package the project");
  const zip = await ps.sb.readFile("/tmp/lovable-diy-export.zip");
  const key = storageKeys.export(p.id, randomUUID());
  await storage().put(key, zip, "application/zip");
  const url = await storage().presignGet(key, 900, `${name}.zip`);
  return NextResponse.json({ url, bytes: zip.length });
});
