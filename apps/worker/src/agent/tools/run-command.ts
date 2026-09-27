import { z } from "zod";
import { defineTool } from "./types";

/** Commands the agent should not run through this tool (policy, not a security boundary: the sandbox is). */
const BLOCKED: Array<[RegExp, string]> = [
  [
    /\b(npm|pnpm|yarn)\s+(i|install|add)\b|\bnpx\s+.*\binstall\b/,
    "Use the install_packages tool to add dependencies.",
  ],
  [
    // any `vite` invocation except `vite build`
    /\b(npm|pnpm|yarn)\s+(run\s+)?(dev|start|preview)\b|(^|[\s;&|(])(npx\s+)?vite(?!\s+build\b)(\s|$)/,
    "The dev server is already running and managed by Kiln; don't start another one.",
  ],
];

export const runCommand = defineTool({
  name: "run_command",
  description:
    "Run a shell command in the project root (bash). Returns exit code, stdout and stderr (long output is truncated). Use for quick checks like `npx tsc --noEmit`. Do not start servers or install packages with it.",
  schema: z.object({
    command: z.string().min(1).max(2000),
    timeout_seconds: z.number().int().min(1).max(300).default(60),
  }),
  async run({ command, timeout_seconds }, { sandbox, log }) {
    for (const [re, why] of BLOCKED) if (re.test(command)) return { isError: true, content: why };
    log.info({ command }, "agent run_command");
    const r = await sandbox.exec(command, { timeoutSecs: timeout_seconds });
    const parts = [`exit code: ${r.exitCode}${r.timedOut ? " (timed out)" : ""}`];
    if (r.stdout.trim()) parts.push(`stdout:\n${r.stdout}`);
    if (r.stderr.trim()) parts.push(`stderr:\n${r.stderr}`);
    return { content: parts.join("\n"), isError: r.exitCode !== 0 };
  },
});
