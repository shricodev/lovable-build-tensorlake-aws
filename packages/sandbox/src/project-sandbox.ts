import { retry, withTimeout, type Logger } from "@kiln/shared";
import { Sandbox, type Pty, type PtyConnectionOptions, type SandboxInfo } from "tensorlake";
import {
  APP_DIR,
  DEV_PORT,
  DEV_PROCESS,
  MAX_OUTPUT_CHARS,
  MAX_WRITE_BYTES,
  NPM_ONLY_NETWORK,
  TIMEOUTS,
} from "./config.js";
import { SandboxError, SandboxPathError, toSandboxError } from "./errors.js";
import { truncateOutput } from "./output.js";
import { isInsideApp, isProtectedPath, resolveProjectPath, toRelative } from "./paths.js";

export type SandboxState = "running" | "suspended" | "starting" | "terminated" | "error";

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
}

export interface FileEntry {
  path: string;
  isDir: boolean;
  size?: number;
}

export interface PreviewEndpoint {
  url: string;
  /** Must be sent by the gateway; the sandbox URL is never public (ADR-004). */
  headers: Record<string, string>;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * One project's sandbox. This is the only type the rest of Kiln uses to talk
 * to Tensorlake. Every call has a timeout; only idempotent reads are retried.
 */
export class ProjectSandbox {
  private constructor(
    readonly sb: Sandbox,
    private readonly log: Logger,
  ) {}

  get id(): string {
    return this.sb.sandboxId;
  }

  /** Warm start from the base (or any) memory snapshot, then lock down network + expose the dev port. */
  static async createFromSnapshot(opts: {
    snapshotId: string;
    name: string;
    log: Logger;
    idleTimeoutSecs?: number;
  }): Promise<ProjectSandbox> {
    const sb = await call("createFromSnapshot", TIMEOUTS.lifecycle, () =>
      Sandbox.create({
        snapshotId: opts.snapshotId,
        name: opts.name,
        timeoutSecs: opts.idleTimeoutSecs ?? 600,
      }),
    );
    const ps = new ProjectSandbox(sb, opts.log.child({ sandboxId: sb.sandboxId }));
    await ps.configure();
    return ps;
  }

  /** Attach to an existing sandbox by id or name. Does not resume it. */
  static async connect(idOrName: string, log: Logger): Promise<ProjectSandbox> {
    const sb = await Sandbox.connect({ sandboxId: idOrName });
    return new ProjectSandbox(sb, log.child({ sandboxId: idOrName }));
  }

  static async list(): Promise<SandboxInfo[]> {
    return call("list", TIMEOUTS.lifecycle, () => Sandbox.list(), { retry: true });
  }

  static async deleteSnapshot(snapshotId: string): Promise<void> {
    await call("deleteSnapshot", TIMEOUTS.lifecycle, () => Sandbox.deleteSnapshot(snapshotId));
  }

  /** Egress = npm only; dev port routable through the authenticated proxy. */
  async configure(): Promise<void> {
    await call("configure", TIMEOUTS.lifecycle, () =>
      this.sb.update({
        exposedPorts: [DEV_PORT],
        allowUnauthenticatedAccess: false,
        network: NPM_ONLY_NETWORK,
      }),
    );
  }

  async state(): Promise<SandboxState> {
    const s = await call("status", TIMEOUTS.lifecycle, () => this.sb.status(), { retry: true });
    switch (s) {
      case "running":
        return "running";
      case "suspended":
      case "suspending":
        return "suspended";
      case "pending":
      case "snapshotting":
        return "starting";
      case "terminated":
      case "timeout":
        return "terminated";
      default:
        return "error";
    }
  }

  async suspend(): Promise<void> {
    await call("suspend", TIMEOUTS.lifecycle, () => this.sb.suspend());
    this.log.info("sandbox suspended");
  }

  async resume(): Promise<number> {
    const t0 = performance.now();
    await call("resume", TIMEOUTS.lifecycle, () => this.sb.resume());
    const ms = Math.round(performance.now() - t0);
    this.log.info({ ms }, "sandbox resumed");
    return ms;
  }

  async terminate(): Promise<void> {
    await call("terminate", TIMEOUTS.lifecycle, () => this.sb.terminate());
    this.log.info("sandbox terminated");
  }

