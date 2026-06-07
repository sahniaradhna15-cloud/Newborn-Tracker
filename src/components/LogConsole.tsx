"use client";

import { useState } from "react";

import { FeedForm } from "@/components/FeedForm";
import { QuickLogBar } from "@/components/QuickLogBar";
import { Button } from "@/components/ui/button";

type LogTab = "feed" | "diaper";

/**
 * The single logging surface. Lives in the dashboard's right bento column so
 * the whole app is one page: glance + log without navigating. A segmented
 * control swaps between the full FeedForm and the one-tap diaper pills — there
 * is ONE way to log a diaper (the instant Wet / Dirty / Wet+Dirty pills), no
 * duplicate full diaper form. Each path calls router.refresh() on success,
 * which re-renders the server TodayCard in place.
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

      {tab === "feed" ? (
        <div className="mt-5">
          <FeedForm />
        </div>
      ) : (
        <div className="mt-5">
          <p className="mb-3 text-sm text-card-foreground/60">Tap one to log it now.</p>
          <QuickLogBar />
        </div>
      )}
    </section>
  );
}
