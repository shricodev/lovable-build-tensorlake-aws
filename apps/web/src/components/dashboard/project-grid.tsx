"use client";

import { formatDistanceToNow } from "date-fns";
import { MoreHorizontal, Pencil, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { pillFor, StatusPill } from "@/components/app/status-pill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  sandboxStatus: string | null;
  busy: boolean;
}

export function ProjectGrid({ projects }: { projects: ProjectSummary[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const shown = useMemo(
    () => projects.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase())),
    [projects, q],
  );

  async function rename(p: ProjectSummary) {
    const name = window.prompt("Rename project", p.name)?.trim();
    if (!name || name === p.name) return;
    const res = await fetch(`/api/projects/${p.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) return toast.error("Couldn't rename the project");
    router.refresh();
  }

  async function remove(p: ProjectSummary) {
    if (!window.confirm(`Delete "${p.name}"? Its sandbox will be shut down.`)) return;
    const res = await fetch(`/api/projects/${p.id}`, { method: "DELETE" });
    if (!res.ok) return toast.error("Couldn't delete the project");
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
            placeholder="Search"
            className="pl-8"
            aria-label="Search projects"
          />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((p) => (
          <Card
            key={p.id}
            className="group relative gap-0 overflow-hidden p-0 transition-colors hover:border-foreground/20"
          >
            <Link href={`/projects/${p.id}`} className="absolute inset-0 z-0" aria-label={`Open ${p.name}`} />
            <div className="grid aspect-video place-items-center border-b bg-muted text-3xl font-semibold text-muted-foreground/60">
              {p.name.slice(0, 1).toUpperCase()}
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
                    <DropdownMenuItem onClick={() => void rename(p)}>
                      <Pencil className="size-4" /> Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onClick={() => void remove(p)}>
                      <Trash2 className="size-4" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}
