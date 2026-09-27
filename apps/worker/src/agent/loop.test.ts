import type { ChatRequest, ChatResult, LlmProvider } from "@kiln/llm";
import type { ProjectSandbox } from "@kiln/sandbox";
import { createLogger } from "@kiln/shared";
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "./events.js";
import { runAgentTurn } from "./loop.js";

const log = createLogger("test", { level: "silent" });

/** In-memory stand-in for ProjectSandbox; `tscFailures` makes the first N typechecks fail. */
function fakeSandbox(tscFailures: number) {
  const files = new Map<string, string>([
    ["src/App.tsx", "export default function App() { return null }"],
    ["package.json", "{}"],
  ]);
  let tscRuns = 0;
  const ok = (stdout = "") => ({
    exitCode: 0,
    stdout,
    stderr: "",
    timedOut: false,
    truncated: false,
    durationMs: 1,
  });
  const sb = {
    listFiles: async () => [...files.keys()].map((path) => ({ path, isDir: false, size: 1 })),
    readFile: async (p: string) => files.get(p) ?? "",
    writeFile: async (p: string, c: string) => void files.set(p, c),
    exec: async (cmd: string) => {
      if (cmd.startsWith("npx tsc")) {
        return ++tscRuns <= tscFailures
          ? { ...ok("src/App.tsx(1,1): error TS2304: Cannot find name 'x'."), exitCode: 2 }
          : ok();
      }
      if (cmd.startsWith("node kiln/check.mjs")) return ok('{"ok":true,"rendered":true,"errors":[]}');
      return ok();
    },
  };
  return { sb: sb as unknown as ProjectSandbox, files, tscRuns: () => tscRuns };
}

/** Scripted LLM: each call returns the next canned tool call. */
function fakeLlm(script: Array<{ name: string; input: unknown }>): LlmProvider & { calls: ChatRequest[] } {
  const calls: ChatRequest[] = [];
  return {
    ref: "anthropic:claude-sonnet-5",
    provider: "anthropic",
    model: "claude-sonnet-5",
    supportsVision: true,
    calls,
    async chat(req): Promise<ChatResult> {
      calls.push(structuredClone({ ...req, signal: undefined, onText: undefined }));
      const step = script.shift() ?? { name: "finish", input: { summary: "done" } };
      return {
        model: "claude-sonnet-5",
        stopReason: "tool_use",
        message: { role: "assistant", text: "", toolCalls: [{ id: `t${calls.length}`, ...step }] },
        usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
      };
    },
  };
}

describe("runAgentTurn", () => {
  it("succeeds without healing when checks pass", async () => {
    const { sb, files } = fakeSandbox(0);
    const llm = fakeLlm([
      { name: "write_file", input: { path: "src/Hello.tsx", content: "export const Hello = 1;" } },
      { name: "finish", input: { summary: "Added Hello", suggestions: ["Add dark mode"] } },
    ]);
    const r = await runAgentTurn({ sandbox: sb, llm, prompt: "hi", log });
    expect(r.status).toBe("succeeded");
    expect(r.healRounds).toBe(0);
    expect(r.summary).toBe("Added Hello");
    expect(r.changedFiles).toEqual(["src/Hello.tsx"]);
    expect(files.get("src/Hello.tsx")).toBe("export const Hello = 1;");
  });

  it("feeds check failures back and heals", async () => {
    const { sb } = fakeSandbox(1);
    const events: AgentEvent[] = [];
    const llm = fakeLlm([
      { name: "finish", input: { summary: "v1" } },
      { name: "finish", input: { summary: "v2" } },
    ]);
    const r = await runAgentTurn({ sandbox: sb, llm, prompt: "hi", log, onEvent: (e) => events.push(e) });
    expect(r.status).toBe("succeeded");
    expect(r.healRounds).toBe(1);
    // The second LLM call must contain the TypeScript error in a text part.
    const last = llm.calls[1]!.messages.at(-1)!;
    expect(JSON.stringify(last)).toContain("TS2304");
    expect(events.filter((e) => e.type === "check").map((e) => (e as { ok: boolean }).ok)).toEqual([
      false,
      true,
    ]);
  });

  it("stops and reports honestly after max heal rounds", async () => {
    const { sb } = fakeSandbox(99);
    const r = await runAgentTurn({ sandbox: sb, llm: fakeLlm([]), prompt: "hi", log, maxHealRounds: 2 });
    expect(r.status).toBe("failed");
    expect(r.healRounds).toBe(2);
    expect(r.error).toMatch(/still has problems after 2 fix attempts/);
  });

  it("returns schema errors to the model instead of running the tool", async () => {
    const { sb, files } = fakeSandbox(0);
    const llm = fakeLlm([
      { name: "write_file", input: { path: "a.ts" } },
      { name: "finish", input: { summary: "ok" } },
    ]);
    const r = await runAgentTurn({ sandbox: sb, llm, prompt: "hi", log });
    expect(r.status).toBe("succeeded");
    expect(files.has("a.ts")).toBe(false);
    expect(JSON.stringify(llm.calls[1]!.messages.at(-1))).toContain("Invalid input for write_file");
  });

  it("cancels promptly", async () => {
    const { sb } = fakeSandbox(0);
    const ac = new AbortController();
    ac.abort();
    const r = await runAgentTurn({ sandbox: sb, llm: fakeLlm([]), prompt: "hi", log, signal: ac.signal });
    expect(r.status).toBe("cancelled");
  });
});
