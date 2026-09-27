import { describe, expect, it } from "vitest";
import { authEnv, coreEnv, llmEnv, loadEnv } from "./env";

describe("loadEnv", () => {
  it("applies defaults", () => {
    const env = loadEnv(coreEnv, { DATABASE_URL: "postgres://u:p@localhost:5432/kiln" });
    expect(env.NODE_ENV).toBe("development");
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("lists every problem in one error", () => {
    expect(() => loadEnv(coreEnv.extend(authEnv.shape), { AUTH_SECRET: "short" })).toThrow(
      /DATABASE_URL[\s\S]*AUTH_SECRET/,
    );
  });

  it("validates provider:model refs", () => {
    expect(() => loadEnv(llmEnv, { LLM_CODER: "claude-sonnet-5" })).toThrow(/provider:model/);
    expect(loadEnv(llmEnv, { LLM_CODER: "openai:gpt-5" }).LLM_CODER).toBe("openai:gpt-5");
  });

  it("parses admin usernames", () => {
    const env = loadEnv(authEnv, { AUTH_SECRET: "x".repeat(32), ADMIN_GITHUB_USERNAMES: "alice, bob,," });
    expect(env.ADMIN_GITHUB_USERNAMES).toEqual(["alice", "bob"]);
    expect(env.DEV_LOGIN).toBe(false);
  });
});
