import type { ToolSpec } from "@kiln/llm";
import { z } from "zod";
import { getBrowserErrors } from "./browser-errors.js";
import { deleteFile } from "./delete-file.js";
import { getDevServerLogs } from "./dev-server-logs.js";
import { editFile } from "./edit-file.js";
import { finish } from "./finish.js";
import { installPackages } from "./install-packages.js";
import { listFiles } from "./list-files.js";
import { readFile } from "./read-file.js";
import { runCommand } from "./run-command.js";
import type { AgentTool } from "./types.js";
import { writeFile } from "./write-file.js";

export type { AgentTool, BrowserError, ToolContext, ToolOutput } from "./types.js";

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
