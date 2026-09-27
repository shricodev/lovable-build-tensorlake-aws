import { z } from "zod";
import { defineTool } from "./types.js";

export const editFile = defineTool({
  name: "edit_file",
  description:
    "Replace one exact snippet in a file. `search` must match the current file content exactly (including whitespace) and occur exactly once; include enough surrounding lines to make it unique.",
  schema: z.object({
    path: z.string().describe("File path relative to the project root"),
    search: z.string().min(1).describe("Exact text to find (must occur exactly once)"),
    replace: z.string().describe("Replacement text"),
  }),
  async run({ path, search, replace }, { sandbox }) {
    const text = await sandbox.readFile(path);
    const count = text.split(search).length - 1;
    if (count !== 1) {
      return {
        isError: true,
        content:
          count === 0
            ? `search text not found in ${path}. Re-read the file and copy the snippet exactly.`
            : `search text occurs ${count} times in ${path}; include more surrounding lines so it is unique.`,
      };
    }
    await sandbox.writeFile(
      path,
      text.replace(search, () => replace),
    );
    return { content: `Edited ${path}`, changedFiles: [path] };
  },
});
