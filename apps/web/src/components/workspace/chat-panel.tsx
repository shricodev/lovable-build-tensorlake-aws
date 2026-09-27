"use client";

import { ArrowUp, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Timeline } from "./timeline";
import type { StreamState } from "./use-project-stream";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  runId: string | null;
}

export function ChatPanel(props: {
  messages: ChatMessage[];
  stream: StreamState;
  suggestions: string[];
  onSend: (prompt: string) => Promise<boolean>;
  onStop: () => void;
}) {
  const { messages, stream } = props;
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const busy = stream.running || sending;

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length, stream.steps.length, stream.liveText.length]);

  async function send(text = draft) {
    const prompt = text.trim();
    if (!prompt || busy) return;
    setSending(true);
    const ok = await props.onSend(prompt);
    setSending(false);
    if (ok) setDraft("");
  }

  // The timeline belongs right above the assistant reply of the run it describes,
  // or at the end while that reply doesn't exist yet.
  const timelineRun = stream.runId;
  const replyIndex = messages.findIndex((m) => m.role === "assistant" && m.runId === timelineRun);
  const timeline = timelineRun && (stream.steps.length > 0 || stream.running) && (
    <div className="border-l-2 pl-3">
      <Timeline steps={stream.steps} liveText={stream.liveText} running={stream.running} />
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-4">
          {messages.map((m, i) => (
            <div key={m.id} className="space-y-3">
              {i === replyIndex && timeline}
              <div
                className={cn(
                  "text-sm whitespace-pre-wrap",
                  m.role === "user" ? "ml-8 rounded-lg bg-muted px-3 py-2" : "text-foreground",
                )}
              >
                {m.content}
              </div>
            </div>
          ))}
          {replyIndex === -1 && timeline}
          <div ref={bottom} />
        </div>
      </ScrollArea>

      <div className="space-y-2 border-t p-3">
        {!busy && props.suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {props.suggestions.map((s) => (
              <Button
                key={s}
                variant="outline"
                size="sm"
                className="h-7 rounded-full text-xs"
                onClick={() => void send(s)}
              >
                {s}
              </Button>
            ))}
          </div>
        )}
        <div className="relative rounded-lg border bg-background focus-within:ring-2 focus-within:ring-ring/40">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={busy ? "Kiln is working…" : "Ask for a change…  (⌘/Ctrl + Enter)"}
            className="max-h-48 min-h-20 resize-none border-0 bg-transparent pr-12 shadow-none focus-visible:ring-0"
            aria-label="Message"
          />
          {stream.running ? (
            <Button
              size="icon"
              variant="secondary"
              className="absolute right-2 bottom-2 size-8"
              onClick={props.onStop}
              aria-label="Stop (Esc)"
            >
              <Square className="size-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              size="icon"
              className="absolute right-2 bottom-2 size-8"
              onClick={() => void send()}
              disabled={busy || !draft.trim()}
              aria-label="Send"
            >
              <ArrowUp className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
