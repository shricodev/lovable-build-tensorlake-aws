import { and, desc, eq, getDb, inArray, isNull, projects, runs, sandboxes } from "@kiln/db";
import { Logo } from "@/components/app/logo";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { UserMenu } from "@/components/app/user-menu";
import { NewProject } from "@/components/dashboard/new-project";
import { ProjectGrid } from "@/components/dashboard/project-grid";
import { requireUser } from "@/server/session";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const user = await requireUser();
  const { db } = getDb();
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      updatedAt: projects.updatedAt,
      thumbnailKey: projects.thumbnailKey,
      sandboxStatus: sandboxes.status,
    })
    .from(projects)
    .leftJoin(sandboxes, and(eq(sandboxes.projectId, projects.id), eq(sandboxes.role, "main")))
    .where(and(eq(projects.ownerId, user.id), isNull(projects.deletedAt)))
    .orderBy(desc(projects.updatedAt));
  const active = rows.length
    ? await db
        .select({ projectId: runs.projectId })
        .from(runs)
        .where(
          and(
            inArray(
              runs.projectId,
              rows.map((r) => r.id),
            ),
            inArray(runs.status, ["queued", "running"]),
          ),
        )
    : [];
  const busy = new Set(active.map((a) => a.projectId));

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Logo />
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <UserMenu user={user} />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-10 px-6 py-10">
        <NewProject />
        <ProjectGrid
          projects={rows.map((r) => ({
            id: r.id,
            name: r.name,
            updatedAt: r.updatedAt.toISOString(),
            sandboxStatus: r.sandboxStatus ?? null,
            hasThumbnail: !!r.thumbnailKey,
            busy: busy.has(r.id),
          }))}
        />
      </main>
    </div>
  );
}
