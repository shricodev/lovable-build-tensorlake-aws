"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDefaultLayout } from "react-resizable-panels";
import { toast } from "sonner";
import { pillFor, StatusPill } from "@/components/app/status-pill";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChatPanel, type ChatMessage } from "./chat-panel";
import { CodePanel } from "./code-panel";
import { LogsPanel } from "./logs-panel";
import { PreviewPanel } from "./preview-panel";
import { TerminalPanel } from "./terminal-panel";
import { useProjectStream, type VersionEvent } from "./use-project-stream";
import { VersionsSheet } from "./versions-sheet";

const MODELS = [
  { ref: "anthropic:claude-sonnet-5", label: "Claude Sonnet 5" },
  { ref: "anthropic:claude-opus-5", label: "Claude Opus 5" },
  { ref: "openai:gpt-5.5", label: "GPT-5.5" },
];

/** localStorage that is safe to touch during server rendering. */
const layoutStorage = {
  getItem: (k: string) => (typeof window === "undefined" ? null : window.localStorage.getItem(k)),
  setItem: (k: string, v: string) => {
    if (typeof window !== "undefined") window.localStorage.setItem(k, v);
  },
};

export interface WorkspaceProps {
  project: { id: string; name: string };
  messages: ChatMessage[];
  activeRunId: string | null;
  lastSuggestions: string[];
  sandboxStatus: string | null;
  previewUrl: string;
}