  /** Memory checkpoint: files + RAM + running processes. */
  async checkpoint(): Promise<string> {
    const snap = await call("checkpoint", TIMEOUTS.lifecycle * 2, () =>
      this.sb.checkpoint({ checkpointType: "memory", waitUntil: "completed", timeout: 240 }),
    );
    if (!snap) throw new SandboxError("checkpoint_failed", "checkpoint returned no snapshot");
    return snap.snapshotId;
  }

  /** Live-copy this sandbox N times (memory + files + processes). Returns running copies. */
  async fork(times: number): Promise<ProjectSandbox[]> {
    const res = await call("fork", TIMEOUTS.lifecycle * 2, () => this.sb.copy({ times }));
    const failed = res.sandboxes.filter((c) => c.status === "failed");
    if (failed.length) this.log.warn({ failed }, "some forks failed");
    return Promise.all(
      res.sandboxes
        .filter((c) => c.status !== "failed")
        .map(
          async (c) =>
            new ProjectSandbox(
              await Sandbox.connect({ sandboxId: c.sandboxId }),
              this.log.child({ sandboxId: c.sandboxId }),
            ),
        ),
    );
  }

  /**
   * Run a shell command in the app dir. Non-zero exits are results, not
   * errors. Output is truncated head+tail so it fits in an LLM context.
   */
  async exec(
    command: string,
    opts: { timeoutSecs?: number; cwd?: string; env?: Record<string, string>; maxOutput?: number } = {},
  ): Promise<ExecResult> {
    const timeoutSecs = opts.timeoutSecs ?? 60;
    const t0 = performance.now();
    const r = await call("exec", timeoutSecs * 1000 + 15_000, () =>
      this.sb.run("bash", {
        args: ["-lc", command],
        workingDir: opts.cwd ?? APP_DIR,
        env: opts.env,
        timeout: timeoutSecs,
      }),
    );
    const max = opts.maxOutput ?? MAX_OUTPUT_CHARS;
    const out = truncateOutput(r.stdout, max);
    const err = truncateOutput(r.stderr, max);
    // The daemon SIGKILLs on timeout and reports exit code -9 (spike 02).
    const timedOut = r.exitCode === -9;
    return {
      exitCode: r.exitCode,
      stdout: out.text,
      stderr: err.text,
      timedOut,
      truncated: out.truncated || err.truncated,
      durationMs: Math.round(performance.now() - t0),
    };
  }

  /**
   * Step 2 of path safety: resolve symlinks inside the sandbox and require the
   * real path to stay in the project. `realpath -m` tolerates missing leaves.
   */
  async safePath(relPath: string, opts: { allowProtected?: boolean } = {}): Promise<string> {
    const abs = resolveProjectPath(relPath);
    const r = await this.sb.run("realpath", { args: ["-m", "--", abs], timeout: 10 });
    const real = r.stdout.trim();
    if (r.exitCode !== 0 || !isInsideApp(real))
      throw new SandboxPathError(relPath, "resolves outside the project");
    if (!opts.allowProtected && isProtectedPath(real)) throw new SandboxPathError(relPath, "protected path");
    return real;
  }

  async readFile(relPath: string): Promise<string> {
    const abs = await this.safePath(relPath, { allowProtected: true });
    const bytes = await call("readFile", TIMEOUTS.file, () => this.sb.readFile(abs), {
      retry: true,
      context: { path: relPath },
    });
    return dec.decode(bytes);
  }

  async writeFile(relPath: string, content: string): Promise<void> {
    const bytes = enc.encode(content);
    if (bytes.length > MAX_WRITE_BYTES) {
      throw new SandboxError("file_too_large", `write of ${bytes.length} bytes exceeds ${MAX_WRITE_BYTES}`, {
        userMessage: "That file is too large to write.",
        context: { path: relPath },
      });
    }
    const abs = await this.safePath(relPath);
    await call("writeFile", TIMEOUTS.file, () => this.sb.writeFile(abs, bytes), {
      context: { path: relPath },
    });
  }

  async deleteFile(relPath: string): Promise<void> {
    const abs = await this.safePath(relPath);
    await call("deleteFile", TIMEOUTS.file, () => this.sb.deleteFile(abs), { context: { path: relPath } });
  }

