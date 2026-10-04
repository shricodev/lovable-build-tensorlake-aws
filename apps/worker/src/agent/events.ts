import type { Usage } from "@lovable-diy/llm";

/**
 * Everything an agent turn reports as it happens. Phase 3 persists these to
 * `run_events` and streams them to the browser; the CLI just prints them.
 */
export type AgentEvent =
  | { type: "status"; status: "thinking" | "working" | "verifying" | "healing"; round?: number }
  | { type: "plan"; text: string }
  | { type: "message_delta"; text: string }
  | { type: "message"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | {
      type: "tool_result";
      id: string;
      name: string;
      ok: boolean;
      output: string;
      changedFiles?: string[];
      ms: number;
    }
  | { type: "check"; ok: boolean; round: number; summary: string; durationMs: number }
  | { type: "usage"; model: string; usage: Usage; costUsd: number }
  | { type: "error"; message: string };
