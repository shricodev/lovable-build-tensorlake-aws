import { getDb, projectQuotaExceeded, projects } from "@kiln/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError, parseBody, route } from "@/server/api";
import { startTurn } from "@/server/runs";

const Body = z.object({
  prompt: z.string().trim().min(3).max(8000),
  name: z.string().trim().max(80).optional(),
});

function nameFromPrompt(prompt: string) {
  const first = prompt
    .split(/[.\n:]/)[0]!
    .replace(/^(a|an|the|build|make|create)\s+/i, "")
    .trim();
  const words = first.split(/\s+/).slice(0, 5).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1) || "Untitled app";
}

export const POST = route(async (req, _ctx, user) => {
  const body = await parseBody(req, Body);
  const overProjects = await projectQuotaExceeded(getDb().db, user.id);
  if (overProjects) throw new HttpError(429, overProjects);
  const [p] = await getDb()
    .db.insert(projects)
    .values({ ownerId: user.id, name: body.name || nameFromPrompt(body.prompt) })
    .returning();
  await startTurn({ projectId: p!.id, userId: user.id, prompt: body.prompt });
  return NextResponse.json({ id: p!.id }, { status: 201 });
});
