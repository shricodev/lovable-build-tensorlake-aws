import { cn } from "@/lib/utils";

export function CreatorCredit({ className }: { className?: string }) {
  return (
    <p className={cn("text-xs text-muted-foreground", className)}>
      Built by{" "}
      <a
        href="https://github.com/shricodev"
        target="_blank"
        rel="noreferrer"
        className="font-medium text-foreground underline-offset-4 hover:underline"
      >
        @shricodev
      </a>
    </p>
  );
}
