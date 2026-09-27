import { and, eq, getDb, isNull, projects, publishedSites, users } from "@kiln/db";
import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Logo } from "@/components/app/logo";
import { RemixButton } from "@/components/share/remix-button";
import { Button } from "@/components/ui/button";
import { publishedUrl } from "@/server/publish";

export const dynamic = "force-dynamic";

async function load(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await getDb()
    .db.select({ project: projects, owner: users.username, slug: publishedSites.slug })
    .from(projects)
    .innerJoin(users, eq(users.id, projects.ownerId))
    .leftJoin(publishedSites, eq(publishedSites.projectId, projects.id))
    .where(and(eq(projects.id, id), eq(projects.visibility, "shared"), isNull(projects.deletedAt)));
  return row ?? null;
}

export async function generateMetadata(props: PageProps<"/share/[id]">): Promise<Metadata> {
  const row = await load((await props.params).id);
  return { title: row ? `${row.project.name} · Kiln` : "Kiln" };
}

/** Public, read-only view of a shared project: live preview, published link, remix. */
export default async function SharePage(props: PageProps<"/share/[id]">) {
  const row = await load((await props.params).id);
  if (!row) notFound();
  const { project } = row;
  const preview = `${process.env.PREVIEW_PROTOCOL ?? "http"}://${project.id}.${process.env.PREVIEW_BASE_DOMAIN ?? "preview.localhost:4000"}/`;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b px-4">
        <Logo />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{project.name}</div>
          <div className="text-xs text-muted-foreground">by @{row.owner}</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {row.slug && (
            <Button variant="outline" size="sm" asChild>
              <a href={publishedUrl(row.slug)} target="_blank" rel="noreferrer">
                Open published app <ExternalLink className="size-3.5" />
              </a>
            </Button>
          )}
          <RemixButton projectId={project.id} />
        </div>
      </header>
      <iframe
        src={preview}
        title={`${project.name} preview`}
        className="min-h-0 flex-1 border-0 bg-white"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
      />
    </div>
  );
}
