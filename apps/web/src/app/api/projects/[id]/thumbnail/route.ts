import { and, eq, getDb, projects, versions } from "@lovable-diy/db";
import { storageKeys } from "@lovable-diy/storage";
import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError, ownedProject, parseBody, route } from "@/server/api";
import { storage } from "@/server/storage";

type Ctx = RouteContext<"/api/projects/[id]/thumbnail">;

const Body = z.object({
  versionId: z.string().uuid(),
  dataUrl: z.string().max(3_000_000).startsWith("data:image/jpeg;base64,"),
});

/** The workspace captures the preview after each version and uploads it here. */
export const POST = route<Ctx>(async (req, ctx, user) => {
  const p = await ownedProject(user.id, (await ctx.params).id);
  const { versionId, dataUrl } = await parseBody(req, Body);
  const { db } = getDb();
  const [v] = await db
    .select()
    .from(versions)
    .where(and(eq(versions.id, versionId), eq(versions.projectId, p.id)));
  if (!v) throw new HttpError(404, "Version not found");
  const key = storageKeys.screenshot(p.id, v.id).replace(/\.png$/, ".jpg");
  await storage().put(key, Buffer.from(dataUrl.split(",")[1]!, "base64"), "image/jpeg");
  await db.update(versions).set({ screenshotKey: key }).where(eq(versions.id, v.id));
  await db.update(projects).set({ thumbnailKey: key }).where(eq(projects.id, p.id));
  return NextResponse.json({ ok: true });
});

export const GET = route<Ctx>(async (_req, ctx, user) => {
  const p = await ownedProject(user.id, (await ctx.params).id);
  if (!p.thumbnailKey) throw new HttpError(404, "No thumbnail yet");
  const bytes = await storage().getBytes(p.thumbnailKey);
  return new Response(Buffer.from(bytes), {
    headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=30" },
  });
});