export function Workspace(props: WorkspaceProps) {
  const router = useRouter();
  const { project, previewUrl } = props;
  const [tab, setTab] = useState("preview");
  const [reloadKey, setReloadKey] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [route, setRoute] = useState("/");
  const [model, setModel] = useState(MODELS[0]!.ref);
  const [terminalOpened, setTerminalOpened] = useState(false);
  const [versionsKey, setVersionsKey] = useState(0);
  const layout = useDefaultLayout({ id: "kiln-workspace", storage: layoutStorage });

  useEffect(() => {
    const saved = localStorage.getItem("kiln-model");
    if (saved && MODELS.some((m) => m.ref === saved)) setModel(saved);
  }, []);

  const stream = useProjectStream(
    project.id,
    { sandboxStatus: props.sandboxStatus, activeRunId: props.activeRunId },
    {
      onRunDone: (status) => {
        router.refresh();
        setRefreshKey((k) => k + 1);
        if (status === "succeeded") toast.success("Done. Your app is updated.");
        else if (status === "failed") toast.error("The agent couldn't finish this request.");
      },
      // The first sandbox for a project comes up mid-run: reload the "no preview yet" page.
      onSandboxRunning: (wakeMs) => {
        setReloadKey((k) => k + 1);
        if (wakeMs) toast(`Sandbox woke up in ${(wakeMs / 1000).toFixed(1)}s`);
      },
      onVersion: (v) => {
        setVersionsKey((k) => k + 1);
        toast.success(`Version ${v.number} saved`);
        captureThumbnail(v);
      },
    },
  );

  // Ask the preview to render itself to a JPEG (kiln/error-capture.ts) once HMR has applied the changes.
  const captureThumbnail = (v: VersionEvent) => {
    setTimeout(() => {
      const frame = document.querySelector<HTMLIFrameElement>('iframe[title="App preview"]');
      frame?.contentWindow?.postMessage(
        { source: "kiln-parent", kind: "capture", id: v.id },
        new URL(previewUrl).origin,
      );
    }, 2500);
  };

  const send = useCallback(
    async (prompt: string) => {
      const res = await fetch(`/api/projects/${project.id}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, model }),
      });
      if (!res.ok) {
        toast.error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't send");
        return false;
      }
      router.refresh();
      return true;
    },
    [project.id, model, router],
  );

  const stop = useCallback(async () => {
    if (!stream.runId) return;
    await fetch(`/api/runs/${stream.runId}/cancel`, { method: "POST" });
    toast("Stopping…");
  }, [stream.runId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && stream.running) void stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stream.running, stop]);

  // Errors and route changes posted by the preview (kiln/error-capture.ts). Batched to the API.
  const pending = useRef<unknown[]>([]);
  useEffect(() => {
    const origin = new URL(previewUrl).origin;
    const flush = setInterval(() => {
      if (!pending.current.length) return;
      const errors = pending.current.splice(0, 20);
      void fetch(`/api/projects/${project.id}/browser-errors`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ errors }),
      });
    }, 2000);
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== origin) return;
      const d = e.data as {
        source?: string;
        kind?: string;
        message?: string;
        stack?: string;
        url?: string;
        id?: string;
        dataUrl?: string;
      };
      if (d?.source !== "kiln-preview") return;
      if (d.kind === "route") setRoute(d.url ?? "/");
      else if (d.kind === "capture") {
        if (d.dataUrl && d.id)
          void fetch(`/api/projects/${project.id}/thumbnail`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ versionId: d.id, dataUrl: d.dataUrl }),
          });
      } else if (d.kind && d.message)
        pending.current.push({ kind: d.kind, message: d.message, stack: d.stack, url: d.url });
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      clearInterval(flush);
    };
  }, [previewUrl, project.id]);

  const suggestions = stream.lastDone?.suggestions.length
    ? stream.lastDone.suggestions
    : props.lastSuggestions;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-3">
        <Button variant="ghost" size="icon" className="size-8" asChild>
          <Link href="/projects" aria-label="Back to projects">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <h1 className="truncate text-sm font-medium">{project.name}</h1>
        <StatusPill status={pillFor(stream.sandboxStatus, stream.running)} />
        {!stream.connected && <span className="text-xs text-muted-foreground">Reconnecting…</span>}
        <div className="ml-auto flex items-center gap-2">
          <VersionsSheet projectId={project.id} busy={stream.running} refreshKey={versionsKey} />
          <select
            value={model}
            onChange={(e) => {
              setModel(e.target.value);
              localStorage.setItem("kiln-model", e.target.value);
            }}
            className="h-8 rounded-md border bg-background px-2 text-xs"
            aria-label="Model"
          >
            {MODELS.map((m) => (
              <option key={m.ref} value={m.ref}>
                {m.label}
              </option>
            ))}
          </select>
          <ThemeToggle />
        </div>
      </header>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1" {...layout}>
        <ResizablePanel id="chat" defaultSize="32" minSize="22">
          <ChatPanel
            messages={props.messages}
            stream={stream}
            suggestions={suggestions}
            onSend={send}
            onStop={() => void stop()}
          />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel id="main" defaultSize="68" minSize="35">
          <Tabs
            value={tab}
            onValueChange={(t) => {
              setTab(t);
              if (t === "terminal") setTerminalOpened(true);
            }}
            className="flex h-full flex-col gap-0"
          >
            <div className="border-b px-2 py-1.5">
              <TabsList>
                <TabsTrigger value="preview">Preview</TabsTrigger>
                <TabsTrigger value="code">Code</TabsTrigger>
                <TabsTrigger value="terminal">Terminal</TabsTrigger>
                <TabsTrigger value="logs">Logs</TabsTrigger>
              </TabsList>
            </div>
            {/* Preview stays mounted so switching tabs doesn't reload the app. */}
            <TabsContent value="preview" forceMount className="min-h-0 flex-1 data-[state=inactive]:hidden">
              <PreviewPanel previewUrl={previewUrl} reloadKey={reloadKey} route={route} />
            </TabsContent>
            <TabsContent value="code" className="min-h-0 flex-1">
              <CodePanel projectId={project.id} readOnly={stream.running} refreshKey={refreshKey} />
            </TabsContent>
            {/* Kept mounted after the first visit so switching tabs doesn't drop the shell. */}
            <TabsContent value="terminal" forceMount className="min-h-0 flex-1 data-[state=inactive]:hidden">
              {terminalOpened && <TerminalPanel projectId={project.id} />}
            </TabsContent>
            <TabsContent value="logs" className="min-h-0 flex-1">
              <LogsPanel projectId={project.id} refreshKey={refreshKey} />
            </TabsContent>
          </Tabs>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
