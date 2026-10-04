/**
 * Spike 08: egress allow-list. Generated apps should reach the npm registry
 * (to install packages) and nothing else. Also checks live policy updates.
 */
import { Sandbox } from "tensorlake";
import { spike, uniq } from "./lib";

const s = spike("08-network");

const probe = (url: string) =>
  `code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 ${url} 2>&1) ; echo "$code"`;

async function reach(sb: Sandbox, url: string) {
  const r = await sb.run("bash", { args: ["-lc", probe(url)] });
  return r.stdout.trim().split("\n").pop() ?? "";
}

await s.run(async () => {
  const sb = s.track(
    (await s.step("create with allowInternetAccess=false + allowOut npm", () =>
      Sandbox.create({
        name: uniq("lovable-diy-spike08"),
        timeoutSecs: 300,
        allowInternetAccess: false,
        allowOut: ["registry.npmjs.org"],
      }),
    ))!,
  );
  s.note("policy", (await sb.info()).networkPolicy);
  s.note("npm registry", await reach(sb, "https://registry.npmjs.org/react"));
  s.note("example.com", await reach(sb, "https://example.com"));
  s.note("github.com", await reach(sb, "https://github.com"));
  s.note("cloud metadata 169.254.169.254", await reach(sb, "http://169.254.169.254/"));

  const install = await s.step("npm install a real package (tarball from registry)", () =>
    sb.run("bash", {
      args: [
        "-lc",
        "mkdir -p /tmp/t && cd /tmp/t && npm init -y >/dev/null && npm install --no-audit --no-fund date-fns 2>&1 | tail -3",
      ],
      timeout: 120,
    }),
  );
  s.note("npmInstall", { exitCode: install?.exitCode, out: install?.stdout.trim() });

  await s.step("live update: allowInternetAccess=true + allowOut npm", () =>
    sb.update({ network: { allowInternetAccess: true, allowOut: ["registry.npmjs.org"], denyOut: [] } }),
  );
  s.note("mode B policy", (await sb.info()).networkPolicy);
  s.note("mode B npm registry", await reach(sb, "https://registry.npmjs.org/react"));
  s.note("mode B example.com", await reach(sb, "https://example.com"));
  s.note("mode B github.com", await reach(sb, "https://github.com"));
  s.note("mode B metadata", await reach(sb, "http://169.254.169.254/"));
  const installB = await s.step("mode B: npm install", () =>
    sb.run("bash", {
      args: ["-lc", "cd /tmp/t && npm install --no-audit --no-fund date-fns 2>&1 | tail -2"],
      timeout: 120,
    }),
  );
  s.note("mode B npmInstall", installB?.stdout.trim());

  await s.step("live update: allowOut npm + denyOut 169.254.0.0/16", () =>
    sb.update({
      network: { allowInternetAccess: true, allowOut: ["registry.npmjs.org"], denyOut: ["169.254.0.0/16"] },
    }),
  );
  s.note("mode C npm registry", await reach(sb, "https://registry.npmjs.org/react"));

  await s.step("live update: clear policy (null)", () => sb.update({ network: null }));
  s.note("after clear, example.com", await reach(sb, "https://example.com"));

  await s.step("live update: no internet at all", () =>
    sb.update({ network: { allowInternetAccess: false, allowOut: [], denyOut: [] } }),
  );
  s.note("no internet, npm", await reach(sb, "https://registry.npmjs.org/react"));
});
