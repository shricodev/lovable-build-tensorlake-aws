import { and, asc, desc, eq, getDb, messages, runs, sandboxes } from "@lovable-diy/db";
import { notFound } from "next/navigation";
import { Workspace } from "@/components/workspace/workspace";
import { HttpError, ownedProject } from "@/server/api";
import { requireUser } from "@/server/session";

export const dynamic = "force-dynamic";

export default async function ProjectPage(props: PageProps<"/projects/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  const project = await ownedProject(user.id, id).catch((e) => {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  });
  const { db } = getDb();
  const [msgs, recentRuns, [sb]] = await Promise.all([
    db.select().from(messages).where(eq(messages.projectId, project.id)).orderBy(asc(messages.createdAt)),
    db.select().from(runs).where(eq(runs.projectId, project.id)).orderBy(desc(runs.createdAt)).limit(1),
    db
      .select()
      .from(sandboxes)
      .where(and(eq(sandboxes.projectId, project.id), eq(sandboxes.role, "main"))),
  ]);
  const last = recentRuns[0];
  const active = last && (last.status === "queued" || last.status === "running") ? last.id : null;
  const previewUrl = `${process.env.PREVIEW_PROTOCOL ?? "http"}://${project.id}.${process.env.PREVIEW_BASE_DOMAIN ?? "preview.localhost:4000"}/`;

  return (
    <Workspace
      project={{
        id: project.id,
        name: project.name,
        shared: project.visibility === "shared",
        cloning: !!project.remixedFrom && msgs.length === 0,
      }}
      messages={msgs.map((m) => ({ id: m.id, role: m.role, content: m.content, runId: m.runId }))}
      activeRunId={active}
      lastSuggestions={last?.status === "succeeded" ? last.suggestions : []}
      sandboxStatus={sb?.status ?? null}
      previewUrl={previewUrl}
    />
  );
}
