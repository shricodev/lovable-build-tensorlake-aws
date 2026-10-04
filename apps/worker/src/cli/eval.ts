/**
 * `pnpm eval [--models a,b] [--fixtures id,id]`: run each fixture through a
 * full agent turn per model, in fresh sandboxes, and report build/render
 * success, heal rounds, time, tokens and cost. Writes JSON + HTML to
 * .lovable-diy/evals/<id>/ and uploads both to S3 under evals/<id>/.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createProvider } from "@lovable-diy/llm";
import { ProjectSandbox } from "@lovable-diy/sandbox";
import { readBaseSnapshot } from "@lovable-diy/sandbox/base";
import { createLogger } from "@lovable-diy/shared";
import { Storage, storageKeys } from "@lovable-diy/storage";
import { runAgentTurn } from "../agent/loop";

interface Fixture {
  id: string;
  prompt: string;
}
interface Result {
  fixture: string;
  model: string;
  status: string;
  built: boolean;
  rendered: boolean;
  healRounds: number;
  seconds: number;
  steps: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  costUsd: number;
  error?: string;
}

const { values } = parseArgs({
  options: {
    models: { type: "string", default: "anthropic:claude-sonnet-5,openai:gpt-5.5" },
    fixtures: { type: "string" },
  },
});
const log = createLogger("eval", { level: "warn" });
const base = readBaseSnapshot();
if (!base) throw new Error("No base snapshot. Run `pnpm sandbox:build-base` first.");

const all = JSON.parse(
  readFileSync(new URL("../../../../evals/fixtures.json", import.meta.url), "utf8"),
) as Fixture[];
const wanted = values.fixtures?.split(",");
const fixtures = wanted ? all.filter((f) => wanted.includes(f.id)) : all;
const models = values.models!.split(",").map((m) => m.trim());
const jobs = models.flatMap((model) => fixtures.map((fixture) => ({ model, fixture })));
const parallel = Math.max(1, Number(process.env.SANDBOX_CONCURRENCY_LIMIT ?? 1));
const evalId = new Date().toISOString().replace(/[:.]/g, "-");

async function runOne({ model, fixture }: { model: string; fixture: Fixture }): Promise<Result> {
  const t0 = performance.now();
  let sandbox: ProjectSandbox | undefined;
  try {
    sandbox = await ProjectSandbox.createFromSnapshot({
      snapshotId: base!.snapshotId,
      name: `lovable-diy-eval-${randomUUID().slice(0, 8)}`,
      log,
    });
    const r = await runAgentTurn({ sandbox, llm: createProvider(model), prompt: fixture.prompt, log });
    const c = r.lastCheck;
    return {
      fixture: fixture.id,
      model,
      status: r.status,
      built: !!c?.typecheck.ok && !!c?.build.ok,
      rendered: !!c?.render.ok,
      healRounds: r.healRounds,
      seconds: Math.round((performance.now() - t0) / 1000),
      steps: r.steps,
      inputTokens: r.usage.inputTokens,
      cachedTokens: r.usage.cacheReadTokens,
      outputTokens: r.usage.outputTokens,
      costUsd: r.costUsd,
      error: r.error?.split("\n")[0],
    };
  } catch (err) {
    return {
      fixture: fixture.id,
      model,
      status: "error",
      built: false,
      rendered: false,
      healRounds: 0,
      seconds: Math.round((performance.now() - t0) / 1000),
      steps: 0,
      inputTokens: 0,
      cachedTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await sandbox?.terminate().catch(() => {});
  }
}

// Simple worker pool bounded by the sandbox concurrency limit.
const results: Result[] = [];
const queue = [...jobs];
await Promise.all(
  Array.from({ length: Math.min(parallel, jobs.length) }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      console.log(`▶ ${job.model} · ${job.fixture.id}`);
      const r = await runOne(job);
      console.log(
        `${r.built && r.rendered ? "✓" : "✗"} ${job.model} · ${job.fixture.id} · ${r.seconds}s · heal ${r.healRounds} · $${r.costUsd.toFixed(3)}`,
      );
      results.push(r);
    }
  }),
);

const summary = models.map((model) => {
  const rs = results.filter((r) => r.model === model);
  const pass = rs.filter((r) => r.built && r.rendered).length;
  const avg = (f: (r: Result) => number) => (rs.length ? rs.reduce((s, r) => s + f(r), 0) / rs.length : 0);
  return {
    model,
    passRate: `${pass}/${rs.length}`,
    avgSeconds: Math.round(avg((r) => r.seconds)),
    avgHealRounds: Number(avg((r) => r.healRounds).toFixed(2)),
    totalCostUsd: Number(rs.reduce((s, r) => s + r.costUsd, 0).toFixed(4)),
    avgOutputTokens: Math.round(avg((r) => r.outputTokens)),
  };
});

console.log(
  "\n| Model | Pass | Avg time | Avg heal rounds | Avg output tokens | Cost |\n|---|---|---|---|---|---|",
);
for (const s of summary) {
  console.log(
    `| ${s.model} | ${s.passRate} | ${s.avgSeconds}s | ${s.avgHealRounds} | ${s.avgOutputTokens} | $${s.totalCostUsd} |`,
  );
}

const report = {
  id: evalId,
  at: new Date().toISOString(),
  models,
  fixtures: fixtures.map((f) => f.id),
  summary,
  results,
};
const dir = new URL(`../../../../.lovable-diy/evals/${evalId}/`, import.meta.url);
mkdirSync(dir, { recursive: true });
const json = JSON.stringify(report, null, 2);
const html = renderHtml(report);
writeFileSync(new URL("results.json", dir), json);
writeFileSync(new URL("report.html", dir), html);

try {
  const storage = new Storage();
  const prefix = storageKeys.evalPrefix(evalId);
  await storage.put(`${prefix}results.json`, json, "application/json");
  await storage.put(`${prefix}report.html`, html, "text/html; charset=utf-8");
  console.log(`\nReport: .lovable-diy/evals/${evalId}/report.html (uploaded to s3://${storage.bucket}/${prefix})`);
} catch (err) {
  console.log(`\nReport: .lovable-diy/evals/${evalId}/report.html (S3 upload failed: ${(err as Error).message})`);
}
process.exit(0);

function renderHtml(r: typeof report) {
  const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const rows = r.results
    .map(
      (
        x,
      ) => `<tr><td>${esc(x.fixture)}</td><td>${esc(x.model)}</td><td class="${x.built && x.rendered ? "ok" : "bad"}">${x.built && x.rendered ? "pass" : "fail"}</td>
<td>${x.healRounds}</td><td>${x.seconds}s</td><td>${x.steps}</td><td>${x.inputTokens + x.cachedTokens}</td><td>${x.outputTokens}</td><td>$${x.costUsd.toFixed(3)}</td><td>${esc(x.error ?? "")}</td></tr>`,
    )
    .join("\n");
  const sums = r.summary
    .map(
      (s) =>
        `<tr><td>${esc(s.model)}</td><td>${s.passRate}</td><td>${s.avgSeconds}s</td><td>${s.avgHealRounds}</td><td>$${s.totalCostUsd}</td></tr>`,
    )
    .join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Lovable DIY eval ${esc(r.id)}</title>
<style>body{font:14px/1.5 ui-sans-serif,system-ui,sans-serif;margin:32px;color:#171717}table{border-collapse:collapse;margin:12px 0 28px}
td,th{border:1px solid #e5e5e5;padding:6px 10px;text-align:left}th{background:#fafafa}.ok{color:#15803d}.bad{color:#b91c1c}h1{font-size:18px}</style></head>
<body><h1>Lovable DIY eval · ${esc(r.at)}</h1><h2>Summary</h2><table><tr><th>Model</th><th>Pass</th><th>Avg time</th><th>Avg heal rounds</th><th>Cost</th></tr>${sums}</table>
<h2>Runs</h2><table><tr><th>Fixture</th><th>Model</th><th>Result</th><th>Heal</th><th>Time</th><th>Steps</th><th>Input tokens</th><th>Output tokens</th><th>Cost</th><th>Error</th></tr>${rows}</table></body></html>`;
}
