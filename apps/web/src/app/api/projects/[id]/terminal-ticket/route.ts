import { signTicket } from "@kiln/shared";
import { NextResponse } from "next/server";
import { ownedProject, route } from "@/server/api";

/** A 60-second ticket the browser uses to open the terminal socket on the gateway. */
export const GET = route<RouteContext<"/api/projects/[id]/terminal-ticket">>(async (_req, ctx, user) => {
  const p = await ownedProject(user.id, (await ctx.params).id);
  const base = (process.env.GATEWAY_PUBLIC_URL ?? "http://localhost:4000").replace(/^http/, "ws");
  return NextResponse.json({
    url: `${base}/__kiln/terminal?ticket=${signTicket({ projectId: p.id, userId: user.id })}`,
  });
});
