import type { IncomingMessage, ServerResponse } from "node:http";
import type { Readable } from "node:stream";
import { eq, getDb, publishedSites } from "@lovable-diy/db";
import { contentTypeFor, Storage } from "@lovable-diy/storage";
import type { Logger } from "@lovable-diy/shared";
import { notFoundPage } from "./pages";

export const PUBLISHED_HOST_RE = /^([a-z0-9][a-z0-9-]{0,62})\.app\./i;

let storage: Storage | null = null;
const sites = new Map<string, { prefix: string | null; at: number }>();

async function prefixFor(slug: string) {
  const hit = sites.get(slug);
  if (hit && Date.now() - hit.at < 10_000) return hit.prefix;
  const [row] = await getDb().db.select().from(publishedSites).where(eq(publishedSites.slug, slug));
  sites.set(slug, { prefix: row?.s3Prefix ?? null, at: Date.now() });
  return row?.s3Prefix ?? null;
}

/**
 * Published sites are static files in the private bucket, served here on
 * their own origin (<slug>.app.<domain>) so they're isolated from the app
 * and from each other. Unknown paths without an extension fall back to
 * index.html for client-side routing.
 */
export async function servePublished(slug: string, req: IncomingMessage, res: ServerResponse, log: Logger) {
  const prefix = await prefixFor(slug.toLowerCase());
  if (!prefix) {
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" }).end(notFoundPage());
    return;
  }
  storage ??= new Storage();
  const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname).replace(/^\/+/, "");
  if (path.split("/").includes("..")) {
    res.writeHead(400).end();
    return;
  }
  const candidates =
    !path || path.endsWith("/") ? [`${path}index.html`] : /\.\w+$/.test(path) ? [path] : [path, "index.html"];
  for (const key of candidates) {
    try {
      const obj = await storage.get(prefix + key);
      res.writeHead(200, {
        "content-type": obj.ContentType ?? contentTypeFor(key),
        "cache-control": obj.CacheControl ?? "public, max-age=0, must-revalidate",
        "x-content-type-options": "nosniff",
        ...(obj.ContentLength ? { "content-length": String(obj.ContentLength) } : {}),
      });
      if (req.method === "HEAD") return void res.end();
      (obj.Body as Readable).pipe(res);
      return;
    } catch (err) {
      if ((err as { name?: string }).name !== "NoSuchKey") {
        log.warn({ err, slug, key }, "published fetch failed");
        res.writeHead(502).end("upstream error");
        return;
      }
    }
  }
  res.writeHead(404, { "content-type": "text/html; charset=utf-8" }).end(notFoundPage());
}
