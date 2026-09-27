/**
 * `pnpm sandbox:bench [--keep]`: time the three ways a project sandbox can come
 * up, each measured until the app answers *through the preview proxy*:
 *   cold      default image + template upload + npm install + dev server
 *   snapshot  restore the warm base snapshot (dev server already running)
 *   fork      live-copy a running project sandbox
 * With --keep, the snapshot sandbox is left running and its preview URL printed.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createLogger } from "@kiln/shared";
import {
  coldCreateFromTemplate,
  ProjectSandbox,
  readBaseSnapshot,
  type PreviewEndpoint,
} from "../src/index.js";

const log = createLogger("bench");
const keep = process.argv.includes("--keep");
const base = readBaseSnapshot();
if (!base) throw new Error("No base snapshot. Run `pnpm sandbox:build-base` first.");
const stamp = Date.now().toString(36);

/** Poll the preview URL through the Tensorlake proxy until the app's HTML comes back. */
async function reachable(ep: PreviewEndpoint, timeoutMs = 60_000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(ep.url + "/", { headers: ep.headers, signal: AbortSignal.timeout(10_000) });
      if (res.ok && (await res.text()).includes('id="root"')) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`preview not reachable: ${ep.url}`);
}

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t0 = performance.now();
  const r = await fn();
  return [r, Math.round(performance.now() - t0)];
}

const results: Record<string, number | Record<string, number>> = {};
const cleanup: ProjectSandbox[] = [];
const created = new Set<string>(); // every sandbox we made, for snapshot cleanup

try {
  // 1. Cold
  const [cold, coldMs] = await timed(async () => {
    const c = await coldCreateFromTemplate({ name: `kiln-bench-cold-${stamp}`, log });
    await c.ps.configure();
    await reachable(await c.ps.previewEndpoint());
    return c;
  });
  results.coldMs = coldMs;
  results.coldBreakdownMs = cold.timings;
  await cold.ps.terminate();

  // 2. Snapshot
  const [warm, warmMs] = await timed(async () => {
    const ps = await ProjectSandbox.createFromSnapshot({
      snapshotId: base.snapshotId,
      name: `kiln-bench-warm-${stamp}`,
      log,
    });
    await reachable(await ps.previewEndpoint());
    return ps;
  });
  cleanup.push(warm);
  created.add(warm.id);
  results.snapshotMs = warmMs;

  // 3. Fork of the running warm sandbox
  const [forks, forkMs] = await timed(async () => {
    const [copy] = await warm.fork(1);
    if (!copy) throw new Error("fork returned no sandbox");
    await copy.configure();
    await reachable(await copy.previewEndpoint());
    return [copy];
  });
  cleanup.push(...forks);
  for (const f of forks) created.add(f.id);
  results.forkMs = forkMs;

  // 4. Suspend + wake through the proxy (what the gateway will do)
  await warm.suspend();
  const ep = await warm.previewEndpoint();
  const [, wakeMs] = await timed(() => reachable(ep, 90_000));
  results.wakeViaProxyMs = wakeMs;

  console.log("\n| Path | Time to reachable preview |\n|---|---|");
  console.log(`| Cold (create + install + dev server) | ${(coldMs / 1000).toFixed(1)} s |`);
  console.log(`| Restore warm base snapshot | ${(warmMs / 1000).toFixed(1)} s |`);
  console.log(`| Fork running sandbox | ${(forkMs / 1000).toFixed(1)} s |`);
  console.log(`| Wake suspended sandbox via proxy | ${(wakeMs / 1000).toFixed(1)} s |`);
  console.log("\ncold breakdown (ms):", JSON.stringify(cold.timings));

  mkdirSync(new URL("../../../.kiln/", import.meta.url), { recursive: true });
  writeFileSync(
    new URL("../../../.kiln/bench.json", import.meta.url),
    JSON.stringify({ at: new Date().toISOString(), ...results }, null, 2),
  );

  if (keep) {
    console.log(
      `\nPreview (needs the Bearer header; the gateway adds it in Phase 3):\n  ${ep.url}\n  sandbox: ${warm.id}`,
    );
    console.log(`  curl -s -H "Authorization: Bearer $TENSORLAKE_API_KEY" ${ep.url}/ | head -5`);
    cleanup.splice(cleanup.indexOf(warm), 1);
  }
} finally {
  for (const ps of cleanup) await ps.terminate().catch(() => {});
  // copy() and suspend() leave implicit memory snapshots behind (TENSORLAKE_NOTES gotcha 5).
  for (const p of cleanup) created.add(p.id);
  for (const s of await import("tensorlake").then((m) => m.Sandbox.listSnapshots())) {
    if (s.snapshotId !== base.snapshotId && (created.has(s.sandboxId) || s.snapshotId.includes(stamp))) {
      await ProjectSandbox.deleteSnapshot(s.snapshotId).catch(() => {});
    }
  }
}
