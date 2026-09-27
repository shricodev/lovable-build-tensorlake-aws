"use client";

import { Check, Copy, Share2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function ShareDialog({ projectId, initialShared }: { projectId: string; initialShared: boolean }) {
  const [shared, setShared] = useState(initialShared);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const link = typeof window === "undefined" ? "" : `${window.location.origin}/share/${projectId}`;

  async function toggle(next: boolean) {
    setSaving(true);
    const res = await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ visibility: next ? "shared" : "private" }),
    });
    setSaving(false);
    if (!res.ok) return toast.error("Couldn't update sharing");
    setShared(next);
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5">
          <Share2 className="size-4" /> Share
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share</DialogTitle>
          <DialogDescription>
            Anyone with the link can view the live app and remix it into their own account.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between rounded-lg border p-3">
          <Label htmlFor="share-toggle" className="text-sm font-normal">
            Share with a link
          </Label>
          <Switch
            id="share-toggle"
            checked={shared}
            disabled={saving}
            onCheckedChange={(v) => void toggle(v)}
          />
        </div>
        {shared && (
          <div className="flex gap-2">
            <Input readOnly value={link} className="font-mono text-xs" aria-label="Share link" />
            <Button
              variant="outline"
              size="icon"
              aria-label="Copy link"
              onClick={() => {
                void navigator.clipboard.writeText(link);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
