import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { RepositoryClient } from "tensorlake";
import { SandboxError } from "./errors";
import type { ProjectSandbox } from "./project-sandbox";

const run = promisify(execFile);
const SHA = /^[0-9a-f]{7,40}$/;

function assertSha(sha: string) {
  if (!SHA.test(sha)) throw new SandboxError("bad_sha", `Not a commit sha: ${sha}`);
}

async function git(ps: ProjectSandbox, script: string, env: Record<string, string> = {}, timeoutSecs = 60) {
  const r = await ps.exec(`set -e\n${script}`, { env, timeoutSecs, maxOutput: 200_000 });
  if (r.exitCode !== 0)
    throw new SandboxError("git_failed", `git failed: ${(r.stderr || r.stdout).slice(-800)}`);
  return r.stdout;
}

/** Commit everything in the project. Returns null when there's nothing to commit. */
export async function commitAll(
  ps: ProjectSandbox,
  message: string,
): Promise<{ sha: string; files: string[] } | null> {
  const out = await git(
    ps,
    // No \`exit\` here: under \`bash -l\`, exit runs ~/.bash_logout, which clobbers the status.
    `git add -A
if git diff --cached --quiet; then
  echo NOCHANGE
else
  git commit -q -m "$MSG"
  git rev-parse HEAD
  git show --name-only --format= HEAD
fi`,
    { MSG: message.slice(0, 500) },
  );
  if (out.trim() === "NOCHANGE") return null;
  const [sha, ...files] = out.trim().split("\n");
  return { sha: sha!, files: files.filter(Boolean) };
}

export async function hasUncommittedChanges(ps: ProjectSandbox): Promise<boolean> {
  return (await git(ps, "git status --porcelain")).trim().length > 0;
}

/**
 * Make the working tree match `sha` exactly (tracked files, including
 * deletions), without rewriting history: the caller commits the result as a
 * new version. Reinstalls dependencies if package.json differs.
 */
export async function restoreTree(ps: ProjectSandbox, sha: string): Promise<{ depsChanged: boolean }> {
  assertSha(sha);
  const out = await git(
    ps,
    `git reset -q --hard HEAD
git clean -fdq
git diff --name-only -z --diff-filter=A "$SHA" HEAD | xargs -0 -r rm -f --
git checkout "$SHA" -- .
if git diff --quiet HEAD -- package.json package-lock.json; then echo SAME; else echo DEPS; fi`,
    { SHA: sha },
  );
  const depsChanged = out.trim().endsWith("DEPS");
  if (depsChanged) {
    const r = await ps.exec("npm install --no-audit --no-fund --loglevel=error", { timeoutSecs: 240 });
    if (r.exitCode !== 0) throw new SandboxError("npm_failed", `npm install failed: ${r.stderr.slice(-500)}`);
  }
  return { depsChanged };
}

export async function changedFilesBetween(ps: ProjectSandbox, from: string, to: string) {
  assertSha(from);
  assertSha(to);
  const out = await git(ps, `git diff --name-status "$A" "$B"`, { A: from, B: to });
  return out
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [status, ...rest] = l.split("\t");
      return { status: status!.charAt(0) as "A" | "M" | "D" | "R", path: rest.at(-1)! };
    });
}

/** File content at a commit ("" when the file doesn't exist there). */
export async function fileAt(ps: ProjectSandbox, sha: string, path: string): Promise<string> {
  assertSha(sha);
  if (path.includes("..") || path.startsWith("/")) throw new SandboxError("bad_path", "invalid path");
  const r = await ps.exec(`git show "$REF" 2>/dev/null || true`, {
    env: { REF: `${sha}:${path}` },
    maxOutput: 600_000,
  });
  return r.stdout;
}

/**
 * Durable history: push the sandbox repo to Tensorlake hosted Git without
 * the sandbox ever seeing a credential (repo tokens are project-wide). The
 * sandbox writes a `git bundle`; this process fetches it into a local bare
 * mirror and pushes with a short-lived token.
 */
