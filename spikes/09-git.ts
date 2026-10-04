/**
 * Spike 09: Tensorlake hosted Git as the durable home of project versions.
 * Commit inside the sandbox with plain git, push to git.tensorlake.ai with a
 * short-lived token passed only to that one command, then read commits and
 * diffs back from outside the sandbox.
 */
import { RepositoryClient, Sandbox } from "tensorlake";
import { spike, uniq } from "./lib";

const s = spike("09-git");
const repos = new RepositoryClient();

await s.run(async () => {
  const repo = uniq("lovable-diy-spike09");
  const handle = await s.step("create repo", () => repos.create(repo, { defaultBranch: "main" }));
  s.note("repoHandle", handle);
  s.onCleanup(() => repos.delete(repo));

  const url = (await s.step("url()", () => repos.url(repo)))!;
  const cred = (await s.step("credential(repo)", () => repos.credential(repo)))!;
  s.note("credential", {
    user: cred.gitUsername,
    type: cred.tokenType,
    expiresAt: cred.expiresAt,
    scopes: cred.scopes,
    pattern: cred.repoPattern,
  });

  const sb = s.track(
    (await s.step("create sandbox", () => Sandbox.create({ name: uniq("lovable-diy-spike09"), timeoutSecs: 300 })))!,
  );
  const git = (cmd: string, env: Record<string, string> = {}) =>
    sb.run("bash", { args: ["-lc", `cd /home/tl-user/app && ${cmd}`], env, timeout: 60 });

  await sb.run("mkdir", { args: ["-p", "/home/tl-user/app"] });
  const init = await s.step("git init + two commits", () =>
    git(
      [
        "git init -q -b main",
        "git config user.email lovable-diy@local && git config user.name Lovable DIY",
        "echo 'v1' > README.md && git add -A && git commit -qm 'Version 1'",
        "echo 'v2' >> README.md && echo 'x' > new.txt && git add -A && git commit -qm 'Version 2'",
        "git log --oneline",
      ].join(" && "),
    ),
  );
  s.note("localLog", init?.stdout.trim());

  // The token only lives in this command's environment; nothing is written to .git/config.
  const push = await s.step("push with token via env + http.extraHeader", () =>
    git(
      `git -c http.extraHeader="Authorization: Basic $(printf '%s:%s' "$GIT_USER" "$GIT_TOKEN" | base64 -w0)" push -q "$GIT_URL" main 2>&1; echo exit=$?`,
      {
        GIT_USER: cred.gitUsername,
        GIT_TOKEN: cred.token,
        GIT_URL: url,
      },
    ),
  );
  s.note("pushOutput", push?.stdout.trim());
  const cfg = await git("cat .git/config");
  s.note("tokenLeakedIntoGitConfig", cfg.stdout.includes(cred.token));

  const info = await s.step("info(repo) from outside", () => repos.info(repo));
  s.note("branches", info?.branches);

  // Commit list + diff over the documented HTTP API.
  const project = new URL(url).pathname.split("/").filter(Boolean)[0];
  s.note("repoUrl", url);
  const basic = "Basic " + Buffer.from(`${cred.gitUsername}:${cred.token}`).toString("base64");
  const apiBase = `${new URL(url).origin}/project/${project}/repos/${repo}`;
  const commits = await s.step(
    "GET commits",
    async () => {
      const r = await fetch(`${apiBase}/commits?ref=main&limit=10`, { headers: { authorization: basic } });
      return { status: r.status, body: (await r.text()).slice(0, 1500) };
    },
    { allowFail: true },
  );
  s.note("commitsApi", commits);

  const head = info?.branches.find((b) => b.name === "main")?.oid;
  if (head) {
    const diff = await s.step(
      "GET commit diff",
      async () => {
        const r = await fetch(`${apiBase}/commits/${head}/diff`, { headers: { authorization: basic } });
        return { status: r.status, body: (await r.text()).slice(0, 1500) };
      },
      { allowFail: true },
    );
    s.note("diffApi", diff);
  }

  const fork = await s.step("fork(repo) for remix", () => repos.fork(`${repo}-fork`, repo), {
    allowFail: true,
  });
  s.note("fork", fork);
  if (fork) s.onCleanup(() => repos.delete(`${repo}-fork`));

  // Restore path: a fresh sandbox clones the repo (e.g. after the old one is gone).
  const clone = await s.step("clone into a fresh dir", () =>
    sb.run("bash", {
      args: [
        "-lc",
        `git -c http.extraHeader="Authorization: Basic $(printf '%s:%s' "$GIT_USER" "$GIT_TOKEN" | base64 -w0)" clone -q "$GIT_URL" /tmp/clone && git -C /tmp/clone log --oneline`,
      ],
      env: { GIT_USER: cred.gitUsername, GIT_TOKEN: cred.token, GIT_URL: url },
      timeout: 60,
    }),
  );
  s.note("cloneLog", clone?.stdout.trim() || clone?.stderr.trim());
});
