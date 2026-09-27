import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Props = HTMLAttributes<HTMLDivElement>;

export const Card = ({ className, ...p }: Props) => (
  <div className={cn("rounded-lg border border-border bg-card shadow-sm", className)} {...p} />
);
export const CardHeader = ({ className, ...p }: Props) => (
  <div className={cn("space-y-1.5 p-6", className)} {...p} />
);
export const CardTitle = ({ className, ...p }: Props) => (
  <h3 className={cn("text-lg font-semibold leading-none tracking-tight", className)} {...p} />
);
export const CardContent = ({ className, ...p }: Props) => (
  <div className={cn("p-6 pt-0", className)} {...p} />
);
