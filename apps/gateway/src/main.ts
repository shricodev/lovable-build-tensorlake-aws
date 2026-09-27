/**
 * Preview Gateway. Maps `<projectId>.preview.localhost:4000` to the
 * project's sandbox dev server on the Tensorlake port proxy, adding the API key
 * server-side so sandbox URLs never need to be public. Proxies HTTP and
 * WebSocket (Vite HMR). Runs on its own origin, so a generated app can never
 * read the main app's cookies.
 */
import http from "node:http";
import { and, eq, getDb, projects, sandboxes, isNull } from "@kiln/db";
import { previewUrlFor } from "@kiln/sandbox";
import { createLogger } from "@kiln/shared";
import { createProxyServer } from "http-proxy-3";
import { noPreviewPage, notFoundPage, wakingPage } from "./pages";

const log = createLogger("gateway");
const { db } = getDb();
const PORT = Number(process.env.GATEWAY_PORT ?? 4000);
const API_KEY = process.env.TENSORLAKE_API_KEY ?? "";
const HOST_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.preview\./i;

interface Target {
  sandboxRowId: string | null;
  tensorlakeId: string | null;
  exists: boolean;
  at: number;
}
const cache = new Map<string, Target>();

async function resolve(projectId: string): Promise<Target> {
  const hit = cache.get(projectId);
  if (hit && Date.now() - hit.at < 5_000) return hit;
  const [row] = await db
    .select({
      projectId: projects.id,
      sandboxRowId: sandboxes.id,
      tensorlakeId: sandboxes.tensorlakeId,
      status: sandboxes.status,
    })
    .from(projects)
    .leftJoin(sandboxes, and(eq(sandboxes.projectId, projects.id), eq(sandboxes.role, "main")))
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);
  const t: Target = {
    exists: !!row,
    sandboxRowId: row?.sandboxRowId ?? null,
    tensorlakeId: row && row.status !== "terminated" ? (row.tensorlakeId ?? null) : null,
    at: Date.now(),
  };
  cache.set(projectId, t);
  return t;
}

// Preview traffic counts as activity for idle suspension (Phase 4); throttled.
const touched = new Map<string, number>();
function touch(rowId: string) {
  const now = Date.now();
  if (now - (touched.get(rowId) ?? 0) < 30_000) return;
  touched.set(rowId, now);
  db.update(sandboxes)
    .set({ lastActiveAt: new Date() })
    .where(eq(sandboxes.id, rowId))
    .catch(() => {});
}

const proxy = createProxyServer({ changeOrigin: true, secure: true, ws: true, proxyTimeout: 60_000 });

proxy.on("error", (err, _req, res) => {
  log.warn({ err: err.message }, "proxy error");
  if (res && "writeHead" in res && !res.headersSent) {
    res.writeHead(502, { "content-type": "text/html; charset=utf-8" });
    res.end(wakingPage("The app is starting or restarting. This page retries automatically."));
  } else if (res && "destroy" in res) {
    res.destroy();
  }
});

/** Never forward the visitor's own credentials to the sandbox. */
function scrub(req: http.IncomingMessage) {
  delete req.headers.cookie;
  delete req.headers.authorization;
}

const server = http.createServer(async (req, res) => {
  const m = HOST_RE.exec(req.headers.host ?? "");
  if (!m) {
    res.writeHead(404).end("unknown preview host");
    return;
  }
  const projectId = m[1]!.toLowerCase();
  try {
    const t = await resolve(projectId);
    const send = (code: number, html: string) =>
      res
        .writeHead(code, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" })
        .end(html);
    if (!t.exists) return send(404, notFoundPage());
    if (!t.tensorlakeId) return send(200, noPreviewPage());
    if (t.sandboxRowId) touch(t.sandboxRowId);
    scrub(req);
    proxy.web(req, res, {
      target: previewUrlFor(t.tensorlakeId),
      headers: { authorization: `Bearer ${API_KEY}` },
    });
  } catch (err) {
    log.error({ err }, "gateway request failed");
    res.writeHead(500).end("gateway error");
  }
});

server.on("upgrade", async (req, socket, head) => {
  const m = HOST_RE.exec(req.headers.host ?? "");
  const t = m ? await resolve(m[1]!.toLowerCase()).catch(() => null) : null;
  if (!t?.tensorlakeId) return socket.destroy();
  scrub(req);
  proxy.ws(req, socket, head, {
    target: previewUrlFor(t.tensorlakeId).replace(/^https/, "wss"),
    headers: { authorization: `Bearer ${API_KEY}` },
  });
});

server.listen(PORT, () => log.info(`preview gateway on http://*.preview.localhost:${PORT}`));
