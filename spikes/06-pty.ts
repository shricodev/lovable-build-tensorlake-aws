/**
 * Spike 06: PTY sessions: create, type, detach, reattach with the stored
 * token, and check whether scrollback is replayed on reattach.
 */
import { Sandbox } from "tensorlake";
import { dec, spike, uniq } from "./lib.js";

const s = spike("06-pty");

function waitFor(buf: () => string, needle: string, ms = 10_000) {
  return new Promise<void>((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (buf().includes(needle)) {
        clearInterval(iv);
        resolve();
      } else if (Date.now() - t0 > ms) {
        clearInterval(iv);
        reject(new Error(`timed out waiting for ${needle}`));
      }
    }, 100);
  });
}

await s.run(async () => {
  const sb = s.track(
    (await s.step("create", () => Sandbox.create({ name: uniq("kiln-spike06"), timeoutSecs: 300 })))!,
  );

  let out1 = "";
  const pty = (await s.step("createPty(bash)", () =>
    sb.createPty({
      command: "/bin/bash",
      args: ["-l"],
      env: { TERM: "xterm-256color" },
      cols: 100,
      rows: 30,
      onData: (d) => (out1 += dec.decode(d)),
    }),
  ))!;
  s.note("session", { sessionId: pty.sessionId, tokenLength: pty.token.length });

  await s.step("type a command and see output", async () => {
    await pty.sendInput("export KILN_VAR=kept; echo marker-$((20+22))\n");
    await waitFor(() => out1, "marker-42");
  });
  await s.step("resize", () => pty.resize(120, 40));

  pty.disconnect();
  await new Promise((r) => setTimeout(r, 3000));

  let out2 = "";
  const again = (await s.step("reattach with connectPty(sessionId, token)", () =>
    sb.connectPty(pty.sessionId, pty.token, { onData: (d) => (out2 += dec.decode(d)) }),
  ))!;
  await new Promise((r) => setTimeout(r, 1000));
  s.note("scrollbackReplayedOnReattach", out2.includes("marker-42"));

  await s.step("shell state survived detach", async () => {
    await again.sendInput("echo var=$KILN_VAR\n");
    await waitFor(() => out2, "var=kept");
  });

  const wsUrl = sb.ptyWsUrl(pty.sessionId, pty.token);
  s.note("ptyWsUrlShape", wsUrl.replace(pty.token, "<token>"));

  await again.sendInput("exit 7\n");
  const code = await s.step("wait() for exit code", () => again.wait());
  s.note("exitCode", code);
});
