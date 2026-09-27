import type { NetworkConfig } from "tensorlake";

/** Where the generated app lives inside every project sandbox. */
export const APP_DIR = "/home/tl-user/app";

/** Vite dev server port; exposed through the Tensorlake port proxy. */
export const DEV_PORT = 5173;

/** Managed-process name of the dev server (stable across restarts, unlike its PID). */
export const DEV_PROCESS = "vite";

/**
 * Only the npm registry is reachable from project sandboxes.
 * Note: `allowInternetAccess: false` would block the allow-listed host too.
 */
export const NPM_ONLY_NETWORK: NetworkConfig = {
  allowInternetAccess: true,
  allowOut: ["registry.npmjs.org"],
  denyOut: [],
};

/** Default per-call timeouts (ms). */
export const TIMEOUTS = {
  lifecycle: 120_000,
  file: 30_000,
  command: 120_000,
} as const;

/** Largest file the agent may write in one call. */
export const MAX_WRITE_BYTES = 512 * 1024;

/** Cap on captured command output returned to callers (per stream). */
export const MAX_OUTPUT_CHARS = 16_000;

/**
 * Port URL for a sandbox without an API round trip:
 * `https://<port>-<id>.sandbox.tensorlake.ai` (host from TENSORLAKE_SANDBOX_PROXY_URL).
 */
export function previewUrlFor(sandboxId: string, port = DEV_PORT): string {
  const host = new URL(process.env.TENSORLAKE_SANDBOX_PROXY_URL ?? "https://sandbox.tensorlake.ai").host;
  return `https://${port}-${sandboxId}.${host}`;
}
