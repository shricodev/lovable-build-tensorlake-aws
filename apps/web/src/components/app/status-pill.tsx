import { cn } from "@/lib/utils";

export type PillStatus = "running" | "sleeping" | "waking" | "building" | "error" | "none" | "queued";

const styles: Record<PillStatus, { label: string; dot: string }> = {
  running: { label: "Running", dot: "bg-emerald-500" },
  sleeping: { label: "Sleeping", dot: "bg-muted-foreground/50" },
  waking: { label: "Waking", dot: "bg-amber-500 animate-pulse" },
  building: { label: "Building", dot: "bg-sky-500 animate-pulse" },
  queued: { label: "Queued", dot: "bg-amber-500" },
  error: { label: "Error", dot: "bg-destructive" },
  none: { label: "No sandbox", dot: "bg-muted-foreground/30" },
};

export function StatusPill({ status, className }: { status: PillStatus; className?: string }) {
  const s = styles[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border bg-background px-2 py-0.5 text-xs text-muted-foreground",
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", s.dot)} aria-hidden />
      {s.label}
    </span>
  );
}

/** Combine sandbox status and run activity into what the user cares about. */
export function pillFor(sandboxStatus: string | null | undefined, runActive: boolean): PillStatus {
  if (runActive) return "building";
  switch (sandboxStatus) {
    case "running":
      return "running";
    case "suspended":
      return "sleeping";
    case "waking":
    case "creating":
      return "waking";
    case "error":
      return "error";
    default:
      return "none";
  }
}
