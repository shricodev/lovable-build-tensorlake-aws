import type { ProjectSandbox } from "@lovable-diy/sandbox";
import type { BrowserError } from "./tools/index";

export interface CheckResult {
  ok: boolean;
  typecheck: { ok: boolean; output: string };
  build: { ok: boolean; output: string };
  render: { ok: boolean; rendered: boolean; errors: BrowserError[] };
  durationMs: number;
}

/**
 * The "did it work?" gate after the agent says it's done: tsc,
 * a production build (to a temp dir so dist/ never lands in git), and a
 * one-shot DOM render. No browser, a few seconds total.
 */
export async function runChecks(sandbox: ProjectSandbox): Promise<CheckResult> {
  const t0 = performance.now();
  const tsc = await sandbox.exec("npx tsc --noEmit -p . 2>&1", { timeoutSecs: 120, maxOutput: 6000 });
  const build = await sandbox.exec(
    "npx vite build --outDir /tmp/lovable-diy-build --emptyOutDir --logLevel error 2>&1",
    { timeoutSecs: 180, maxOutput: 6000 },
  );
  const render = await renderCheck(sandbox);
  return {
    ok: tsc.exitCode === 0 && build.exitCode === 0 && render.ok,
    typecheck: { ok: tsc.exitCode === 0, output: tsc.stdout.trim() },
    build: { ok: build.exitCode === 0, output: build.stdout.trim() },
    render,
    durationMs: Math.round(performance.now() - t0),
  };
}

export async function renderCheck(sandbox: ProjectSandbox): Promise<CheckResult["render"]> {
  const r = await sandbox.exec("node lovable-diy/check.mjs", { timeoutSecs: 60, maxOutput: 20_000 });
  const last = r.stdout.trim().split("\n").pop() ?? "";
  try {
    const parsed = JSON.parse(last) as { ok: boolean; rendered: boolean; errors: string[] };
    return {
      ok: parsed.ok,
      rendered: parsed.rendered,
      errors: parsed.errors.map((e) => {
        const [message, ...stack] = e.split("\n");
        return { message: message ?? e, stack: stack.join("\n") || undefined, source: "dom-check" as const };
      }),
    };
  } catch {
    return {
      ok: false,
      rendered: false,
      errors: [
        { message: `Render check crashed: ${(r.stderr || r.stdout).slice(-1500)}`, source: "dom-check" },
      ],
    };
  }
}

/** Failure report handed back to the agent for a heal round. */
export function describeFailures(c: CheckResult): string {
  const out: string[] = [];
  if (!c.typecheck.ok) out.push(`## TypeScript errors (npx tsc --noEmit)\n${c.typecheck.output}`);
  if (!c.build.ok) out.push(`## Build failed (vite build)\n${c.build.output}`);
  if (!c.render.ok) {
    const errs = c.render.errors.map(
      (e) => `- ${e.message}${e.stack ? `\n${e.stack.split("\n").slice(0, 5).join("\n")}` : ""}`,
    );
    out.push(
      `## Render check failed${c.render.rendered ? "" : " (nothing rendered into #root)"}\n${errs.join("\n") || "- no error message captured"}`,
    );
  }
  return out.join("\n\n");
}
