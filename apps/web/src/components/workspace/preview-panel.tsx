"use client";

import { ExternalLink, Monitor, RotateCw, Smartphone, Tablet } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const WIDTHS = { desktop: "100%", tablet: "768px", mobile: "390px" } as const;

export function PreviewPanel({
  previewUrl,
  reloadKey,
  route,
}: {
  previewUrl: string;
  reloadKey: number;
  route: string;
}) {
  const [device, setDevice] = useState<keyof typeof WIDTHS>("desktop");
  const [path, setPath] = useState("/");
  const [src, setSrc] = useState(previewUrl);
  const [nonce, setNonce] = useState(0);

  // Keep the address bar in sync with in-app navigation reported by the preview.
  useEffect(() => setPath(route), [route]);

  const go = (p: string) => {
    const clean = p.startsWith("/") ? p : `/${p}`;
    setSrc(new URL(clean, previewUrl).toString());
    setNonce((n) => n + 1);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b px-2 py-1.5">
        {(
          [
            ["desktop", Monitor],
            ["tablet", Tablet],
            ["mobile", Smartphone],
          ] as const
        ).map(([d, Icon]) => (
          <Tooltip key={d}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn("size-7", device === d && "bg-muted")}
                onClick={() => setDevice(d)}
                aria-label={`${d} width`}
              >
                <Icon className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="capitalize">{d}</TooltipContent>
          </Tooltip>
        ))}
        <form
          className="mx-1 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            go(path);
          }}
        >
          <Input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            className="h-7 font-mono text-xs"
            aria-label="Preview route"
          />
        </form>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => go(path)}
          aria-label="Reload preview"
        >
          <RotateCw className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="size-7" asChild>
          <a
            href={new URL(path || "/", previewUrl).toString()}
            target="_blank"
            rel="noreferrer"
            aria-label="Open in new tab"
          >
            <ExternalLink className="size-3.5" />
          </a>
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 justify-center overflow-auto bg-muted/40">
        <iframe
          key={`${reloadKey}-${nonce}`}
          src={src}
          title="App preview"
          className="h-full border-0 bg-white transition-[width]"
          style={{ width: WIDTHS[device] }}
          // Separate origin already isolates cookies; allow-same-origin keeps localStorage working inside the app.
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
        />
      </div>
    </div>
  );
}
