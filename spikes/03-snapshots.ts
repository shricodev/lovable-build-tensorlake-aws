/**
 * Spike 03: memory vs filesystem checkpoints.
 * A memory checkpoint should bring back running processes with their
 * in-memory state (a counter server that keeps counting); a filesystem one
 * should bring back files only. Free tier = 1 sandbox, so each source is
 * terminated before restoring.
 */
import { Sandbox } from "tensorlake";
import { dec, enc, spike, uniq } from "./lib";

const s = spike("03-snapshots");

// In-memory counter: its value only survives a restore if RAM was captured.
const counterServer = `
import http.server, itertools
c = itertools.count(1)
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = str(next(c)).encode()
        self.send_response(200); self.send_header("content-length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass
http.server.HTTPServer(("0.0.0.0", 8080), H).serve_forever()
`;

async function hit(sb: Sandbox) {
  const r = await sb.run("curl", { args: ["-s", "--max-time", "3", "http://127.0.0.1:8080/"] });
  return r.stdout.trim();
}

await s.run(async () => {
  let sb = (await s.step("create source", () =>
    Sandbox.create({ name: uniq("lovable-diy-spike03"), timeoutSecs: 300 }),
  ))!;
  await sb.writeFile("/home/tl-user/counter.py", enc.encode(counterServer));
  await sb.writeFile("/home/tl-user/marker.txt", enc.encode("before-snapshot"));
  await s.step("start counter server", () =>
    sb.startProcess("python3", { args: ["/home/tl-user/counter.py"], name: "counter" }),
  );
  await new Promise((r) => setTimeout(r, 1500));
  s.note("counterBefore", [await hit(sb), await hit(sb), await hit(sb)]);

  const mem = await s.step("checkpoint (memory)", () => sb.checkpoint({ checkpointType: "memory" }));
  s.note("memorySnapshot", { id: mem?.snapshotId, sizeBytes: mem?.sizeBytes, status: mem?.status });
  const fsSnap = await s.step("checkpoint (filesystem)", () =>
    sb.checkpoint({ checkpointType: "filesystem" }),
  );
  s.note("fsSnapshot", { id: fsSnap?.snapshotId, sizeBytes: fsSnap?.sizeBytes, status: fsSnap?.status });
  s.note("sourceStillRunningAfterCheckpoint", await sb.status());

  await s.step("terminate source", () => sb.terminate());

  sb = s.track(
    (await s.step("restore from memory snapshot", () =>
      Sandbox.create({ snapshotId: mem!.snapshotId, name: uniq("lovable-diy-spike03m") }),
    ))!,
  );
  s.note("afterMemoryRestore.marker", dec.decode(await sb.readFile("/home/tl-user/marker.txt")));
  const t0 = performance.now();
  const next = await hit(sb);
  s.note("afterMemoryRestore.counter", next);
  s.note("afterMemoryRestore.firstRequestMs", Math.round(performance.now() - t0));
  s.note("memoryRestoreKeepsProcessState", next === "4");
  await s.step("terminate memory restore", () => sb.terminate());

  sb = s.track(
    (await s.step("restore from filesystem snapshot", () =>
      Sandbox.create({ snapshotId: fsSnap!.snapshotId, name: uniq("lovable-diy-spike03f") }),
    ))!,
  );
  s.note("afterFsRestore.marker", dec.decode(await sb.readFile("/home/tl-user/marker.txt")));
  const fsHit = await hit(sb);
  s.note("afterFsRestore.counterServerRunning", fsHit !== "");

  s.onCleanup(async () => {
    for (const id of [mem?.snapshotId, fsSnap?.snapshotId]) if (id) await Sandbox.deleteSnapshot(id);
  });
});
