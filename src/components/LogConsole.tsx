"use client";

import { useState } from "react";

import { DiaperForm } from "@/components/DiaperForm";
import { FeedForm } from "@/components/FeedForm";
import { QuickLogBar } from "@/components/QuickLogBar";
import { Button } from "@/components/ui/button";

type LogTab = "feed" | "diaper";

/**
 * The single logging surface. Lives in the dashboard's right bento column so
 * the whole app is one page: glance + log without navigating. A top-level
 * segmented control swaps between the full FeedForm / DiaperForm; the one-tap
 * diaper pills sit underneath as the fastest path. Each form calls
 * router.refresh() on success, which re-renders the server TodayCard in place.
 */
export function LogConsole() {
  const [tab, setTab] = useState<LogTab>("feed");

  return (
    <section
      aria-label="Log"
      className="w-full rounded-lg bg-card p-6 text-card-foreground shadow-md ring-1 ring-black/5 lg:sticky lg:top-6"
    >
      <p className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-card-foreground/55">
        Log
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant={tab === "feed" ? "default" : "outline"}
          onClick={() => setTab("feed")}
          aria-pressed={tab === "feed"}
        >
          Feed
        </Button>
        <Button
          type="button"
          variant={tab === "diaper" ? "default" : "outline"}
          onClick={() => setTab("diaper")}
          aria-pressed={tab === "diaper"}
        >
          Diaper
        </Button>
      </div>

      <div className="mt-5">{tab === "feed" ? <FeedForm /> : <DiaperForm />}</div>

      <div className="mt-6 border-t border-card-foreground/10 pt-4">
        <p className="mb-3 font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-card-foreground/55">
          One-tap diaper
        </p>
        <QuickLogBar />
      </div>
    </section>
  );
}
