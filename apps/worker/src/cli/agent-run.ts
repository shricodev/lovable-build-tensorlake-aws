/**
 * `pnpm agent:run "<prompt>"` runs one full agent turn against a real sandbox
 * (restored from the warm base snapshot) and prints the timeline.
 *
 *   --fixture <id>     use a prompt from evals/fixtures.json
 *   --model <ref>      override LLM_CODER, e.g. openai:gpt-5.5
 *   --keep             leave the sandbox running and print its preview URL
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createProvider } from "@lovable-diy/llm";
import { ProjectSandbox } from "@lovable-diy/sandbox";
import { readBaseSnapshot } from "@lovable-diy/sandbox/base";
import { createLogger, llmEnv, loadEnv } from "@lovable-diy/shared";
import { runAgentTurn } from "../agent/loop";
import type { AgentEvent } from "../agent/events";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    fixture: { type: "string" },
    model: { type: "string" },
    keep: { type: "boolean", default: false },
  },
});

const env = loadEnv(llmEnv);
const log = createLogger("agent-run", { level: process.env.LOG_LEVEL ?? "warn" });
const fixtures = JSON.parse(
  readFileSync(new URL("../../../../evals/fixtures.json", import.meta.url), "utf8"),
) as {
  id: string;
  prompt: string;
}[];
const prompt = values.fixture ? fixtures.find((f) => f.id === values.fixture)?.prompt : positionals.join(" ");
if (!prompt) {
  console.error(`Usage: pnpm agent:run "<prompt>" | --fixture <${fixtures.map((f) => f.id).join("|")}>`);
  process.exit(1);
}
const base = readBaseSnapshot();
if (!base) throw new Error("No base snapshot. Run `pnpm sandbox:build-base` first.");

const llm = createProvider(values.model ?? env.LLM_CODER);
const c = {
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  reset: "\x1b[0m",
};
const t0 = performance.now();
const at = () => `${c.dim}${((performance.now() - t0) / 1000).toFixed(1).padStart(6)}s${c.reset}`;

console.log(`${c.cyan}▶ ${llm.ref}${c.reset}  ${prompt}\n`);
const sandbox = await ProjectSandbox.createFromSnapshot({
  snapshotId: base.snapshotId,
  name: `lovable-diy-cli-${Date.now().toString(36)}`,
  log,
});
console.log(`${at()} sandbox ${sandbox.id} ready`);

const ac = new AbortController();
process.once("SIGINT", () => {
  console.log("\n(cancelling…)");
  ac.abort();
});

let streaming = false;
const onEvent = (e: AgentEvent) => {
  if (e.type === "message_delta") {
    if (!streaming) process.stdout.write(`${at()} ${c.dim}`);
    streaming = true;
    process.stdout.write(e.text);
    return;
  }
  if (streaming) process.stdout.write(`${c.reset}\n`);
  streaming = false;
  switch (e.type) {
    case "status":
      if (e.status === "verifying" || e.status === "healing")
        console.log(`${at()} ${c.yellow}${e.status}${e.round ? ` (round ${e.round})` : ""}${c.reset}`);
      break;
    case "tool_call": {
      const i = e.input as Record<string, unknown>;
      const arg = (i.path ??
        i.command ??
        (Array.isArray(i.packages) ? i.packages.join(" ") : "") ??
        "") as string;
      console.log(`${at()} → ${e.name} ${c.dim}${String(arg).slice(0, 90)}${c.reset}`);
      break;
    }
    case "tool_result":
      if (!e.ok)
        console.log(
          `${at()}   ${c.red}✗ ${e.output.split("\n").slice(0, 3).join(" | ").slice(0, 200)}${c.reset}`,
        );
      break;
    case "check":
      console.log(
        `${at()} ${e.ok ? c.green + "✓" : c.red + "✗"} checks (${e.durationMs} ms)${c.reset} ${e.ok ? "" : "\n" + e.summary.split("\n").slice(0, 8).join("\n")}`,
      );
      break;
    case "error":
      console.log(`${at()} ${c.red}error: ${e.message}${c.reset}`);
      break;
  }
};

let exitCode: number;
try {
  const r = await runAgentTurn({
    sandbox,
    llm,
    prompt,
    log,
    signal: ac.signal,
    onEvent,
    maxHealRounds: env.MAX_HEAL_ROUNDS,
  });
  exitCode = r.status === "succeeded" ? 0 : 1;
  const u = r.usage;
  console.log(
    `\n${r.status === "succeeded" ? c.green : c.red}■ ${r.status}${c.reset} in ${((performance.now() - t0) / 1000).toFixed(1)}s`,
  );
  if (r.summary) console.log(`  ${r.summary}`);
  if (r.suggestions.length) console.log(`  next: ${r.suggestions.join(" · ")}`);
  if (r.error) console.log(`  ${c.red}${r.error.split("\n")[0]}${c.reset}`);
  console.log(
    `  steps ${r.steps} · heal rounds ${r.healRounds} · files ${r.changedFiles.length} · tokens in ${u.inputTokens} (+${u.cacheReadTokens} cached, ${u.cacheWriteTokens} cache-write) out ${u.outputTokens} · $${r.costUsd.toFixed(4)}`,
  );
  console.log(
    `RESULT ${JSON.stringify({ status: r.status, seconds: Math.round((performance.now() - t0) / 1000), steps: r.steps, healRounds: r.healRounds, files: r.changedFiles.length, usage: u, costUsd: r.costUsd, checksOk: r.lastCheck?.ok ?? false })}`,
  );
} finally {
  if (values.keep) {
    const ep = await sandbox.previewEndpoint();
    console.log(`\nSandbox kept: ${sandbox.id}\nPreview (Bearer auth): ${ep.url}`);
  } else {
    await sandbox.terminate().catch(() => {});
  }
}
process.exit(exitCode);
