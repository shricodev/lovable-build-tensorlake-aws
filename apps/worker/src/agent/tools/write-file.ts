import { z } from "zod";
import { defineTool } from "./types.js";

export const writeFile = defineTool({
  name: "write_file",
  description:
    "Create a file or replace its whole content. Parent directories are created automatically. Prefer edit_file for small changes to existing files.",
  schema: z.object({
    path: z.string().describe("File path relative to the project root"),
    content: z.string().describe("The complete file content"),
  }),
  async run({ path, content }, { sandbox }) {
    await sandbox.writeFile(path, content);
    return { content: `Wrote ${path} (${content.length} chars)`, changedFiles: [path] };
  },
});
