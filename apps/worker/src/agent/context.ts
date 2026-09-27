import type { LlmMessage, UserMessage, UserPart } from "@kiln/llm";
import type { ProjectSandbox } from "@kiln/sandbox";

export interface PriorTurn {
  prompt: string;
  summary: string;
}

/**
 * Context strategy (ADR-015): each turn starts a fresh conversation instead
 * of replaying every past tool call. It carries
 *   - one-line summaries of earlier turns (prompt → what the agent did),
 *   - a compact file tree and the dependency list,
 *   - the current App.tsx (almost always relevant),
 * and the agent reads anything else it needs with tools. Inside a turn, old
 * tool results are elided once the transcript gets large (`elideOldToolResults`).
 */
export async function buildTurnMessage(opts: {
  sandbox: ProjectSandbox;
  prompt: string;
  priorTurns: PriorTurn[];
  images?: Extract<UserPart, { type: "image" }>[];
}): Promise<UserMessage> {
  const [files, pkg, app] = await Promise.all([
    opts.sandbox.listFiles(".", 400),
    opts.sandbox.readFile("package.json").catch(() => "{}"),
    opts.sandbox.readFile("src/App.tsx").catch(() => ""),
  ]);
  const deps = (() => {
    try {
      const p = JSON.parse(pkg) as { dependencies?: Record<string, string> };
      return Object.keys(p.dependencies ?? {}).join(", ");
    } catch {
      return "(unreadable package.json)";
    }
  })();
  const tree = files
    .filter((f) => !f.isDir)
    .map((f) => f.path)
    .sort()
    .join("\n");

  const history = opts.priorTurns.length
    ? opts.priorTurns
        .slice(-15)
        .map(
          (t, i) => `${i + 1}. User asked: ${oneLine(t.prompt, 300)}\n   You did: ${oneLine(t.summary, 400)}`,
        )
        .join("\n")
    : "(none: this is the first request for this project)";

  const text = [
    "<project_state>",
    `Files:\n${tree}`,
    `\nInstalled dependencies: ${deps}`,
    `\nsrc/App.tsx:\n\`\`\`tsx\n${app}\n\`\`\``,
    "</project_state>",
    "",
    `<previous_turns>\n${history}\n</previous_turns>`,
    "",
    `<user_request>\n${opts.prompt}\n</user_request>`,
  ].join("\n");

  return { role: "user", content: [...(opts.images ?? []), { type: "text", text }] };
}

/**
 * Replace the bodies of older tool results once the transcript exceeds a
 * character budget. Recent results stay intact. Only applied when needed,
 * because editing earlier messages invalidates the prompt cache.
 */
export function elideOldToolResults(
  messages: LlmMessage[],
  budgetChars = 300_000,
  keepRecent = 8,
): LlmMessage[] {
  const size = messages.reduce((n, m) => n + JSON.stringify(m).length, 0);
  if (size <= budgetChars) return messages;
  let seen = 0;
  return messages
    .slice()
    .reverse()
    .map((m) => {
      if (m.role !== "user" || typeof m.content === "string") return m;
      const hasResults = m.content.some((p) => p.type === "tool_result");
      if (!hasResults) return m;
      seen++;
      if (seen <= keepRecent) return m;
      return {
        ...m,
        content: m.content.map((p) =>
          p.type === "tool_result" && p.content.length > 400
            ? { ...p, content: `${p.content.slice(0, 200)}\n… [older tool output elided to save context]` }
            : p,
        ),
      };
    })
    .reverse();
}

function oneLine(s: string, max: number) {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}
