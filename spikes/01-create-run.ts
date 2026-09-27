/**
 * Spike 01: create a sandbox, run commands, and inventory the default image
 * (which tools exist decides what the later spikes and the base image need).
 */
import { Sandbox } from "tensorlake";
import { spike, uniq } from "./lib.js";

const s = spike("01-create-run");

await s.run(async () => {
  const sb = s.track(
    (await s.step("create named sandbox (default image)", () =>
      Sandbox.create({ name: uniq("kiln-spike01"), timeoutSecs: 300 }),
    ))!,
  );
  s.note("sandboxId", sb.sandboxId);

  const info = await s.step("info()", () => sb.info());
  s.note("image", info?.image);
  s.note("resources", info?.resources);
  s.note("sandboxUrl", info?.sandboxUrl);

  const sys = await s.step("run uname / os-release / nproc / free", () =>
    sb.run("bash", {
      args: [
        "-lc",
        "uname -a; . /etc/os-release; echo $PRETTY_NAME; nproc; free -m | head -2; df -h / | tail -1; whoami; echo $HOME",
      ],
    }),
  );
  console.log(sys?.stdout);

  const tools = await s.step("probe tools", () =>
    sb.run("bash", {
      args: [
        "-lc",
        "for t in node npm pnpm git curl wget python3 apt-get chromium; do printf '%s=' $t; command -v $t || echo MISSING; done; node -v 2>/dev/null; git --version 2>/dev/null",
      ],
    }),
  );
  console.log(tools?.stdout);
  s.note("tools", tools?.stdout.trim().split("\n"));

  const fail = await s.step("non-zero exit is returned, not thrown", () =>
    sb.run("bash", { args: ["-c", "echo oops >&2; exit 3"] }),
  );
  s.note("exitCodeHandling", { exitCode: fail?.exitCode, stderr: fail?.stderr.trim() });

  await s.step("run() timeout option", () => sb.run("sleep", { args: ["10"], timeout: 2 }), {
    allowFail: true,
  });

  const internet = await s.step("default egress (curl npm registry)", () =>
    sb.run("bash", {
      args: [
        "-lc",
        "curl -sS -o /dev/null -w '%{http_code}' --max-time 10 https://registry.npmjs.org/react || echo FAIL",
      ],
    }),
  );
  s.note("defaultEgress", internet?.stdout.trim());
});
