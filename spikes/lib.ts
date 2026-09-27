/**
 * Tiny harness shared by the Phase 0 spikes. Each spike records timed steps
 * and findings to spikes/out/<name>.json and always cleans up the sandboxes
 * it created. That matters on the free tier: a leaked sandbox blocks the
 * next spike, because only one can run at a time.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { Sandbox } from "tensorlake";

if (!process.env.TENSORLAKE_API_KEY) {
  console.error("TENSORLAKE_API_KEY is not set. Add it to .env and run via `pnpm spike spikes/<file>.ts`.");
  process.exit(1);
}

interface StepResult {
  step: string;
  ok: boolean;
  ms: number;
  detail?: unknown;
  error?: string;
}

export function spike(name: string) {
  const steps: StepResult[] = [];
  const findings: Record<string, unknown> = {};
  const cleanups: Array<() => Promise<unknown>> = [];

  async function step<T>(
    label: string,
    fn: () => Promise<T>,
    opts: { allowFail?: boolean } = {},
  ): Promise<T | undefined> {
    const t0 = performance.now();
    process.stdout.write(`… ${label}`);
    try {
      const out = await fn();
      const ms = Math.round(performance.now() - t0);
      steps.push({ step: label, ok: true, ms, detail: summarize(out) });
      process.stdout.write(`\r✓ ${label} (${ms} ms)\n`);
      return out;
    } catch (err) {
      const ms = Math.round(performance.now() - t0);
      const error = describeError(err);
      steps.push({ step: label, ok: false, ms, error });
      process.stdout.write(`\r✗ ${label} (${ms} ms): ${error}\n`);
      if (!opts.allowFail) throw err;
      return undefined;
    }
  }

  function note(key: string, value: unknown) {
    findings[key] = value;
    console.log(`  → ${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
  }

  /** Register a sandbox for termination when the spike ends, pass or fail. */
  function track(sb: Sandbox): Sandbox {
    cleanups.push(() => sb.terminate());
    return sb;
  }

  function onCleanup(fn: () => Promise<unknown>) {
    cleanups.push(fn);
  }

  async function run(body: () => Promise<void>) {
    let failed = false;
    try {
      await body();
    } catch {
      failed = true;
    } finally {
      for (const c of cleanups.reverse())
        await c().catch((e) => console.warn(`  cleanup: ${describeError(e)}`));
      mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
      writeFileSync(
        new URL(`./out/${name}.json`, import.meta.url),
        JSON.stringify({ name, at: new Date().toISOString(), failed, steps, findings }, null, 2),
      );
      console.log(failed ? `\n${name}: FAILED` : `\n${name}: passed`);
      process.exit(failed ? 1 : 0);
    }
  }

  return { step, note, track, onCleanup, run };
}

export function describeError(err: unknown): string {
  if (err instanceof Error) {
    const extra = Object.entries(err)
      .filter(([k]) => ["statusCode", "status", "code", "body", "detail"].includes(k))
      .map(([k, v]) => `${k}=${typeof v === "string" ? v.slice(0, 300) : JSON.stringify(v)}`);
    return `${err.name}: ${err.message}${extra.length ? ` [${extra.join(" ")}]` : ""}`;
  }
  return String(err);
}

function summarize(v: unknown): unknown {
  if (v instanceof Sandbox) return { sandboxId: v.sandboxId, name: v.name };
  if (v instanceof Uint8Array) return { bytes: v.length };
  if (typeof v === "string") return v.length > 500 ? v.slice(0, 500) + "…" : v;
  try {
    const s = JSON.stringify(v);
    return s && s.length > 2000
      ? JSON.parse(JSON.stringify(v, (_k, val) => (typeof val === "string" ? val.slice(0, 200) : val)))
      : v;
  } catch {
    return String(v);
  }
}

export const enc = new TextEncoder();
export const dec = new TextDecoder();
export const uniq = (prefix: string) => `${prefix}-${Date.now().toString(36)}`;

/** Wait until a sandbox reports one of the given statuses. */
export async function waitForStatus(sb: Sandbox, want: string[], timeoutMs = 120_000): Promise<string> {
  const t0 = Date.now();
  for (;;) {
    const s = await sb.status();
    if (want.includes(s)) return s;
    if (Date.now() - t0 > timeoutMs) throw new Error(`status stuck at ${s}, wanted ${want.join("|")}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}
