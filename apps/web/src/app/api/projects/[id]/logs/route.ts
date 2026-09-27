import { NextResponse } from "next/server";
import { ownedProject, route } from "@/server/api";
import { projectSandbox } from "@/server/sandbox";

export const GET = route<RouteContext<"/api/projects/[id]/logs">>(async (_req, ctx, user) => {
  const p = await ownedProject(user.id, (await ctx.params).id);
  const logs = await (await projectSandbox(p.id)).devServerLogs(300);
  return NextResponse.json({ logs });
});
