"use client";

import { formatDistanceToNow } from "date-fns";
import { Copy, MoreHorizontal, Pencil, Search, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";
import { toast } from "sonner";
import { pillFor, StatusPill } from "@/components/app/status-pill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  sandboxStatus: string | null;
  busy: boolean;
  hasThumbnail: boolean;
}

export function ProjectGrid({ projects }: { projects: ProjectSummary[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [renaming, setRenaming] = useState<ProjectSummary | null>(null);
  const [renameName, setRenameName] = useState("");
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);
  const [pending, setPending] = useState(false);
  const shown = useMemo(
    () => projects.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase())),
    [projects, q],
  );

  async function rename(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = renameName.trim();
    if (!renaming || !name || name === renaming.name) return;
    setPending(true);
    const res = await fetch(`/api/projects/${renaming.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setPending(false);
    if (!res.ok) return toast.error("Couldn't rename the project");
    setRenaming(null);
    router.refresh();
  }

  async function duplicate(p: ProjectSummary) {
    const res = await fetch(`/api/projects/${p.id}/remix`, { method: "POST" });
    const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!res.ok || !data.id) return toast.error(data.error ?? "Couldn't duplicate the project");
    router.push(`/projects/${data.id}`);
  }

  async function remove() {
    if (!deleting) return;
    setPending(true);
    const res = await fetch(`/api/projects/${deleting.id}`, { method: "DELETE" });
    setPending(false);
    if (!res.ok) return toast.error("Couldn't delete the project");
    setDeleting(null);
    toast.success("Project deleted");
    router.refresh();
  }

  if (projects.length === 0) {
    return (
      <p className="text-center text-sm text-muted-foreground">
        No projects yet. Try one of the examples above.
      </p>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-medium">Your projects</h2>
        <div className="relative w-64">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search projects"
            className="px-8"
            aria-label="Search projects"
          />
          {q && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute top-1/2 right-0.5 size-8 -translate-y-1/2"
              onClick={() => setQ("")}
              aria-label="Clear search"
            >
              <X className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
      {shown.length === 0 ? (
        <div className="rounded-lg border border-dashed px-6 py-12 text-center" role="status">
          <p className="text-sm text-muted-foreground">No projects match "{q.trim()}".</p>
          <Button type="button" variant="link" size="sm" onClick={() => setQ("")}>
            Clear search
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((p) => (
            <Card
              key={p.id}
              className="group relative gap-0 overflow-hidden p-0 transition-colors hover:border-foreground/20"
            >
              <Link
                href={`/projects/${p.id}`}
                className="absolute inset-0 z-0"
                aria-label={`Open ${p.name}`}
              />
              <div className="grid aspect-video place-items-center overflow-hidden border-b bg-muted text-3xl font-semibold text-muted-foreground/60">
                {p.hasThumbnail ? (
                  <img
                    src={`/api/projects/${p.id}/thumbnail?v=${encodeURIComponent(p.updatedAt)}`}
                    alt=""
                    className="size-full object-cover object-top"
                    loading="lazy"
                  />
                ) : (
                  p.name.slice(0, 1).toUpperCase()
                )}
              </div>
              <div className="flex items-start justify-between gap-2 p-4">
                <div className="min-w-0 space-y-1">
                  <div className="truncate font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">
                    Edited {formatDistanceToNow(new Date(p.updatedAt), { addSuffix: true })}
                  </div>
                </div>
                <div className="relative z-10 flex items-center gap-1">
                  <StatusPill status={pillFor(p.sandboxStatus, p.busy)} />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-7" aria-label="Project actions">
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => {
                          setRenaming(p);
                          setRenameName(p.name);
                        }}
                      >
                        <Pencil className="size-4" /> Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => void duplicate(p)}>
                        <Copy className="size-4" /> Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onClick={() => setDeleting(p)}>
                        <Trash2 className="size-4" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={!!renaming} onOpenChange={(open) => !open && !pending && setRenaming(null)}>
        <DialogContent>
          <form className="contents" onSubmit={rename}>
            <DialogHeader>
              <DialogTitle>Rename project</DialogTitle>
              <DialogDescription>Choose a name that will be easy to find later.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="project-name">Name</Label>
              <Input
                id="project-name"
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
                maxLength={80}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenaming(null)} disabled={pending}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={pending || !renameName.trim() || renameName.trim() === renaming?.name}
              >
                {pending ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={(open) => !open && !pending && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete project?</DialogTitle>
            <DialogDescription>
              {deleting?.name} and its sandbox will be removed. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleting(null)} disabled={pending}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={() => void remove()} disabled={pending}>
              {pending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
