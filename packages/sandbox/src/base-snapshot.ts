import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Logger } from "@kiln/shared";
import { Sandbox } from "tensorlake";
import { APP_DIR } from "./config.js";
import { SandboxError } from "./errors.js";
import { ProjectSandbox } from "./project-sandbox.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const TEMPLATE_DIR = `${REPO_ROOT}infra/sandbox-image/template`;
const BASE_FILE = `${REPO_ROOT}.kiln/base-snapshot.json`;

export interface BaseSnapshotRecord {
  snapshotId: string;
  templateHash: string;
  createdAt: string;
  timingsMs: Record<string, number>;
}

/** The template as one gzipped tarball (the file API is slow for many/large files; ADR-011). */
export function templateTarball(): { bytes: Uint8Array; hash: string } {
  const bytes = execFileSync("tar", [
    "czf",
    "-",
    "--exclude=node_modules",
    "--exclude=dist",
    "-C",
    TEMPLATE_DIR,
    ".",
  ]);
  // Hash the file contents, not the tarball (tar embeds mtimes).
  const listing = execFileSync("bash", [
    "-c",
    `cd "${TEMPLATE_DIR}" && find . -type f -not -path './node_modules/*' -not -path './dist/*' | sort | xargs sha256sum`,
  ]);
  return {
    bytes: new Uint8Array(bytes),
    hash: createHash("sha256").update(listing).digest("hex").slice(0, 16),
  };
}

export function readBaseSnapshot(): BaseSnapshotRecord | null {
  if (process.env.KILN_BASE_SNAPSHOT_ID) {
    return {
      snapshotId: process.env.KILN_BASE_SNAPSHOT_ID,
      templateHash: "env",
      createdAt: "",
      timingsMs: {},
    };
  }
  return existsSync(BASE_FILE) ? (JSON.parse(readFileSync(BASE_FILE, "utf8")) as BaseSnapshotRecord) : null;
}

function writeBaseSnapshot(rec: BaseSnapshotRecord) {
  mkdirSync(`${REPO_ROOT}.kiln`, { recursive: true });
  writeFileSync(BASE_FILE, JSON.stringify(rec, null, 2) + "\n");
}

/**
 * Cold path: default image → upload template → npm install → git init →
 * start the dev server. Used to build the base snapshot, and by the
 * benchmark as the "no snapshot" baseline.
 */
export async function coldCreateFromTemplate(opts: { name: string; log: Logger; verify?: boolean }) {
  const t: Record<string, number> = {};
  const lap = async <T>(k: string, fn: () => Promise<T>) => {
    const t0 = performance.now();
    const r = await fn();
    t[k] = Math.round(performance.now() - t0);
    opts.log.info({ step: k, ms: t[k] }, "cold create step");
    return r;
  };

  // Full internet while building: npm needs its registry and nothing else is
  // installed from elsewhere, but the policy is tightened per project anyway.
  const sb = await lap("create", () => Sandbox.create({ name: opts.name, timeoutSecs: 1800 }));
  const ps = await ProjectSandbox.connect(sb.sandboxId, opts.log);
  const must = async (label: string, cmd: string, timeoutSecs: number) => {
    const r = await ps.exec(cmd, { timeoutSecs, cwd: "/home/tl-user" });
    if (r.exitCode !== 0) {
      throw new SandboxError(
        "base_build_failed",
        `${label} failed (exit ${r.exitCode}): ${r.stderr || r.stdout}`,
      );
    }
    return r;
  };

  const { bytes, hash } = templateTarball();
  await lap("upload", async () => {
    await sb.writeFile("/tmp/template.tgz", bytes);
    await must(
      "extract",
      `mkdir -p ${APP_DIR} && tar xzf /tmp/template.tgz -C ${APP_DIR} && rm /tmp/template.tgz`,
      30,
    );
  });
  await lap("install", () =>
    must("npm install", `cd ${APP_DIR} && npm install --no-audit --no-fund --loglevel=error`, 600),
  );
  await lap("git", () =>
    must(
      "git init",
      `cd ${APP_DIR} && git init -q -b main && git config user.name Kiln && git config user.email kiln@local && git add -A && git commit -qm "Start from Kiln template"`,
      30,
    ),
  );

  if (opts.verify) {
    await lap("verify", async () => {
      await must("typecheck", `cd ${APP_DIR} && npx tsc --noEmit`, 120);
      await must("build", `cd ${APP_DIR} && npx vite build && rm -rf dist`, 120);
      const check = await must("dom check", `cd ${APP_DIR} && node kiln/check.mjs`, 60);
      const res = JSON.parse(check.stdout.trim().split("\n").pop() ?? "{}") as {
        ok?: boolean;
        errors?: string[];
      };
      if (!res.ok) throw new SandboxError("base_build_failed", `DOM check failed: ${JSON.stringify(res)}`);
    });
  }

  await lap("devServer", async () => {
    await ps.startDevServer();
    await ps.waitForDevServer(90_000);
    // Warm Vite's transform cache so the first preview load after restore is fast.
    await ps.exec(
      `for p in / /src/main.tsx /src/App.tsx /src/index.css; do curl -s -o /dev/null http://127.0.0.1:5173$p; done`,
      {
        timeoutSecs: 60,
      },
    );
  });

  return { ps, timings: t, templateHash: hash };
}

/** Build the warm base snapshot every new project starts from (ADR-007). */
export async function buildBaseSnapshot(log: Logger): Promise<BaseSnapshotRecord> {
  const { ps, timings, templateHash } = await coldCreateFromTemplate({
    name: `kiln-base-${Date.now().toString(36)}`,
    log,
    verify: true,
  });
  try {
    const t0 = performance.now();
    const snapshotId = await ps.checkpoint();
    timings.checkpoint = Math.round(performance.now() - t0);
    const rec = { snapshotId, templateHash, createdAt: new Date().toISOString(), timingsMs: timings };
    const previous = readBaseSnapshot();
    writeBaseSnapshot(rec);
    // Snapshot storage is billed; drop the one this replaces.
    if (previous && previous.templateHash !== "env" && previous.snapshotId !== snapshotId) {
      await ProjectSandbox.deleteSnapshot(previous.snapshotId).catch((e) =>
        log.warn({ err: e, snapshotId: previous.snapshotId }, "could not delete previous base snapshot"),
      );
    }
    return rec;
  } finally {
    await ps.terminate().catch((e) => log.warn({ err: e }, "failed to terminate base builder"));
  }
}
