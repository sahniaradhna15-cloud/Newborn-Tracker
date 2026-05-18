"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Dashboard quick-actions. The three diaper buttons fire an optimistic POST
 * to /api/diapers without leaving the page; "Log feed" navigates to the full
 * FeedForm. Wired into the dashboard by Task 4 (page.tsx is out of Task 3's
 * file boundary).
 */
export function QuickLogBar() {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  async function logDiaper(label: string, pee: boolean, poop: boolean) {
    setPending(label);
    try {
      const res = await fetch("/api/diapers", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
        body: JSON.stringify({
          client_uuid: crypto.randomUUID(),
          occurred_at: new Date().toISOString(),
          pee,
          poop,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        toast.error("Couldn't log that. Try again.");
        return;
      }
      toast.success(data.say ?? "Logged.");
      router.refresh();
    } catch {
      toast.error("Network hiccup — not logged. Try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex w-full max-w-md flex-wrap gap-2">
      <Button
        type="button"
        variant="outline"
        className="flex-1"
        disabled={pending !== null}
        onClick={() => logDiaper("wet", true, false)}
      >
        {pending === "wet" ? "…" : "Wet"}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="flex-1"
        disabled={pending !== null}
        onClick={() => logDiaper("dirty", false, true)}
      >
        {pending === "dirty" ? "…" : "Dirty"}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="flex-1"
        disabled={pending !== null}
        onClick={() => logDiaper("both", true, true)}
      >
        {pending === "both" ? "…" : "Wet + Dirty"}
      </Button>
      <Link href="/log/feed" className={cn(buttonVariants(), "flex-1")}>
        Log feed
      </Link>
    </div>
  );
}
