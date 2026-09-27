import { z } from "zod";
import { defineTool } from "./types";

const MAX_CHARS = 60_000;

export const readFile = defineTool({
  name: "read_file",
  description: "Read a text file from the project. Always read a file before editing it.",
  schema: z.object({ path: z.string().describe("File path relative to the project root") }),
  async run({ path }, { sandbox }) {
    const text = await sandbox.readFile(path);
    if (text.length > MAX_CHARS) {
      return {
        content: `${text.slice(0, MAX_CHARS)}\n… [file truncated at ${MAX_CHARS} of ${text.length} characters]`,
      };
    }
    return { content: text || "(empty file)" };
  },
});
