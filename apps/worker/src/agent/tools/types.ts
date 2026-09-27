import type { Logger } from "@kiln/shared";
import type { ProjectSandbox } from "@kiln/sandbox";
import type { z } from "zod";

export interface BrowserError {
  message: string;
  stack?: string;
  url?: string;
  source: "preview" | "dom-check";
}

export interface ToolContext {
  sandbox: ProjectSandbox;
  log: Logger;
  signal: AbortSignal;
  /** Runtime errors from the live preview (Phase 3) or, when absent, a fresh DOM check. */
  getBrowserErrors: () => Promise<BrowserError[]>;
}

export interface ToolOutput {
  content: string;
  isError?: boolean;
  /** Set by `finish`; ends the agent's working phase. */
  finish?: { summary: string; suggestions: string[] };
  /** Files touched, for the version's changed-files list and the UI timeline. */
  changedFiles?: string[];
}

export interface AgentTool<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: S;
  run(input: z.infer<S>, ctx: ToolContext): Promise<ToolOutput>;
}

/** Keeps each tool file's `run` typed against its own schema. */
export function defineTool<S extends z.ZodType>(tool: AgentTool<S>): AgentTool<S> {
  return tool;
}
