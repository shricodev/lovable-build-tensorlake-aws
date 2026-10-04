import type { ToolSpec } from "@lovable-diy/llm";
import { z } from "zod";
import { getBrowserErrors } from "./browser-errors";
import { deleteFile } from "./delete-file";
import { getDevServerLogs } from "./dev-server-logs";
import { editFile } from "./edit-file";
import { finish } from "./finish";
import { installPackages } from "./install-packages";
import { listFiles } from "./list-files";
import { readFile } from "./read-file";
import { runCommand } from "./run-command";
import type { AgentTool } from "./types";
import { writeFile } from "./write-file";

export type { AgentTool, BrowserError, ToolContext, ToolOutput } from "./types";

// Order is part of the prompt-cache prefix: keep it fixed.
export const TOOLS: AgentTool[] = [
  listFiles,
  readFile,
  writeFile,
  editFile,
  deleteFile,
  runCommand,
  installPackages,
  getDevServerLogs,
  getBrowserErrors,
  finish,
] as AgentTool[];

const byName = new Map(TOOLS.map((t) => [t.name, t]));

export function toolSpecs(): ToolSpec[] {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: z.toJSONSchema(t.schema, { io: "input" }) as Record<string, unknown>,
  }));
}

export function findTool(name: string): AgentTool | undefined {
  return byName.get(name);
}
