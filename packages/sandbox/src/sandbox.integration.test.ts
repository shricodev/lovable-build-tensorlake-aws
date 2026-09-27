import { createLogger } from "@kiln/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readBaseSnapshot } from "./base-snapshot";
import { SandboxPathError } from "./errors";
import { ProjectSandbox } from "./project-sandbox";

/** The security boundary around generated code, checked against a real sandbox. */
describe("project sandbox boundary", () => {
  let ps: ProjectSandbox;
  const log = createLogger("test", { level: "silent" });

  beforeAll(async () => {
    const base = readBaseSnapshot();
    if (!base) throw new Error("run `pnpm sandbox:build-base` first");
    ps = await ProjectSandbox.createFromSnapshot({
      snapshotId: base.snapshotId,
      name: `kiln-test-${Date.now().toString(36)}`,
      log,
    });
  });
  afterAll(async () => {
    await ps?.terminate().catch(() => {});
  });

  const status = async (url: string) =>
    (
      await ps.exec(`curl -s -o /dev/null -w '%{http_code}' --max-time 8 ${url} || true`, { timeoutSecs: 20 })
    ).stdout.trim();

  it("can reach the npm registry and nothing else", async () => {
    expect(await status("https://registry.npmjs.org/react")).toBe("200");
    for (const url of ["https://example.com", "https://github.com", "http://169.254.169.254/"]) {
      expect(await status(url), url).toBe("000");
    }
  });

  it("holds no secrets in its environment", async () => {
    const env = (await ps.exec("env")).stdout;
    expect(env).not.toMatch(/API_KEY|SECRET|DATABASE_URL|AWS_|GIT_TOKEN/i);
  });

  it("rejects paths that escape the project, including via symlinks", async () => {
    await ps.exec("ln -sf /etc/passwd leak.txt && ln -sfn /etc linkdir");
    await expect(ps.readFile("leak.txt")).rejects.toBeInstanceOf(SandboxPathError);
    await expect(ps.writeFile("linkdir/evil", "x")).rejects.toBeInstanceOf(SandboxPathError);
    await expect(ps.readFile("../../etc/hostname")).rejects.toBeInstanceOf(SandboxPathError);
    await expect(ps.writeFile(".git/config", "x")).rejects.toBeInstanceOf(SandboxPathError);
    await expect(ps.readFile("src/App.tsx")).resolves.toContain("export default");
  });

  it("times out long commands instead of hanging", async () => {
    const r = await ps.exec("sleep 30", { timeoutSecs: 2 });
    expect(r.timedOut).toBe(true);
  });
});
