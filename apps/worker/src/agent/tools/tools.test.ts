import { describe, expect, it } from "vitest";
import { elideOldToolResults } from "../context.js";
import { checkPackageSpec } from "./install-packages.js";
import { runCommand } from "./run-command.js";
import type { ToolContext } from "./types.js";

describe("checkPackageSpec", () => {
  it.each(["react-confetti", "@tanstack/react-query", "zod@4", "framer-motion@^12.0.0"])("allows %s", (s) =>
    expect(checkPackageSpec(s)).toBeNull(),
  );
  it.each([
    ["git+https://github.com/x/y", /not a plain npm/],
    ["https://evil.example/pkg.tgz", /not a plain npm/],
    ["../local", /not a plain npm/],
    ["puppeteer", /not allowed/],
    ["x; rm -rf /", /not a plain npm/],
  ])("rejects %s", (s, re) => expect(checkPackageSpec(s)).toMatch(re));
});

describe("run_command policy", () => {
  const ctx = { log: { info() {} } } as unknown as ToolContext;
  it.each(["npm install lodash", "pnpm add x", "npm run dev", "npx vite", "vite --port 3000"])(
    "blocks %j",
    async (command) => {
      const r = await runCommand.run({ command, timeout_seconds: 5 }, ctx);
      expect(r.isError).toBe(true);
    },
  );

  it("allows vite build and tsc", async () => {
    const exec = async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false });
    const c = { ...ctx, sandbox: { exec } } as unknown as ToolContext;
    for (const command of ["npx vite build", "npx tsc --noEmit"]) {
      expect((await runCommand.run({ command, timeout_seconds: 5 }, c)).isError).toBe(false);
    }
  });
});

describe("elideOldToolResults", () => {
  it("leaves small transcripts untouched and trims old results in big ones", () => {
    const big = "x".repeat(5000);
    const msgs = Array.from({ length: 20 }, (_, i) => ({
      role: "user" as const,
      content: [{ type: "tool_result" as const, toolCallId: `t${i}`, content: big }],
    }));
    expect(elideOldToolResults(msgs, 10_000_000)).toBe(msgs);
    const out = elideOldToolResults(msgs, 10_000, 3);
    const lens = out.map((m) => JSON.stringify(m).length);
    expect(lens.slice(-3).every((l) => l > 5000)).toBe(true);
    expect(lens.slice(0, 17).every((l) => l < 1000)).toBe(true);
  });
});
