"use client";

import { GitFork, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function RemixButton({ projectId, label = "Remix" }: { projectId: string; label?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        const res = await fetch(`/api/projects/${projectId}/remix`, { method: "POST" });
        if (res.status === 401) return router.push("/login");
        const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
        if (!res.ok || !data.id) {
          setPending(false);
          return toast.error(data.error ?? "Couldn't remix this project");
        }
        router.push(`/projects/${data.id}`);
      }}
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <GitFork className="size-4" />} {label}
    </Button>
  );
}