export async function pushToHostedGit(ps: ProjectSandbox, repo: string, dataDir: string): Promise<string> {
  const repos = new RepositoryClient();
  const existing = await repos.list();
  if (!existing.some((r) => r.name === repo)) await repos.create(repo, { defaultBranch: "main" });

  await git(ps, "git bundle create -q /tmp/kiln.bundle main");
  const bundle = await ps.sb.readFile("/tmp/kiln.bundle");

  const mirror = join(dataDir, "git", `${repo}.git`);
  if (!existsSync(mirror)) {
    mkdirSync(mirror, { recursive: true });
    await run("git", ["init", "-q", "--bare", mirror]);
  }
  const file = join(mirror, "incoming.bundle");
  writeFileSync(file, bundle);
  // Fully qualified refspec: git misresolves a bare "main" when fetching from bundles.
  await run("git", ["-C", mirror, "fetch", "-q", "--force", file, "+refs/heads/main:refs/heads/main"]);
  const cred = await repos.credential(repo);
  const auth = Buffer.from(`${cred.gitUsername}:${cred.token}`).toString("base64");
  await run("git", [
    "-C",
    mirror,
    "-c",
    `http.extraHeader=Authorization: Basic ${auth}`,
    "push",
    "-q",
    "--force",
    await repos.url(repo),
    "main",
  ]);
  return mirror;
}

export async function deleteHostedRepo(repo: string) {
  await new RepositoryClient().delete(repo).catch(() => {});
}

/**
 * Bring the local bare mirror of a hosted repo up to date (creating it if
 * needed) and return a bundle of its `main`, ready to load into a sandbox.
 */
export async function bundleFromHostedGit(repo: string, dataDir: string): Promise<Uint8Array> {
  const repos = new RepositoryClient();
  const mirror = join(dataDir, "git", `${repo}.git`);
  if (!existsSync(mirror)) {
    mkdirSync(mirror, { recursive: true });
    await run("git", ["init", "-q", "--bare", mirror]);
  }
  const cred = await repos.credential(repo);
  const auth = Buffer.from(`${cred.gitUsername}:${cred.token}`).toString("base64");
  await run("git", [
    "-C",
    mirror,
    "-c",
    `http.extraHeader=Authorization: Basic ${auth}`,
    "fetch",
    "-q",
    "--force",
    await repos.url(repo),
    "+refs/heads/main:refs/heads/main",
  ]);
  const file = join(mirror, "outgoing.bundle");
  await run("git", ["-C", mirror, "bundle", "create", "-q", file, "main"]);
  return new Uint8Array(readFileSync(file));
}

/**
 * Replace the sandbox project's tree and history with a bundle's `main`
 * (used by remix/duplicate). Reinstalls dependencies when package.json differs.
 */
export async function loadBundle(
  ps: ProjectSandbox,
  bundle: Uint8Array,
): Promise<{ sha: string; files: string[] }> {
  await ps.sb.writeFile("/tmp/source.bundle", bundle);
  const out = await git(
    ps,
    `before=$(git rev-parse HEAD)
git fetch -q /tmp/source.bundle +refs/heads/main:refs/remotes/source/main
git reset -q --hard source/main
git clean -fdq
if git diff --quiet "$before" HEAD -- package.json package-lock.json; then echo SAME; else echo DEPS; fi
git rev-parse HEAD
git ls-files`,
    {},
    120,
  );
  const [deps, sha, ...files] = out.trim().split("\n");
  if (deps === "DEPS") {
    const r = await ps.exec("npm install --no-audit --no-fund --loglevel=error", { timeoutSecs: 240 });
    if (r.exitCode !== 0) throw new SandboxError("npm_failed", `npm install failed: ${r.stderr.slice(-500)}`);
  }
  return { sha: sha!, files: files.filter((f) => f && !f.startsWith("kiln/")) };
}
