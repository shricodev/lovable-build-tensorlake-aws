"use client";

import { DiffEditor } from "@monaco-editor/react";
import { formatDistanceToNow } from "date-fns";
import { GitCompare, History, Loader2, RotateCcw, Save } from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface Version {
  id: string;
  number: number;
  title: string;
  source: "agent" | "manual" | "restore" | "variant";
  changedFiles: string[];
  createdAt: string;
  screenshotKey: string | null;
}

const SOURCE: Record<Version["source"], string> = {
  agent: "Agent",
  manual: "Manual",
  restore: "Restore",
  variant: "Variant",
};

export function VersionsSheet({
  projectId,
  busy,
  refreshKey,
}: {
  projectId: string;
  busy: boolean;
  refreshKey: number;
}) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [diffFor, setDiffFor] = useState<Version | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/versions`);
    if (res.ok) setVersions(((await res.json()) as { versions: Version[] }).versions);
  }, [projectId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load, refreshKey]);

  async function act(
    key: string,
    url: string,
    ok: (d: { version?: Version | null; unchanged?: boolean }) => string,
  ) {
    setPending(key);
    const res = await fetch(url, { method: "POST" });
    const data = (await res.json().catch(() => ({}))) as {
      version?: Version | null;
      unchanged?: boolean;
      error?: string;
    };
    setPending(null);
    if (!res.ok) return toast.error(data.error ?? "Something went wrong");
    toast.success(ok(data));
    void load();
  }

  const latest = versions?.[0]?.number;

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5">
            <History className="size-4" /> History
          </Button>
        </SheetTrigger>
        <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b">
            <SheetTitle>Version history</SheetTitle>
            <SheetDescription>
              Every finished request is saved. Restoring adds a new version; nothing is lost.
            </SheetDescription>
            <Button
              size="sm"
              variant="outline"
              className="mt-2 w-fit"
              disabled={busy || pending !== null}
              onClick={() =>
                void act(
                  "save",
                  `/api/projects/${projectId}/versions`,
                  (d) => `Saved version ${d.version?.number}`,
                )
              }
            >
              {pending === "save" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Save className="size-3.5" />
              )}
              Save manual edits
            </Button>
          </SheetHeader>
          <ScrollArea className="min-h-0 flex-1">
            {!versions ? (
              <div className="p-6">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            ) : versions.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">
                No versions yet. One is saved after each finished request.
              </p>
            ) : (
              <ol className="divide-y">
                {versions.map((v) => (
                  <li key={v.id} className="flex gap-3 p-4">
                    <div className="grid size-8 shrink-0 place-items-center rounded-md border text-xs font-medium tabular-nums">
                      v{v.number}
                    </div>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <p className="line-clamp-2 text-sm">{v.title}</p>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <Badge variant="secondary" className="h-5 px-1.5 text-[11px] font-normal">
                          {SOURCE[v.source]}
                        </Badge>
                        <span>{formatDistanceToNow(new Date(v.createdAt), { addSuffix: true })}</span>
                        <span>· {v.changedFiles.length} files</span>
                        {v.number === latest && (
                          <span className="font-medium text-foreground">· Current</span>
                        )}
                      </div>
                      <div className="flex gap-1.5 pt-0.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => setDiffFor(v)}
                        >
                          <GitCompare className="size-3.5" /> Changes
                        </Button>
                        {v.number !== latest && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            disabled={busy || pending !== null}
                            onClick={() =>
                              void act(v.id, `/api/projects/${projectId}/versions/${v.id}/restore`, (d) =>
                                d.unchanged
                                  ? "Already matches that version"
                                  : `Restored v${v.number} as v${d.version?.number}`,
                              )
                            }
                          >
                            {pending === v.id ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <RotateCcw className="size-3.5" />
                            )}
                            Restore
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </ScrollArea>
        </SheetContent>
      </Sheet>
      {diffFor && <DiffDialog projectId={projectId} version={diffFor} onClose={() => setDiffFor(null)} />}
    </>
  );
}

interface DiffInfo {
  from: number;
  to: number;
  base: string;
  files: { status: "A" | "M" | "D" | "R"; path: string }[];
}

const STATUS_STYLE: Record<string, string> = {
  A: "text-emerald-600",
  M: "text-amber-600",
  D: "text-destructive",
  R: "text-sky-600",
};

function DiffDialog({
  projectId,
  version,
  onClose,
}: {
  projectId: string;
  version: Version;
  onClose: () => void;
}) {
  const { resolvedTheme } = useTheme();
  const [info, setInfo] = useState<DiffInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [content, setContent] = useState<{ before: string; after: string } | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/projects/${projectId}/versions/${version.id}/diff`);
      const data = (await res.json()) as DiffInfo & { error?: string };
      if (!res.ok) return setError(data.error ?? "Couldn't load changes");
      setInfo(data);
      setFile(data.files[0]?.path ?? null);
    })();
  }, [projectId, version.id]);

  useEffect(() => {
    if (!file || !info) return;
    setContent(null);
    void (async () => {
      const q = new URLSearchParams({ path: file, base: info.base });
      const res = await fetch(`/api/projects/${projectId}/versions/${version.id}/file?${q}`);
      if (res.ok) setContent((await res.json()) as { before: string; after: string });
    })();
  }, [file, info, projectId, version.id]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[85vh] max-w-[min(1200px,95vw)] flex-col gap-0 p-0 sm:max-w-[min(1200px,95vw)]">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="text-sm">
            Changes in v{version.number}{" "}
            {info && <span className="font-normal text-muted-foreground">compared with v{info.from}</span>}
          </DialogTitle>
        </DialogHeader>
        {error ? (
          <p className="p-6 text-sm text-muted-foreground">{error}</p>
        ) : !info ? (
          <div className="p-6">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            <ScrollArea className="w-64 shrink-0 border-r">
              <ul className="py-1 text-[13px]">
                {info.files.map((f) => (
                  <li key={f.path}>
                    <button
                      onClick={() => setFile(f.path)}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-muted",
                        file === f.path && "bg-muted",
                      )}
                    >
                      <span className={cn("w-3 font-mono text-xs font-semibold", STATUS_STYLE[f.status])}>
                        {f.status}
                      </span>
                      <span className="truncate">{f.path}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </ScrollArea>
            <div className="min-w-0 flex-1">
              {content ? (
                <DiffEditor
                  original={content.before}
                  modified={content.after}
                  language={file?.endsWith(".css") ? "css" : file?.endsWith(".json") ? "json" : "typescript"}
                  theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
                  options={{
                    readOnly: true,
                    renderSideBySide: true,
                    minimap: { enabled: false },
                    fontSize: 12,
                  }}
                />
              ) : (
                <div className="grid h-full place-items-center">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
