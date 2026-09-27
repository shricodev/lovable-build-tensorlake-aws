/**
 * Spike 05: exposed ports, auth on the port URL, suspend/resume timing, and
 * whether an HTTP request to a suspended sandbox's port wakes it up.
 * This decides how the Preview Gateway works.
 */
import { Sandbox, SandboxClient } from "tensorlake";
import { enc, spike, uniq, waitForStatus } from "./lib";

const s = spike("05-suspend-ports");
const apiKey = process.env.TENSORLAKE_API_KEY!;

const server = `
import http.server, os, time
started = time.time()
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = f"pid={os.getpid()} up={time.time()-started:.1f}s host={self.headers.get('host')}".encode()
        self.send_response(200); self.send_header("content-type","text/plain"); self.send_header("content-length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(("0.0.0.0", 8080), H).serve_forever()
`;

async function get(url: string, auth: boolean) {
  const t0 = performance.now();
  const res = await fetch(url, {
    headers: auth ? { authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(90_000),
  });
  return {
    status: res.status,
    body: (await res.text()).slice(0, 200),
    ms: Math.round(performance.now() - t0),
  };
}

await s.run(async () => {
  const name = uniq("kiln-spike05");
  const sb = s.track((await s.step("create named", () => Sandbox.create({ name, timeoutSecs: 600 })))!);
  await sb.writeFile("/home/tl-user/server.py", enc.encode(server));
  await s.step("start managed server with health check", () =>
    sb.startProcess("python3", {
      args: ["/home/tl-user/server.py"],
      name: "web",
      restart: { policy: "always" },
      healthCheck: { type: "http", port: 8080, path: "/" },
    }),
  );

  const info = await s.step("expose port 8080 (auth required)", () =>
    sb.update({ exposedPorts: [8080], allowUnauthenticatedAccess: false }),
  );
  s.note("exposedPorts", info?.exposedPorts);
  const host = new URL(info!.sandboxUrl!).host; // <id>.sandbox.tensorlake.ai
  const byId = `https://8080-${host}/`;
  const byName = `https://8080-${name}.${host.split(".").slice(1).join(".")}/`;
  s.note("portUrlById", byId);
  s.note("portUrlByName", byName);

  await new Promise((r) => setTimeout(r, 1500));
  s.note("GET with bearer (id)", await s.step("GET port URL with bearer", () => get(byId, true)));
  s.note(
    "GET with bearer (name)",
    await s.step("GET port URL by name", () => get(byName, true), { allowFail: true }),
  );
  s.note("GET without auth", await s.step("GET port URL without auth", () => get(byId, false)));

  const client = new SandboxClient();
  const access = await s.step("getPortAccess", () => client.getPortAccess(sb.sandboxId));
  s.note("portAccess", access);

  await s.step("suspend()", () => sb.suspend());
  s.note("statusAfterSuspend", await sb.status());

  const wake = await s.step("GET port URL while suspended (auto-wake?)", () => get(byId, true), {
    allowFail: true,
  });
  s.note("autoWakeResult", wake);
  s.note("statusAfterWakeAttempt", await sb.status());

  if ((await sb.status()) !== "running") {
    await s.step("explicit resume()", () => sb.resume());
  }
  s.note("afterResume GET", await s.step("GET after wake/resume", () => get(byId, true)));

  // Second cycle: explicit suspend/resume timing, and processes survive?
  await s.step("suspend() #2", () => sb.suspend());
  await s.step("resume() #2", () => sb.resume());
  s.note("processAfterResume", (await sb.getProcess("web")).status);
  await waitForStatus(sb, ["running"]);
});
