"use client";

import Editor from "@monaco-editor/react";
import { File, Folder, Loader2, RefreshCw, Save } from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface Entry {
  path: string;
  isDir: boolean;
}

const LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  json: "json",
  css: "css",
  html: "html",
  md: "markdown",
};

export function CodePanel({
  projectId,
  readOnly,
  refreshKey,
}: {
  projectId: string;
  readOnly: boolean;
  refreshKey: number;
}) {
  const { resolvedTheme } = useTheme();
  const [files, setFiles] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/projects/${projectId}/files`);
    const data = (await res.json()) as { files?: Entry[]; error?: string };
    if (!res.ok) return setError(data.error ?? "Couldn't load files");
    setFiles(data.files!.sort((a, b) => a.path.localeCompare(b.path)));
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function openFile(path: string) {
    const res = await fetch(`/api/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`);
    const data = (await res.json()) as { content?: string; error?: string };
    if (!res.ok) return toast.error(data.error ?? "Couldn't open file");
    setOpen(path);
    setContent(data.content ?? "");
    setSaved(data.content ?? "");
  }

  const save = useCallback(async () => {
    if (!open || readOnly || content === saved) return;
    setSaving(true);
    const res = await fetch(`/api/projects/${projectId}/files/content`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: open, content }),
    });
    setSaving(false);
    if (!res.ok) return toast.error(((await res.json()) as { error?: string }).error ?? "Save failed");
    setSaved(content);
    toast.success(`Saved ${open}`);
  }, [open, readOnly, content, saved, projectId]);

  // Reload the open file when the agent finishes a turn.
  const openRef = useRef<string | null>(null);
  openRef.current = open;
  const openFileRef = useRef(openFile);
  openFileRef.current = openFile;
  useEffect(() => {
    if (openRef.current) void openFileRef.current(openRef.current);
  }, [refreshKey]);

  if (error) {
    return (
      <div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">
        {error}
      </div>
    );
  }
  const ext = open?.split(".").pop() ?? "";

  return (
    <div className="flex h-full">
      <div className="flex w-60 shrink-0 flex-col border-r">
        <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs font-medium text-muted-foreground">
          Files
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={() => void load()}
            aria-label="Refresh files"
          >
            <RefreshCw className="size-3" />
          </Button>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          {!files ? (
            <div className="p-3">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ul className="py-1 text-[13px]">
              {files.map((f) => {
                const depth = f.path.split("/").length - 1;
                const name = f.path.split("/").pop();
                return (
                  <li key={f.path}>
                    <button
                      disabled={f.isDir}
                      onClick={() => void openFile(f.path)}
                      className={cn(
                        "flex w-full items-center gap-1.5 px-3 py-0.5 text-left hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent",
                        open === f.path && "bg-muted font-medium",
                        f.isDir && "text-muted-foreground",
                      )}
                      style={{ paddingLeft: 12 + depth * 12 }}
                    >
                      {f.isDir ? (
                        <Folder className="size-3.5 shrink-0" />
                      ) : (
                        <File className="size-3.5 shrink-0" />
                      )}
                      <span className="truncate">{name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 items-center justify-between border-b px-3 text-xs text-muted-foreground">
          <span className="truncate font-mono">{open ?? "Select a file"}</span>
          <div className="flex items-center gap-2">
            {readOnly && <span>Read-only while Lovable DIY is working</span>}
            {open && !readOnly && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-xs"
                disabled={content === saved || saving}
                onClick={() => void save()}
              >
                {saving ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />} Save
              </Button>
            )}
          </div>
        </div>
        <div
          className="min-h-0 flex-1"
          onKeyDown={(e) => {
            if (e.key === "s" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void save();
            }
          }}
        >
          {open ? (
            <Editor
              path={open}
              value={content}
              language={LANG[ext] ?? "plaintext"}
              theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
              onChange={(v) => setContent(v ?? "")}
              options={{
                readOnly,
                minimap: { enabled: false },
                fontSize: 13,
                scrollBeyondLastLine: false,
                tabSize: 2,
              }}
            />
          ) : (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">
              Pick a file to view or edit it.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
