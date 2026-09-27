"use client";

import { ArrowUp, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const EXAMPLES = [
  "A Pomodoro timer with session stats",
  "A habit tracker with streaks and a calendar heatmap",
  "A kanban board with drag and drop",
  "A recipe book with search and tags",
];

export function NewProject() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);

  async function create() {
    if (prompt.trim().length < 3 || pending) return;
    setPending(true);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!res.ok || !data.id) {
      toast.error(data.error ?? "Couldn't create the project");
      setPending(false);
      return;
    }
    router.push(`/projects/${data.id}`);
  }

  return (
    <section className="mx-auto max-w-2xl space-y-4 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">What do you want to build?</h1>
      <p className="text-muted-foreground">Describe an app. Kiln writes it in a sandbox and shows it live.</p>
      <div className="relative rounded-xl border bg-card text-left shadow-xs focus-within:ring-2 focus-within:ring-ring/40">
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void create();
          }}
          placeholder="A habit tracker with streaks, a calendar heatmap and dark mode…"
          className="min-h-28 resize-none border-0 bg-transparent p-4 pr-14 shadow-none focus-visible:ring-0"
          aria-label="Describe your app"
        />
        <Button
          size="icon"
          className="absolute right-3 bottom-3"
          onClick={() => void create()}
          disabled={pending || prompt.trim().length < 3}
          aria-label="Create project"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
        </Button>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {EXAMPLES.map((ex) => (
          <Button key={ex} variant="outline" size="sm" className="rounded-full" onClick={() => setPrompt(ex)}>
            {ex}
          </Button>
        ))}
      </div>
    </section>
  );
}
