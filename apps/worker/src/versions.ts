import { eq, projects, recordVersion, versionTitle, type Db } from "@kiln/db";
import { commitAll, pushToHostedGit, type ProjectSandbox } from "@kiln/sandbox";
import type { Logger } from "@kiln/shared";
import { fileURLToPath } from "node:url";

export const DATA_DIR =
  process.env.KILN_DATA_DIR ?? fileURLToPath(new URL("../../../.kiln", import.meta.url));

/** Commit the turn's changes as a new version, then push history to hosted Git in the background. */
export async function saveVersion(opts: {
  db: Db;
  log: Logger;
  sandbox: ProjectSandbox;
  projectId: string;
  runId: string;
  prompt: string;
}) {
  const { db, log, sandbox, projectId } = opts;
  const title = versionTitle(opts.prompt);
  const commit = await commitAll(sandbox, title).catch((err) => {
    log.warn({ err }, "commit failed");
    return null;
  });
  if (!commit) return null;
  const version = await recordVersion(db, {
    projectId,
    commitSha: commit.sha,
    source: "agent",
    title,
    changedFiles: commit.files,
    runId: opts.runId,
  });
  void syncHostedGit(db, log, sandbox, projectId);
  return version;
}

export async function syncHostedGit(db: Db, log: Logger, sandbox: ProjectSandbox, projectId: string) {
  const repo = `kiln-${projectId}`;
  try {
    const t0 = performance.now();
    await pushToHostedGit(sandbox, repo, DATA_DIR);
    await db.update(projects).set({ gitRepo: repo }).where(eq(projects.id, projectId));
    log.info({ repo, ms: Math.round(performance.now() - t0) }, "history pushed to hosted git");
  } catch (err) {
    log.warn({ err, repo }, "hosted git push failed (versions still exist in the sandbox)");
  }
}
