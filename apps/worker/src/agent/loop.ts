import { readFileSync } from "node:fs";
import {
  addUsage,
  costUsd,
  emptyUsage,
  type LlmMessage,
  type LlmProvider,
  type UserPart,
  type Usage,
} from "@lovable-diy/llm";
import type { ProjectSandbox } from "@lovable-diy/sandbox";
import { LovableDiyError, type Logger } from "@lovable-diy/shared";
import { describeFailures, renderCheck, runChecks, type CheckResult } from "./checks";
import { buildTurnMessage, elideOldToolResults, type PriorTurn } from "./context";
import type { AgentEvent } from "./events";
import { findTool, toolSpecs, type BrowserError, type ToolContext, type ToolOutput } from "./tools/index";

const SYSTEM_PROMPT = readFileSync(new URL("./prompts/system.md", import.meta.url), "utf8");

export interface AgentTurnInput {
  sandbox: ProjectSandbox;
  llm: LlmProvider;
  prompt: string;
  priorTurns?: PriorTurn[];
  images?: Extract<UserPart, { type: "image" }>[];
  log: Logger;
  signal?: AbortSignal;
  onEvent?: (e: AgentEvent) => void;
  maxHealRounds?: number;
  maxSteps?: number;
  /** Errors reported by the live preview (Phase 3); falls back to a fresh DOM check. */
  getPreviewErrors?: () => Promise<BrowserError[]>;
}

export interface AgentTurnResult {
  status: "succeeded" | "failed" | "cancelled";
  summary: string;
  suggestions: string[];
  changedFiles: string[];
  healRounds: number;
  steps: number;
  usage: Usage;
  costUsd: number;
  lastCheck?: CheckResult;
  error?: string;
}

/**
 * One agent turn: the LLM plans and edits via tools until it calls `finish`,
 * then Lovable DIY verifies (tsc, build, render). Failures go back to the model for
 * up to `maxHealRounds` more rounds; after that we report honestly.
 */
