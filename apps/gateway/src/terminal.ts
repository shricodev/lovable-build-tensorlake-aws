import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { eq, getDb, ptySessions, sandboxes, and } from "@kiln/db";
import { ProjectSandbox } from "@kiln/sandbox";
import { verifyTicket, type Logger } from "@kiln/shared";
import type { Pty } from "tensorlake";
import { WebSocketServer, type WebSocket } from "ws";
import { wake } from "./wake";

const wss = new WebSocketServer({ noServer: true });

/**
 * Browser terminal ⇄ Tensorlake PTY. The web app hands out a 60 s signed
 * ticket; the PTY session id + token are stored so a refresh reattaches to
 * the same shell (Tensorlake replays scrollback).
 * Client → server frames: {"t":"i","d":"ls\r"} input, {"t":"r","c":120,"r":30} resize.
 */
export function handleTerminalUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, log: Logger) {
  const url = new URL(req.url ?? "/", "http://x");
  const ticket = verifyTicket(url.searchParams.get("ticket") ?? "");
  if (!ticket) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    return socket.destroy();
  }
  const cols = clamp(Number(url.searchParams.get("cols")), 20, 400, 100);
  const rows = clamp(Number(url.searchParams.get("rows")), 5, 200, 30);
  wss.handleUpgrade(req, socket, head, (ws) => void session(ws, ticket.projectId, cols, rows, log));
}

async function session(ws: WebSocket, projectId: string, cols: number, rows: number, log: Logger) {
  const { db } = getDb();
  const say = (s: string) => ws.readyState === ws.OPEN && ws.send(s);
  // Listen right away: keystrokes typed while the sandbox wakes / the PTY opens are queued, not lost.
  const early: string[] = [];
  let handle: ((raw: string) => void) | null = null;
  let closed = false;
  let onClose = () => {};
  ws.on("message", (raw) => (handle ? handle(String(raw)) : early.push(String(raw))));
  ws.on("close", () => {
    closed = true;
    onClose();
  });
  try {
    const [row] = await db
      .select()
      .from(sandboxes)
      .where(and(eq(sandboxes.projectId, projectId), eq(sandboxes.role, "main")));
    if (!row || row.status === "terminated") {
      say("\r\n\x1b[2mThis project has no sandbox yet. Send a prompt first.\x1b[0m\r\n");
      return ws.close();
    }
    if (row.status !== "running") {
      say("\x1b[2mWaking up the sandbox…\x1b[0m\r\n");
      if ((await wake(projectId, row, log)) !== "running") {
        say("\r\nCouldn't wake the sandbox right now. Try again in a moment.\r\n");
        return ws.close();
      }
    }

    const ps = await ProjectSandbox.connect(row.tensorlakeId, log);
    const decoder = new TextDecoder();
    const onData = (d: Uint8Array) => say(decoder.decode(d, { stream: true }));
    const onExit = async () => {
      say("\r\n\x1b[2m[shell exited]\x1b[0m\r\n");
      await db.delete(ptySessions).where(eq(ptySessions.projectId, projectId));
      ws.close();
    };

    let pty: Pty | null = null;
    const [saved] = await db.select().from(ptySessions).where(eq(ptySessions.projectId, projectId));
    if (saved && saved.sandboxId === row.tensorlakeId) {
      pty = await ps.connectPty(saved.sessionId, saved.token, { onData, onExit }).catch(() => null);
    }
    if (!pty) {
      pty = await ps.openPty({ cols, rows, onData, onExit });
      await db
        .insert(ptySessions)
        .values({ projectId, sandboxId: row.tensorlakeId, sessionId: pty.sessionId, token: pty.token })
        .onConflictDoUpdate({
          target: ptySessions.projectId,
          set: {
            sandboxId: row.tensorlakeId,
            sessionId: pty.sessionId,
            token: pty.token,
            updatedAt: new Date(),
          },
        });
    } else {
      await pty.resize(cols, rows).catch(() => {});
    }

    // A connected terminal counts as activity, so the idle reaper leaves the sandbox alone.
    const keepAlive = setInterval(() => {
      void db.update(sandboxes).set({ lastActiveAt: new Date() }).where(eq(sandboxes.id, row.id));
    }, 30_000);

    const p = pty;
    handle = (raw) => {
      try {
        const m = JSON.parse(raw) as { t: string; d?: string; c?: number; r?: number };
        if (m.t === "i" && typeof m.d === "string") void p.sendInput(m.d);
        else if (m.t === "r") void p.resize(clamp(m.c!, 20, 400, cols), clamp(m.r!, 5, 200, rows));
      } catch {
        /* ignore malformed frames */
      }
    };
    early.splice(0).forEach(handle);
    onClose = () => {
      clearInterval(keepAlive);
      // Detach only: the shell keeps running for ~5 minutes so a refresh can reattach.
      p.disconnect();
    };
    if (closed) onClose();
  } catch (err) {
    log.warn({ err, projectId }, "terminal session failed");
    say("\r\nTerminal error. Try reconnecting.\r\n");
    ws.close();
  }
}

function clamp(n: number, min: number, max: number, fallback: number) {
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}
