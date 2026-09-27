"use client";

import "@xterm/xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { RotateCw } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

const THEMES = {
  dark: { background: "#0a0a0a", foreground: "#e5e5e5", cursor: "#e5e5e5", selectionBackground: "#404040" },
  light: { background: "#ffffff", foreground: "#171717", cursor: "#171717", selectionBackground: "#d4d4d4" },
};

/**
 * xterm.js ⇄ gateway WebSocket ⇄ Tensorlake PTY. Closing the tab only
 * detaches; reconnecting reattaches to the same shell with its scrollback.
 */
export function TerminalPanel({ projectId }: { projectId: string }) {
  const host = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const [state, setState] = useState<"connecting" | "open" | "closed">("connecting");
  const [attempt, setAttempt] = useState(0);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = THEMES[resolvedTheme === "dark" ? "dark" : "light"];
  }, [resolvedTheme]);

  useEffect(() => {
    if (!host.current) return;
    const term = new Terminal({
      fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
      fontSize: 13,
      cursorBlink: true,
      theme: THEMES[document.documentElement.classList.contains("dark") ? "dark" : "light"],
    });
    termRef.current = term;
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    fit.fit();

    let ws: WebSocket | null = null;
    let disposed = false;
    setState("connecting");
    void (async () => {
      const res = await fetch(`/api/projects/${projectId}/terminal-ticket`);
      if (!res.ok || disposed) return setState("closed");
      const { url } = (await res.json()) as { url: string };
      ws = new WebSocket(`${url}&cols=${term.cols}&rows=${term.rows}`);
      ws.onopen = () => setState("open");
      ws.onmessage = (m) => term.write(typeof m.data === "string" ? m.data : "");
      ws.onclose = () => !disposed && setState("closed");
    })();

    const input = term.onData(
      (d) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ t: "i", d })),
    );
    const ro = new ResizeObserver(() => {
      fit.fit();
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "r", c: term.cols, r: term.rows }));
    });
    ro.observe(host.current);
    term.focus();

    return () => {
      disposed = true;
      ro.disconnect();
      input.dispose();
      ws?.close();
      term.dispose();
      termRef.current = null;
    };
  }, [projectId, attempt]);

  return (
    <div className="relative flex h-full flex-col bg-background">
      {state === "closed" && (
        <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs text-muted-foreground">
          Disconnected from the sandbox shell.
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-xs"
            onClick={() => setAttempt((a) => a + 1)}
          >
            <RotateCw className="size-3" /> Reconnect
          </Button>
        </div>
      )}
      <div ref={host} className="min-h-0 flex-1 p-2" />
    </div>
  );
}