export async function runAgentTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
  const { sandbox, llm, log } = input;
  const emit = input.onEvent ?? (() => {});
  const signal = input.signal ?? new AbortController().signal;
  const maxHeal = input.maxHealRounds ?? 3;
  const maxSteps = input.maxSteps ?? 60;
  const firstTurn = (input.priorTurns ?? []).length === 0;

  const ctx: ToolContext = {
    sandbox,
    log,
    signal,
    getBrowserErrors: async () => {
      const live = (await input.getPreviewErrors?.()) ?? [];
      if (live.length) return live;
      return (await renderCheck(sandbox)).errors;
    },
  };
  const tools = toolSpecs();
  const changed = new Set<string>();
  let usage = emptyUsage();
  let healRounds = 0;
  let steps = 0;
  let planEmitted = !firstTurn;
  let lastCheck: CheckResult | undefined;
  let finishInfo: { summary: string; suggestions: string[] } | undefined;

  const result = (
    status: AgentTurnResult["status"],
    extra: Partial<AgentTurnResult> = {},
  ): AgentTurnResult => ({
    status,
    summary: finishInfo?.summary ?? "",
    suggestions: finishInfo?.suggestions ?? [],
    changedFiles: [...changed],
    healRounds,
    steps,
    usage,
    costUsd: costUsd(llm.ref, usage),
    lastCheck,
    ...extra,
  });

  emit({ type: "status", status: "thinking" });
  const messages: LlmMessage[] = [
    await buildTurnMessage({
      sandbox,
      prompt: input.prompt,
      priorTurns: input.priorTurns ?? [],
      images: input.images,
    }),
  ];

  try {
    while (true) {
      if (signal.aborted) return result("cancelled");
      if (++steps > maxSteps) {
        return result("failed", { error: `Stopped after ${maxSteps} steps without finishing.` });
      }

      const res = await llm.chat({
        system: SYSTEM_PROMPT,
        messages: elideOldToolResults(messages),
        tools,
        signal,
        onText: (d) => emit({ type: "message_delta", text: d }),
      });
      usage = addUsage(usage, res.usage);
      emit({ type: "usage", model: res.model, usage: res.usage, costUsd: costUsd(llm.ref, res.usage) });
      messages.push(res.message);

      if (res.message.text.trim()) {
        emit({ type: "message", text: res.message.text });
        if (!planEmitted && res.message.toolCalls.length) emit({ type: "plan", text: res.message.text });
      }
      planEmitted = true;

      if (res.stopReason === "refusal")
        return result("failed", { error: "The model declined this request." });

      // A tool input cut off by max_tokens may parse as a valid-looking partial object: don't run it.
      if (res.stopReason === "max_tokens" && res.message.toolCalls.length) {
        messages.push({
          role: "user",
          content: res.message.toolCalls.map((c) => ({
            type: "tool_result" as const,
            toolCallId: c.id,
            isError: true,
            content:
              "Your output was cut off (too long). Split large files into smaller components and write them one at a time.",
          })),
        });
        continue;
      }

      let finishCalled = false;
      const results: UserPart[] = [];
      if (res.message.toolCalls.length) emit({ type: "status", status: "working" });
      for (const call of res.message.toolCalls) {
        if (signal.aborted) return result("cancelled");
        emit({ type: "tool_call", id: call.id, name: call.name, input: call.input });
        const t0 = performance.now();
        const out = await executeTool(call.name, call.input, ctx);
        const ms = Math.round(performance.now() - t0);
        out.changedFiles?.forEach((f) => changed.add(f));
        if (out.finish) {
          finishCalled = true;
          finishInfo = out.finish;
        }
        emit({
          type: "tool_result",
          id: call.id,
          name: call.name,
          ok: !out.isError,
          output: out.content,
          changedFiles: out.changedFiles,
          ms,
        });
        results.push({
          type: "tool_result",
          toolCallId: call.id,
          content: out.content,
          isError: out.isError,
        });
      }

      // A model that stops without calling `finish` is treated as finished.
      if (!res.message.toolCalls.length) {
        finishCalled = true;
        finishInfo ??= { summary: res.message.text.trim() || "Done.", suggestions: [] };
      }

      if (!finishCalled) {
        messages.push({ role: "user", content: results });
        continue;
      }

      emit({ type: "status", status: "verifying" });
      lastCheck = await runChecks(sandbox);
      emit({
        type: "check",
        ok: lastCheck.ok,
        round: healRounds,
        durationMs: lastCheck.durationMs,
        summary: lastCheck.ok
          ? "Typecheck, build and render passed"
          : describeFailures(lastCheck).slice(0, 2000),
      });
      if (lastCheck.ok) return result("succeeded");
      if (healRounds >= maxHeal) {
        return result("failed", {
          error: `The app still has problems after ${healRounds} fix attempts.\n${describeFailures(lastCheck).slice(0, 1500)}`,
        });
      }

      healRounds++;
      emit({ type: "status", status: "healing", round: healRounds });
      results.push({
        type: "text",
        text: `Lovable DIY verification failed (fix round ${healRounds} of ${maxHeal}). Fix these problems, re-check with \`npx tsc --noEmit\`, then call finish again.\n\n${describeFailures(lastCheck)}`,
      });
      messages.push({ role: "user", content: results });
    }
  } catch (err) {
    if (signal.aborted) return result("cancelled");
    const message = err instanceof LovableDiyError ? err.userMessage : "The agent hit an unexpected error.";
    log.error({ err }, "agent turn failed");
    emit({ type: "error", message });
    return result("failed", { error: err instanceof Error ? err.message : String(err) });
  }
}

/** Validate input against the tool's Zod schema, run it, and turn failures into error results for the model. */
async function executeTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolOutput> {
  const tool = findTool(name);
  if (!tool) return { isError: true, content: `Unknown tool "${name}".` };
  const parsed = tool.schema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return {
      isError: true,
      content: `Invalid input for ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`,
    };
  }
  try {
    return await tool.run(parsed.data, ctx);
  } catch (err) {
    const msg =
      err instanceof LovableDiyError ? `${err.message}` : err instanceof Error ? err.message : String(err);
    ctx.log.warn({ tool: name, err: msg }, "tool failed");
    return { isError: true, content: `${name} failed: ${msg}` };
  }
}
