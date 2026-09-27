"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface BrowserErr {
  id: string;
  kind: string;
  message: string;
  url: string | null;
  createdAt: string;
}

export function LogsPanel({ projectId, refreshKey }: { projectId: string; refreshKey: number }) {
  const [tab, setTab] = useState<"server" | "browser">("server");
  const [logs, setLogs] = useState<string | null>(null);
  const [errors, setErrors] = useState<BrowserErr[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [l, b] = await Promise.all([
      fetch(`/api/projects/${projectId}/logs`).then((r) => r.json().then((d) => ({ ok: r.ok, d }))),
      fetch(`/api/projects/${projectId}/browser-errors`).then((r) => r.json()),
    ]);
    if (l.ok) setLogs(String(l.d.logs ?? ""));
    else setError(l.d.error ?? "Couldn't load logs");
    setErrors((b.errors as BrowserErr[]) ?? []);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b px-2 py-1.5">
        {(["server", "browser"] as const).map((t) => (
          <Button
            key={t}
            variant="ghost"
            size="sm"
            className={cn("h-7 text-xs", tab === t && "bg-muted")}
            onClick={() => setTab(t)}
          >
            {t === "server" ? "Dev server" : `Browser errors${errors.length ? ` (${errors.length})` : ""}`}
          </Button>
        ))}
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto size-7"
          onClick={() => void load()}
          aria-label="Refresh logs"
        >
          <RefreshCw className="size-3.5" />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {tab === "server" ? (
          <pre className="p-3 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {error ?? (logs === null ? "Loading…" : logs.trim() || "No output yet.")}
          </pre>
        ) : errors.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">No runtime errors captured from the preview.</p>
        ) : (
          <ul className="divide-y text-xs">
            {errors.map((e) => (
              <li key={e.id} className="space-y-0.5 p-3">
                <div className="flex gap-2 text-muted-foreground">
                  <span className="font-medium text-destructive">{e.kind}</span>
                  <span>{e.url}</span>
                  <span className="ml-auto">{new Date(e.createdAt).toLocaleTimeString()}</span>
                </div>
                <div className="font-mono break-words">{e.message}</div>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}
