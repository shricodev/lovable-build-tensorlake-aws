import { posix } from "node:path";
import { APP_DIR } from "./config";
import { SandboxPathError } from "./errors";

/**
 * Step 1 of path safety (ADR-010): purely lexical checks in the worker.
 * Accepts project-relative paths like "src/App.tsx" or "./src" and returns the
 * absolute sandbox path. Step 2 (`realpath` inside the sandbox) catches
 * symlink escapes, which the Tensorlake file API would otherwise follow.
 */
export function resolveProjectPath(input: string): string {
  if (typeof input !== "string" || input.length === 0)
    throw new SandboxPathError(String(input), "empty path");
  if (input.length > 1024) throw new SandboxPathError(input.slice(0, 40) + "…", "path too long");
  if (input.includes("\0")) throw new SandboxPathError(input, "NUL byte");
  if (input.startsWith("/") || input.startsWith("~") || /^[a-zA-Z]:[\\/]/.test(input)) {
    throw new SandboxPathError(
      input,
      "absolute paths are not allowed; use a path relative to the project root",
    );
  }
  const parts = input.replaceAll("\\", "/").split("/");
  if (parts.includes("..")) throw new SandboxPathError(input, "'..' is not allowed");
  const abs = posix.normalize(posix.join(APP_DIR, input));
  if (!isInsideApp(abs)) throw new SandboxPathError(input, "outside the project");
  return abs;
}

export function isInsideApp(abs: string): boolean {
  return abs === APP_DIR || abs.startsWith(APP_DIR + "/");
}

/** Paths the agent must never touch, even inside the project. */
export function isProtectedPath(abs: string): boolean {
  const rel = posix.relative(APP_DIR, abs);
  return (
    rel === ".git" || rel.startsWith(".git/") || rel === "node_modules" || rel.startsWith("node_modules/")
  );
}

export function toRelative(abs: string): string {
  return posix.relative(APP_DIR, abs) || ".";
}
