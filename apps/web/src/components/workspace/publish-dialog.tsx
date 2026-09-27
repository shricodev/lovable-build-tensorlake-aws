"use client";

import { formatDistanceToNow } from "date-fns";
import { ExternalLink, Globe, Loader2, Rocket } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface Published {
  url: string;
  version: number | null;
  publishedAt: string;
}

export function PublishDialog({ projectId, busy }: { projectId: string; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [site, setSite] = useState<Published | null | undefined>(undefined);
  const [working, setWorking] = useState<"publish" | "unpublish" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/publish`);
    if (res.ok) setSite(((await res.json()) as { published: Published | null }).published);
  }, [projectId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function publish() {
    setWorking("publish");
    setError(null);
    const res = await fetch(`/api/projects/${projectId}/publish`, { method: "POST" });
    const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    setWorking(null);
    if (!res.ok) return setError(data.error ?? "Publishing failed");
    toast.success("Published");
    void load();
  }

  async function unpublish() {
    setWorking("unpublish");
    await fetch(`/api/projects/${projectId}/publish`, { method: "DELETE" });
    setWorking(null);
    toast("Unpublished");
    setSite(null);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-8 gap-1.5">
          <Rocket className="size-4" /> Publish
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Publish</DialogTitle>
          <DialogDescription>
            Builds your app and hosts the static files. The published site stays up even when the sandbox is
            asleep.
          </DialogDescription>
        </DialogHeader>
        {site === undefined ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : site ? (
          <div className="space-y-1 rounded-lg border p-3">
            <a
              href={site.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-sm font-medium hover:underline"
            >
              <Globe className="size-4" /> {site.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              <ExternalLink className="size-3.5 text-muted-foreground" />
            </a>
            <p className="text-xs text-muted-foreground">
              {site.version ? `Version ${site.version} · ` : ""}published{" "}
              {formatDistanceToNow(new Date(site.publishedAt), { addSuffix: true })}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Not published yet.</p>
        )}
        {error && (
          <pre className="max-h-40 overflow-auto rounded-md border bg-muted/50 p-2 text-xs whitespace-pre-wrap text-destructive">
            {error}
          </pre>
        )}
        <div className="flex justify-end gap-2">
          {site && (
            <Button variant="outline" disabled={working !== null} onClick={() => void unpublish()}>
              {working === "unpublish" && <Loader2 className="size-4 animate-spin" />} Unpublish
            </Button>
          )}
          <Button disabled={busy || working !== null} onClick={() => void publish()}>
            {working === "publish" && <Loader2 className="size-4 animate-spin" />}
            {working === "publish" ? "Building…" : site ? "Update" : "Publish"}
          </Button>
        </div>
        {busy && (
          <p className="text-xs text-muted-foreground">Publishing is available once the agent finishes.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