  /** Recursive file list (excluding node_modules, .git, dist) in one command. */
  async listFiles(relDir = ".", maxEntries = 2000): Promise<FileEntry[]> {
    const abs = await this.safePath(relDir, { allowProtected: false });
    const r = await this.exec(
      `find ${shellQuote(abs)} \\( -name node_modules -o -name .git -o -name dist \\) -prune -o -printf '%y %s %p\\n' | head -n ${maxEntries}`,
      { timeoutSecs: 20, maxOutput: 400_000 },
    );
    if (r.exitCode !== 0)
      throw new SandboxError("list_failed", r.stderr || "find failed", { context: { relDir } });
    return r.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [type, size, ...rest] = line.split(" ");
        return { path: toRelative(rest.join(" ")), isDir: type === "d", size: Number(size) };
      })
      .filter((e) => e.path !== ".");
  }

  async startDevServer(): Promise<void> {
    await call("startDevServer", TIMEOUTS.command, () =>
      this.sb.startProcess("npx", {
        args: ["vite"],
        workingDir: APP_DIR,
        name: DEV_PROCESS,
        restart: { policy: "always", initialBackoffMs: 500, maxBackoffMs: 5000 },
        healthCheck: { type: "http", port: DEV_PORT, path: "/", initialDelayMs: 1000 },
      }),
    );
  }

  /** Poll the dev server from inside the sandbox until it answers 200. Returns ms waited. */
  async waitForDevServer(timeoutMs = 60_000): Promise<number> {
    const t0 = performance.now();
    while (performance.now() - t0 < timeoutMs) {
      const r = await this.sb.run("curl", {
        args: [
          "-s",
          "-o",
          "/dev/null",
          "-w",
          "%{http_code}",
          "--max-time",
          "3",
          `http://127.0.0.1:${DEV_PORT}/`,
        ],
        timeout: 5,
      });
      if (r.stdout.trim() === "200") return Math.round(performance.now() - t0);
      await new Promise((res) => setTimeout(res, 500));
    }
    throw new SandboxError("dev_server_unhealthy", `dev server not ready after ${timeoutMs}ms`, {
      userMessage: "The app's dev server didn't start.",
      retryable: true,
    });
  }

  /** Last lines of the dev server's output (for the agent's get_dev_server_logs tool). */
  async devServerLogs(maxLines = 200): Promise<string> {
    const r = await call("devServerLogs", TIMEOUTS.file, () => this.sb.getOutput(DEV_PROCESS), {
      retry: true,
    });
    return r.lines.slice(-maxLines).join("\n");
  }

  async previewEndpoint(): Promise<PreviewEndpoint> {
    const info = await call("info", TIMEOUTS.lifecycle, () => this.sb.info(), { retry: true });
    if (!info.sandboxUrl)
      throw new SandboxError("no_sandbox_url", "sandbox has no URL yet", { retryable: true });
    const host = new URL(info.sandboxUrl).host;
    return {
      url: `https://${DEV_PORT}-${host}`,
      headers: { authorization: `Bearer ${process.env.TENSORLAKE_API_KEY ?? ""}` },
    };
  }

  openPty(opts: { cols: number; rows: number } & PtyConnectionOptions): Promise<Pty> {
    return call("openPty", TIMEOUTS.lifecycle, () =>
      this.sb.createPty({
        command: "/bin/bash",
        args: ["-l"],
        env: { TERM: "xterm-256color" },
        workingDir: APP_DIR,
        cols: opts.cols,
        rows: opts.rows,
        onData: opts.onData,
        onExit: opts.onExit,
      }),
    );
  }

  connectPty(sessionId: string, token: string, opts: PtyConnectionOptions = {}): Promise<Pty> {
    return call("connectPty", TIMEOUTS.lifecycle, () => this.sb.connectPty(sessionId, token, opts));
  }
}

async function call<T>(
  op: string,
  timeoutMs: number,
  fn: () => Promise<T>,
  opts: { retry?: boolean; context?: Record<string, unknown> } = {},
): Promise<T> {
  const once = async () => {
    try {
      return await withTimeout(`sandbox ${op}`, timeoutMs, () => fn());
    } catch (err) {
      throw toSandboxError(err, op, opts.context);
    }
  };
  return opts.retry ? retry(once, { attempts: 3, baseDelayMs: 300 }) : once();
}

export function shellQuote(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}
