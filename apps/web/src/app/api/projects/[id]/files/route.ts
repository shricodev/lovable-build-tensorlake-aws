import { NextResponse } from "next/server";
import { ownedProject, route } from "@/server/api";
import { projectSandbox } from "@/server/sandbox";

export const GET = route<RouteContext<"/api/projects/[id]/files">>(async (_req, ctx, user) => {
  const p = await ownedProject(user.id, (await ctx.params).id);
  const files = await (await projectSandbox(p.id)).listFiles(".", 1000);
  return NextResponse.json({ files });
});
