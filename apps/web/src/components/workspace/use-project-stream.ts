"use client";

import { useEffect, useReducer, useRef } from "react";

export type Step =
  | { kind: "plan"; text: string }
  | { kind: "text"; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      input: Record<string, unknown>;
      status: "running" | "ok" | "error";
      output?: string;
      ms?: number;
    }
  | { kind: "check"; ok: boolean; summary: string; round: number; durationMs: number }
  | { kind: "heal"; round: number }
  | { kind: "error"; message: string };

export interface StreamState {
  runId: string | null;
  running: boolean;
  steps: Step[];
  liveText: string;
  sandboxStatus: string | null;
  lastDone: { runId: string; status: string; suggestions: string[] } | null;
  connected: boolean;
  /** >0 while this project's run waits for a free sandbox slot. */
  queuePosition: number;
}

export interface VersionEvent {
  id: string;
  number: number;
  title: string;
  source: string;
}

interface WireEvent {
  id: number;
  runId: string | null;
  type: string;
  payload: Record<string, unknown>;
}

type Action = { t: "event"; e: WireEvent } | { t: "connected"; v: boolean };

function reduce(s: StreamState, a: Action): StreamState {
  if (a.t === "connected") return { ...s, connected: a.v };
  const { e } = a;
  const p = e.payload;
  switch (e.type) {
    case "sandbox_status":
      return { ...s, sandboxStatus: String(p.status) };
    case "queue":
      return { ...s, queuePosition: Number(p.position ?? 0) };
    case "run_started":
      return { ...s, runId: e.runId, running: true, steps: [], liveText: "", lastDone: null };
    case "message_delta":
      return { ...s, runId: e.runId, running: true, liveText: s.liveText + String(p.text ?? "") };
    case "message":
      return { ...s, liveText: "", steps: [...s.steps, { kind: "text", text: String(p.text ?? "") }] };
    case "plan": {
      const steps = [...s.steps];
      const last = steps.at(-1);
      if (last?.kind === "text") steps[steps.length - 1] = { kind: "plan", text: last.text };
      else steps.push({ kind: "plan", text: String(p.text ?? "") });
      return { ...s, steps };
    }
    case "tool_call":
      if (p.name === "finish") return s;
      return {
        ...s,
        steps: [
          ...s.steps,
          {
            kind: "tool",
            id: String(p.id),
            name: String(p.name),
            input: (p.input ?? {}) as Record<string, unknown>,
            status: "running",
          },
        ],
      };
    case "tool_result":
      return {
        ...s,
        steps: s.steps.map((st) =>
          st.kind === "tool" && st.id === p.id
            ? { ...st, status: p.ok ? "ok" : "error", output: String(p.output ?? ""), ms: Number(p.ms ?? 0) }
            : st,
        ),
      };
    case "check":
      return {
        ...s,
        steps: [
          ...s.steps,
          {
            kind: "check",
            ok: !!p.ok,
            summary: String(p.summary ?? ""),
            round: Number(p.round ?? 0),
            durationMs: Number(p.durationMs ?? 0),
          },
        ],
      };
    case "status":
      return p.status === "healing"
        ? { ...s, steps: [...s.steps, { kind: "heal", round: Number(p.round ?? 1) }] }
        : s;
    case "error":
      return { ...s, steps: [...s.steps, { kind: "error", message: String(p.message ?? "") }] };
    case "run_done":
      return {
        ...s,
        running: false,
        liveText: "",
        queuePosition: 0,
        lastDone: {
          runId: e.runId ?? "",
          status: String(p.status),
          suggestions: (p.suggestions as string[]) ?? [],
        },
      };
    default:
      return s;
  }
}

/**
 * Subscribes to the project's SSE stream. EventSource reconnects on its own
 * and sends Last-Event-ID; we also pass `after` explicitly so a reconnect
 * resumes exactly where it left off.
 */
export function useProjectStream(
  projectId: string,
  init: { sandboxStatus: string | null; activeRunId: string | null },
  handlers: {
    onRunDone?: (status: string) => void;
    onSandboxRunning?: (wakeMs?: number) => void;
    onVersion?: (v: VersionEvent) => void;
    onCloneDone?: () => void;
  },
) {
  const [state, dispatch] = useReducer(reduce, {
    runId: init.activeRunId,
    running: !!init.activeRunId,
    steps: [],
    liveText: "",
    sandboxStatus: init.sandboxStatus,
    lastDone: null,
    connected: false,
    queuePosition: 0,
  });
  const h = useRef(handlers);
  h.current = handlers;

  useEffect(() => {
    let lastId: number | null = null;
    let es: EventSource | null = null;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    // Events older than the moment we connected are a replay; don't toast them again.
    const connectedAt = Date.now();
    let replaying = true;
    const open = () => {
      const url = `/api/projects/${projectId}/stream${lastId !== null ? `?after=${lastId}` : ""}`;
      es = new EventSource(url);
      es.onopen = () => dispatch({ t: "connected", v: true });
      es.onmessage = (m) => {
        const e = JSON.parse(m.data) as WireEvent & { at?: string };
        lastId = e.id;
        replaying = !!e.at && new Date(e.at).getTime() < connectedAt - 1000;
        dispatch({ t: "event", e });
        if (e.type === "run_done" && !replaying) h.current.onRunDone?.(String(e.payload.status));
        // Side effects only for live events, not the replay of an in-progress run.
        if (!replaying) {
          if (e.type === "sandbox_status" && e.payload.status === "running")
            h.current.onSandboxRunning?.(e.payload.wakeMs as number | undefined);
          if (e.type === "version") h.current.onVersion?.(e.payload as unknown as VersionEvent);
          if (e.type === "clone_done") h.current.onCloneDone?.();
        }
      };
      es.onerror = () => {
        dispatch({ t: "connected", v: false });
        es?.close();
        if (!stopped) retry = setTimeout(open, 2000);
      };
    };
    open();
    return () => {
      stopped = true;
      clearTimeout(retry);
      es?.close();
    };
  }, [projectId]);

  return state;
}
