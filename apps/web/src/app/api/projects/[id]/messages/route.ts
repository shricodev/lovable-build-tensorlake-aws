import { NextResponse } from "next/server";
import { z } from "zod";
import { isCoderModel } from "@/lib/models";
import { ownedProject, parseBody, route } from "@/server/api";
import { startTurn } from "@/server/runs";

const Body = z.object({
  prompt: z.string().trim().min(1).max(8000),
  model: z.string().refine(isCoderModel, "Unsupported model").optional(),
});

export const POST = route<RouteContext<"/api/projects/[id]/messages">>(async (req, ctx, user) => {
  const p = await ownedProject(user.id, (await ctx.params).id);
  const body = await parseBody(req, Body);
  const run = await startTurn({ projectId: p.id, userId: user.id, prompt: body.prompt, model: body.model });
  return NextResponse.json({ runId: run.id }, { status: 201 });
});
