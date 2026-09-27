import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Integration tests hit real Tensorlake sandboxes and the local Postgres.
// Run with `pnpm test:integration` (needs .env credentials and `pnpm infra:up`).
if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  test: {
    include: ["{apps,packages}/**/*.integration.test.ts"],
    testTimeout: 240_000,
    hookTimeout: 240_000,
    fileParallelism: false,
  },
});
