"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  FileCode2,
  FilePen,
  FileSearch,
  Loader2,
  Package,
  Sparkles,
  Terminal,
  Wrench,
  XCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { Step } from "./use-project-stream";

type ToolStep = Extract<Step, { kind: "tool" }>;

function label(s: ToolStep): { icon: ReactNode; text: ReactNode } {
  const i = s.input;
  const code = (v: unknown) => (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">{String(v ?? "")}</code>
  );
  switch (s.name) {
    case "write_file":
      return { icon: <FileCode2 />, text: <>Wrote {code(i.path)}</> };
    case "edit_file":
      return { icon: <FilePen />, text: <>Edited {code(i.path)}</> };
    case "delete_file":
      return { icon: <FilePen />, text: <>Deleted {code(i.path)}</> };
    case "read_file":
      return { icon: <FileSearch />, text: <>Read {code(i.path)}</> };
    case "list_files":
      return { icon: <FileSearch />, text: <>Listed files</> };
    case "run_command":
      return { icon: <Terminal />, text: <>Ran {code(String(i.command ?? "").slice(0, 60))}</> };
    case "install_packages":
      return { icon: <Package />, text: <>Installed {code(((i.packages as string[]) ?? []).join(" "))}</> };
    case "get_browser_errors":
      return { icon: <FileSearch />, text: <>Checked for runtime errors</> };
    case "get_dev_server_logs":
      return { icon: <Terminal />, text: <>Checked dev server logs</> };
    default:
      return { icon: <Wrench />, text: s.name };
  }
}

/** Collapse runs of consecutive reads into one row to keep the timeline scannable. */
function group(steps: Step[]): (Step | { kind: "reads"; items: ToolStep[] })[] {
  const out: (Step | { kind: "reads"; items: ToolStep[] })[] = [];
  for (const s of steps) {
    const prev = out.at(-1);
    const isRead = s.kind === "tool" && (s.name === "read_file" || s.name === "list_files");
    if (isRead && prev?.kind === "reads") prev.items.push(s);
    else if (isRead) out.push({ kind: "reads", items: [s] });
    else out.push(s);
  }
  return out;
}

function Row({
  icon,
  children,
  status,
  detail,
}: {
  icon: ReactNode;
  children: ReactNode;
  status?: "running" | "ok" | "error";
  detail?: string;
}) {
  const head = (
    <div className="flex min-w-0 items-center gap-2 py-1 text-[13px] text-muted-foreground [&_svg]:size-3.5 [&_svg]:shrink-0">
      {status === "running" ? <Loader2 className="animate-spin" /> : icon}
      <span className={cn("min-w-0 truncate", status === "error" && "text-destructive")}>{children}</span>
      {detail && (
        <ChevronRight className="ml-auto opacity-50 transition-transform group-data-[state=open]:rotate-90" />
      )}
    </div>
  );
  if (!detail) return head;
  return (
    <Collapsible className="group">
      <CollapsibleTrigger className="w-full text-left hover:text-foreground">{head}</CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="my-1 max-h-60 overflow-auto rounded-md border bg-muted/50 p-2 font-mono text-[11px] whitespace-pre-wrap">
          {detail}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function Timeline({
  steps,
  liveText,
  running,
  queuePosition = 0,
}: {
  steps: Step[];
  liveText: string;
  running: boolean;
  queuePosition?: number;
}) {
  return (
    <div className="space-y-1">
      {running && queuePosition > 0 && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-[13px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          Waiting for a free sandbox · #{queuePosition} in line
        </div>
      )}
      {group(steps).map((s, idx) => {
        switch (s.kind) {
          case "plan":
            return (
              <div key={idx} className="my-2 rounded-lg border bg-muted/40 p-3 text-[13px]">
                <div className="mb-1 flex items-center gap-1.5 font-medium">
                  <Sparkles className="size-3.5" /> Plan
                </div>
                <p className="whitespace-pre-wrap text-muted-foreground">{s.text}</p>
              </div>
            );
          case "text":
            return (
              <p key={idx} className="py-1 text-[13px] whitespace-pre-wrap">
                {s.text}
              </p>
            );
          case "reads":
            return (
              <Row
                key={idx}
                icon={<FileSearch />}
                status={s.items.some((r) => r.status === "running") ? "running" : "ok"}
                detail={s.items.map((r) => String(r.input.path ?? ".")).join("\n")}
              >
                {s.items.length === 1 ? label(s.items[0]!).text : `Read ${s.items.length} files`}
              </Row>
            );
          case "tool": {
            const l = label(s);
            const detail =
              s.name === "run_command" || s.name === "install_packages" || s.status === "error"
                ? s.output
                : undefined;
            return (
              <Row key={idx} icon={l.icon} status={s.status} detail={detail}>
                {l.text}
              </Row>
            );
          }
          case "check":
            return (
              <Row
                key={idx}
                icon={
                  s.ok ? (
                    <CheckCircle2 className="text-emerald-600" />
                  ) : (
                    <XCircle className="text-destructive" />
                  )
                }
                status={s.ok ? "ok" : "error"}
                detail={s.ok ? undefined : s.summary}
              >
                {s.ok
                  ? `Checks passed: typecheck, build, render (${(s.durationMs / 1000).toFixed(1)}s)`
                  : "Checks found problems"}
              </Row>
            );
          case "heal":
            return (
              <Row key={idx} icon={<Wrench />}>
                Fixing errors (attempt {s.round})
              </Row>
            );
          case "error":
            return (
              <Row key={idx} icon={<AlertTriangle className="text-destructive" />} status="error">
                {s.message}
              </Row>
            );
        }
      })}
      {liveText && <p className="py-1 text-[13px] whitespace-pre-wrap text-muted-foreground">{liveText}</p>}
      {running && !liveText && queuePosition === 0 && (
        <div className="flex items-center gap-2 py-1 text-[13px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Working…
        </div>
      )}
    </div>
  );
}
