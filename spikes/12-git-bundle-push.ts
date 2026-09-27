/**
 * Spike 12: push versions to hosted Git without any token inside the sandbox.
 * Spike 09 showed repo credentials are project-wide (pattern "*", admin
 * scopes), so the sandbox only makes commits and exports a `git bundle`; the
 * worker fetches that bundle into a local mirror and pushes with the token.
 * Also checks the incremental case (bundle only the new commits).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RepositoryClient, Sandbox } from "tensorlake";
import { spike, uniq } from "./lib.js";

const s = spike("12-git-bundle-push");
const repos = new RepositoryClient();
const APP = "/home/tl-user/app";

await s.run(async () => {
  const repo = uniq("kiln-spike12");
  await s.step("create repo", () => repos.create(repo, { defaultBranch: "main" }));
  s.onCleanup(() => repos.delete(repo));
  const url = await repos.url(repo);

  const mirror = mkdtempSync(join(tmpdir(), "kiln-mirror-"));
  s.onCleanup(async () => rmSync(mirror, { recursive: true, force: true }));
  const localGit = (args: string[], token?: string) =>
    execFileSync(
      "git",
      token
        ? [
            "-c",
            `http.extraHeader=Authorization: Basic ${Buffer.from(`t:${token}`).toString("base64")}`,
            ...args,
          ]
        : args,
      { cwd: mirror, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  localGit(["init", "-q", "--bare"]);

  const sb = s.track(
    (await s.step("create sandbox", () => Sandbox.create({ name: uniq("kiln-spike12"), timeoutSecs: 300 })))!,
  );
  const sh = (cmd: string) => sb.run("bash", { args: ["-lc", `cd ${APP} && ${cmd}`], timeout: 60 });
  await sb.run("mkdir", { args: ["-p", APP] });
  await sh(
    "git init -q -b main && git config user.email kiln@local && git config user.name Kiln && echo v1 > a.txt && git add -A && git commit -qm 'Version 1'",
  );

  async function exportAndPush(label: string, since?: string) {
    const range = since ? `${since}..main` : "main";
    const b = await sh(`git bundle create -q /tmp/v.bundle ${range} && git rev-parse main`);
    if (b.exitCode !== 0) throw new Error(b.stderr);
    const head = b.stdout.trim();
    const bytes = await sb.readFile("/tmp/v.bundle");
    const file = join(mirror, "incoming.bundle");
    writeFileSync(file, bytes);
    // Fully qualified refspec: git 2.55 misresolves a bare "main" when fetching
    // from an incremental bundle ("cannot lock ref"). See ARTICLE_NOTES.
    localGit(["fetch", "-q", file, "refs/heads/main:refs/heads/main"]);
    const cred = await repos.credential(repo);
    localGit(["push", "-q", url, "main"], cred.token);
    s.note(`${label}.bundleBytes`, bytes.length);
    return head;
  }

  const h1 = (await s.step("bundle v1 → worker mirror → push", () => exportAndPush("v1")))!;
  await sh("echo v2 >> a.txt && echo b > b.txt && git add -A && git commit -qm 'Version 2'");
  const h2 = (await s.step("incremental bundle v1..v2 → push", () => exportAndPush("v2", h1)))!;

  const remoteHead = (await repos.info(repo)).branches.find((x) => x.name === "main")?.oid;
  s.note("remoteMatchesSandboxHead", remoteHead === h2);
  const cfg = await sh("cat .git/config; env | grep -ci token || true");
  s.note("sandboxHasNoToken", !cfg.stdout.toLowerCase().includes("extraheader"));
});
