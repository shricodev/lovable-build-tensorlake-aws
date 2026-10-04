import { and, eq, getDb, inArray, runs } from "@lovable-diy/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError, ownedProject, parseBody, route } from "@/server/api";
import { projectSandbox } from "@/server/sandbox";

type Ctx = RouteContext<"/api/projects/[id]/files/content">;

export const GET = route<Ctx>(async (req, ctx, user) => {
  const p = await ownedProject(user.id, (await ctx.params).id);
  const path = new URL(req.url).searchParams.get("path");
  if (!path) throw new HttpError(400, "path is required");
  const content = await (await projectSandbox(p.id)).readFile(path);
  return NextResponse.json({ path, content });
});

/** Manual edits write straight into the sandbox; Vite hot-reloads them. Blocked while the agent works. */
export const PUT = route<Ctx>(async (req, ctx, user) => {
  const p = await ownedProject(user.id, (await ctx.params).id);
  const body = await parseBody(
    req,
    z.object({ path: z.string().min(1).max(512), content: z.string().max(512 * 1024) }),
  );
  const busy = await getDb()
    .db.select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.projectId, p.id), inArray(runs.status, ["queued", "running"])));
  if (busy.length) throw new HttpError(409, "The agent is working; editing is paused until it finishes.");
  await (await projectSandbox(p.id)).writeFile(body.path, body.content);
  return NextResponse.json({ ok: true });
});
