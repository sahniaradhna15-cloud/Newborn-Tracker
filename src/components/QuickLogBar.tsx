"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { submitOrQueue } from "@/lib/offline-queue";
import { cn } from "@/lib/utils";

const QUEUED_MESSAGE = "Saved offline — it'll sync when you're back online.";

/** Pull the Siri-readable readout off a successful response, if present. */
function readSay(data: unknown): string {
  if (data && typeof data === "object" && "say" in data) {
    const say = (data as { say?: unknown }).say;
    if (typeof say === "string" && say.length > 0) {
      return say;
    }
  }
  return "Logged.";
}

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
      const outcome = await submitOrQueue("/api/diapers", {
        client_uuid: crypto.randomUUID(),
        occurred_at: new Date().toISOString(),
        pee,
        poop,
      });
      if (outcome.status === "failed") {
        toast.error("Couldn't log that. Try again.");
        return;
      }
      toast.success(
        outcome.status === "sent" ? readSay(outcome.data) : QUEUED_MESSAGE,
      );
      router.refresh();
    } catch {
      toast.error("Network hiccup — not logged. Try again.");
    } finally {
      setPending(null);
    }
  }

  const pillLift =
    "flex-1 rounded-full transition-transform motion-safe:hover:-translate-y-0.5";

  return (
    <div className="w-full rounded-lg bg-card p-4 shadow-md ring-1 ring-black/5">
      <p className="mb-3 font-mono text-xs font-medium uppercase tracking-[0.2em] text-card-foreground/55">
        Quick log
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          className={pillLift}
          disabled={pending !== null}
          onClick={() => logDiaper("wet", true, false)}
        >
          {pending === "wet" ? "…" : "Wet"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className={pillLift}
          disabled={pending !== null}
          onClick={() => logDiaper("dirty", false, true)}
        >
          {pending === "dirty" ? "…" : "Dirty"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className={pillLift}
          disabled={pending !== null}
          onClick={() => logDiaper("both", true, true)}
        >
          {pending === "both" ? "…" : "Wet + Dirty"}
        </Button>
        <Link href="/log/feed" className={cn(buttonVariants(), pillLift)}>
          Log feed
        </Link>
      </div>
    </div>
  );
}
