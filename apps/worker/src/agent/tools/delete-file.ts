import { z } from "zod";
import { defineTool } from "./types.js";

export const deleteFile = defineTool({
  name: "delete_file",
  description: "Delete a file from the project.",
  schema: z.object({ path: z.string().describe("File path relative to the project root") }),
  async run({ path }, { sandbox }) {
    await sandbox.deleteFile(path);
    return { content: `Deleted ${path}`, changedFiles: [path] };
  },
});
