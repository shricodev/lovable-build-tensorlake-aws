/**
 * Spike 11: can a 1 vCPU / 1 GB sandbox run the real workload?
 * npm install + Vite dev server + `tsc -b && vite build`, sampling peak
 * memory. Also checks whether bigger sizes are allowed on this account, and
 * that the dev server is reachable through the port proxy.
 */
import { Sandbox } from "tensorlake";
import { dec, enc, spike, uniq } from "./lib";

const s = spike("11-vite");
const APP = "/home/tl-user/app";

const viteConfig = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: { host: "0.0.0.0", port: 5173, strictPort: true, allowedHosts: true },
});
`;

// Background sampler: records peak "used" memory (MB) while work runs.
const sampler = `while true; do free -m | awk '/Mem:/{print $3}' >> /tmp/mem.log; sleep 0.5; done`;

async function peakMem(sb: Sandbox) {
  const r = await sb.run("bash", { args: ["-c", "sort -n /tmp/mem.log | tail -1; : > /tmp/mem.log"] });
  return Number(r.stdout.trim());
}

await s.run(async () => {
  const big = await s.step(
    "probe: create 2 vCPU / 4 GB",
    () => Sandbox.create({ name: uniq("kiln-spike11-big"), cpus: 2, memoryMb: 4096, timeoutSecs: 120 }),
    { allowFail: true },
  );
  s.note("biggerSizesAllowed", big !== undefined);
  if (big) await big.terminate();

  const sb = s.track(
    (await s.step("create 1 vCPU / 1 GB", () =>
      Sandbox.create({ name: uniq("kiln-spike11"), timeoutSecs: 900 }),
    ))!,
  );
  await sb.writeFile("/home/tl-user/sampler.sh", enc.encode(sampler));
  await sb.startProcess("bash", { args: ["/home/tl-user/sampler.sh"], name: "sampler" });

  const scaffold = await s.step("npm create vite (react-ts)", () =>
    sb.run("bash", {
      args: [
        "-lc",
        `cd /home/tl-user && npm create -y vite@latest app -- --template react-ts --no-interactive 2>&1 | tail -3`,
      ],
      timeout: 180,
    }),
  );
  s.note("scaffold", scaffold?.stdout.trim());
  await sb.writeFile(`${APP}/vite.config.ts`, enc.encode(viteConfig));

  const install = await s.step("npm install", () =>
    sb.run("bash", {
      args: ["-lc", `cd ${APP} && npm install --no-audit --no-fund 2>&1 | tail -2`],
      timeout: 600,
    }),
  );
  s.note("install", install?.stdout.trim());
  s.note("peakMemMB.install", await peakMem(sb));

  await s.step("start vite dev (managed, health-checked)", async () => {
    await sb.startProcess("npx", {
      args: ["vite"],
      workingDir: APP,
      name: "vite",
      restart: { policy: "always" },
      healthCheck: { type: "http", port: 5173, path: "/", initialDelayMs: 1000 },
    });
    for (let i = 0; i < 60; i++) {
      const r = await sb.run("bash", {
        args: ["-c", "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5173/ || true"],
      });
      if (r.stdout.trim() === "200") return;
      await new Promise((res) => setTimeout(res, 1000));
    }
    throw new Error("vite never answered");
  });
  s.note("peakMemMB.viteIdle", await peakMem(sb));

  const build = await s.step("vite build", () =>
    sb.run("bash", {
      args: ["-lc", `cd ${APP} && npx tsc -b && npx vite build 2>&1 | tail -4`],
      timeout: 300,
    }),
  );
  s.note("build", build?.stdout.trim());
  s.note("peakMemMB.build", await peakMem(sb));

  const info = await sb.update({ exposedPorts: [5173] });
  const url = `https://5173-${new URL(info.sandboxUrl!).host}/`;
  const r = await s.step("dev server through port proxy", async () => {
    const res = await fetch(url, { headers: { authorization: `Bearer ${process.env.TENSORLAKE_API_KEY}` } });
    return { status: res.status, hasRoot: (await res.text()).includes('id="root"') };
  });
  s.note("proxiedDevServer", r);

  const du = await sb.run("bash", {
    args: ["-lc", `du -sh ${APP}/node_modules 2>/dev/null; df -h / | tail -1`],
  });
  s.note("diskUsage", du.stdout.trim());
  const oom = await sb.run("bash", {
    args: ["-c", "sudo dmesg 2>/dev/null | grep -i -c 'out of memory' || true"],
  });
  s.note("oomKillsInDmesg", dec.decode(enc.encode(oom.stdout.trim())));
});
