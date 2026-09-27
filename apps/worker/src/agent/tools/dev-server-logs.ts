import { z } from "zod";
import { defineTool } from "./types.js";

export const getDevServerLogs = defineTool({
  name: "get_dev_server_logs",
  description: "Show the most recent output of the Vite dev server (compile errors, HMR messages).",
  schema: z.object({ lines: z.number().int().min(10).max(400).default(80) }),
  async run({ lines }, { sandbox }) {
    const out = await sandbox.devServerLogs(lines);
    return { content: out.trim() || "(no output)" };
  },
});
