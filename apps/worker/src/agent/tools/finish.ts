import { z } from "zod";
import { defineTool } from "./types";

export const finish = defineTool({
  name: "finish",
  description:
    "Call when the requested change is complete. Kiln then verifies the app (typecheck, build, render check); if anything fails you'll get the errors to fix.",
  schema: z.object({
    summary: z.string().min(1).describe("1-3 sentences for the user describing what you built or changed"),
    suggestions: z
      .array(z.string())
      .max(4)
      .default([])
      .describe("Short follow-up ideas, e.g. 'Add dark mode'"),
  }),
  async run({ summary, suggestions }) {
    return { content: "Verifying…", finish: { summary, suggestions } };
  },
});
