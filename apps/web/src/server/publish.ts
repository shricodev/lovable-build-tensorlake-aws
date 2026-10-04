import "server-only";
import { desc, eq, getDb, publishedSites, versions, type Project } from "@lovable-diy/db";
import { cacheControlFor, contentTypeFor, storageKeys } from "@lovable-diy/storage";
import { HttpError } from "./api";
import { projectSandbox } from "./sandbox";
import { storage } from "./storage";

const MAX_FILES = 300;

export function publishedUrl(slug: string) {
  const proto = process.env.PREVIEW_PROTOCOL ?? "http";
  return `${proto}://${slug}.${process.env.PUBLISHED_BASE_DOMAIN ?? "app.localhost:4000"}/`;
}

function slugFor(p: Project) {
  const base =
    p.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 32) || "app";
  return `${base}-${p.id.slice(0, 6)}`;
}

/**
 * Build the app in its sandbox, upload dist/ to S3 under
 * published/<slug>/<version>/, and point the site at it. The site is then
 * served from S3, so it keeps working while the sandbox sleeps or is gone.
 */
export async function publish(project: Project) {
  const { db } = getDb();
  const ps = await projectSandbox(project.id);
  const build = await ps.exec(
    "rm -rf dist && npx vite build --outDir dist --emptyOutDir --logLevel error 2>&1",
    {
      timeoutSecs: 180,
      maxOutput: 100_000,
    },
  );
  if (build.exitCode !== 0) {
    throw new HttpError(422, `The build failed, so nothing was published:\n${build.stdout.slice(-1500)}`);
  }
  const listing = await ps.exec("cd dist && find . -type f -printf '%P\\n'", {
    timeoutSecs: 20,
    maxOutput: 100_000,
  });
  const files = listing.stdout.trim().split("\n").filter(Boolean);
  if (!files.includes("index.html")) throw new HttpError(422, "The build produced no index.html.");
  if (files.length > MAX_FILES) throw new HttpError(422, `Too many files to publish (${files.length}).`);

  const [latest] = await db
    .select({ id: versions.id, number: versions.number })
    .from(versions)
    .where(eq(versions.projectId, project.id))
    .orderBy(desc(versions.number))
    .limit(1);
  const [existing] = await db.select().from(publishedSites).where(eq(publishedSites.projectId, project.id));
  const slug = existing?.slug ?? slugFor(project);
  const prefix = storageKeys.publishedPrefix(slug, latest?.id ?? `draft-${Date.now()}`);

  const s3 = storage();
  for (let i = 0; i < files.length; i += 4) {
    await Promise.all(
      files.slice(i, i + 4).map(async (f) => {
        const bytes = await ps.readBytes(`dist/${f}`);
        await s3.put(prefix + f, bytes, contentTypeFor(f), cacheControlFor(f));
      }),
    );
  }

  const values = {
    projectId: project.id,
    slug,
    versionId: latest?.id ?? null,
    s3Prefix: prefix,
    fileCount: files.length,
    publishedAt: new Date(),
  };
  await db
    .insert(publishedSites)
    .values(values)
    .onConflictDoUpdate({ target: publishedSites.projectId, set: values });
  if (existing && existing.s3Prefix !== prefix) await s3.deletePrefix(existing.s3Prefix).catch(() => {});
  return { url: publishedUrl(slug), slug, version: latest?.number ?? null, files: files.length };
}

export async function unpublish(projectId: string) {
  const { db } = getDb();
  const [site] = await db.delete(publishedSites).where(eq(publishedSites.projectId, projectId)).returning();
  if (site)
    await storage()
      .deletePrefix(site.s3Prefix)
      .catch(() => {});
}
