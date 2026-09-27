import { z } from "zod";
import { defineTool } from "./types";

export const listFiles = defineTool({
  name: "list_files",
  description:
    "List files under a project directory (recursive; skips node_modules, .git, dist). Paths are relative to the project root.",
  schema: z.object({
    path: z.string().default(".").describe("Directory relative to the project root, e.g. 'src'"),
  }),
  async run({ path }, { sandbox }) {
    const entries = await sandbox.listFiles(path, 500);
    if (entries.length === 0) return { content: "(empty)" };
    return {
      content: entries.map((e) => (e.isDir ? `${e.path}/` : `${e.path} (${e.size} B)`)).join("\n"),
    };
  },
});
