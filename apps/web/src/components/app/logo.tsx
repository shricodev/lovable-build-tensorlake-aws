import { Hammer } from "lucide-react";
import Link from "next/link";

export function Logo() {
  return (
    <Link href="/projects" className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="grid size-7 place-items-center rounded-md bg-foreground text-background">
        <Hammer className="size-4" />
      </span>
      Lovable DIY
    </Link>
  );
}
