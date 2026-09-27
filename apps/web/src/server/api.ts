import "server-only";
import { KilnError } from "@kiln/shared";
import { and, eq, getDb, isNull, projects, type Project, type User } from "@kiln/db";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { currentUser } from "./session";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Wrap a route handler: auth, typed errors → JSON, no stack traces to clients. */
export function route<C>(fn: (req: Request, ctx: C, user: User) => Promise<Response>) {
  return async (req: Request, ctx: C) => {
    try {
      const user = await currentUser();
      if (!user) throw new HttpError(401, "Sign in required");
      return await fn(req, ctx, user);
    } catch (err) {
      if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
      if (err instanceof KilnError) {
        console.error(err);
        return NextResponse.json({ error: err.userMessage }, { status: err.retryable ? 503 : 400 });
      }
      console.error(err);
      return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
    }
  };
}

export async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  const json = await req.json().catch(() => {
    throw new HttpError(400, "Invalid JSON body");
  });
  const r = schema.safeParse(json);
  if (!r.success)
    throw new HttpError(400, r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
}

/** Every project access goes through here: 404 (not 403) when it isn't yours. */
export async function ownedProject(userId: string, projectId: string): Promise<Project> {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) throw new HttpError(404, "Project not found");
  const [p] = await getDb()
    .db.select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.ownerId, userId), isNull(projects.deletedAt)));
  if (!p) throw new HttpError(404, "Project not found");
  return p;
}
