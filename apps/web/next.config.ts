import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// One .env at the repo root is shared by web, worker and gateway. (@next/env's
// loadEnvConfig caches the first directory it saw, so use Node's loader.)
const rootEnv = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const nextConfig: NextConfig = {
  transpilePackages: ["@lovable-diy/db", "@lovable-diy/shared", "@lovable-diy/sandbox"],
  // Native bindings / worker threads: load from node_modules at runtime instead of bundling.
  // (Production builds use webpack: Turbopack's build tracer chokes on tensorlake's .d.cts files.)
  serverExternalPackages: ["tensorlake", "pino", "pino-pretty", "pg-boss", "postgres"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
