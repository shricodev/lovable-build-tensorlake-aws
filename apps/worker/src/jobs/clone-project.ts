import { appendEvent, eq, messages, projects, recordVersion, type CloneProjectJob, type Db } from "@lovable-diy/db";
import { bundleFromHostedGit, loadBundle } from "@lovable-diy/sandbox";
import type { Logger } from "@lovable-diy/shared";
import { ensureMainSandbox } from "../sandboxes";
import { DATA_DIR, syncHostedGit } from "../versions";

/**
 * Remix / duplicate: give the target project its own sandbox (from the warm
 * base snapshot) and load the source's history from hosted Git, so the
 * source sandbox never has to wake up.
 */
export async function handleCloneProject(job: CloneProjectJob, deps: { db: Db; log: Logger }) {
  const { db } = deps;
  const log = deps.log.child({ projectId: job.targetProjectId });
  const [source] = await db.select().from(projects).where(eq(projects.id, job.sourceProjectId));
  const target = job.targetProjectId;
  const note = (content: string) =>
    db.insert(messages).values({ projectId: target, role: "assistant", content });

  try {
    const sandbox = await ensureMainSandbox(db, target, log);
    if (!source?.gitRepo) {
      await note(
        "The original project had no saved versions yet, so this copy starts from the blank template.",
      );
      await appendEvent(db, { projectId: target, type: "clone_done", payload: { ok: true } });
      return;
    }
    const t0 = performance.now();
    const bundle = await bundleFromHostedGit(source.gitRepo, DATA_DIR);
    const { sha, files } = await loadBundle(sandbox, bundle);
    await recordVersion(db, {
      projectId: target,
      commitSha: sha,
      source: "manual",
      title: `Copied from “${source.name}”`,
      changedFiles: files,
    });
    await note(`This is a copy of “${source.name}”. Ask for any change to make it your own.`);
    await appendEvent(db, {
      projectId: target,
      type: "clone_done",
      payload: { ok: true, ms: Math.round(performance.now() - t0) },
    });
    void syncHostedGit(db, log, sandbox, target);
  } catch (err) {
    log.error({ err }, "clone failed");
    await note("Copying the project failed. Try again from the original.");
    await appendEvent(db, { projectId: target, type: "clone_done", payload: { ok: false } });
  }
}
