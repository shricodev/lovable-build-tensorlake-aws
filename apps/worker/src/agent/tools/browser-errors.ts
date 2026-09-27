import { z } from "zod";
import { defineTool } from "./types.js";

export const getBrowserErrors = defineTool({
  name: "get_browser_errors",
  description:
    "Get runtime errors from rendering the app (uncaught exceptions, unhandled rejections, console.error). Use after changes to confirm the UI renders cleanly.",
  schema: z.object({}),
  async run(_input, { getBrowserErrors }) {
    const errors = await getBrowserErrors();
    if (errors.length === 0) return { content: "No runtime errors." };
    return {
      content: errors
        .slice(0, 15)
        .map(
          (e, i) =>
            `${i + 1}. [${e.source}${e.url ? ` ${e.url}` : ""}] ${e.message}${e.stack ? `\n${e.stack.split("\n").slice(0, 6).join("\n")}` : ""}`,
        )
        .join("\n\n"),
    };
  },
});
