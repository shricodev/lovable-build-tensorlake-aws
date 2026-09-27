import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["{apps,packages,evals}/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/*.integration.test.ts"],
  },
});
