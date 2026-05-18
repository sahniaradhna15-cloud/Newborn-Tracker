"use client";

/**
 * Drains the offline queue and surfaces the "waiting to sync" signal
 * (Phase 3 Task 2). Mounted once near the root so it covers every page that
 * can log (the dashboard QuickLogBar and the /log/* forms).
 *
 * Replay triggers, belt-and-braces because the `online` event is unreliable
 * on captive portals and in standalone PWA relaunch:
 *   - the browser `online` event
 *   - a 60s interval backup
 *   - our own `QUEUE_CHANGED_EVENT` (a fresh enqueue, so the count updates at
 *     once and an opportunistic drain runs if we're actually online)
 *
 * Renders the pending-count line itself rather than threading it through the
 * server-rendered InsightBanner — the count is client-only IndexedDB state.
 * Calm amber, no medical disclaimer: this is operational, not a health signal.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { count, drainQueue, QUEUE_CHANGED_EVENT } from "@/lib/offline-queue";

const DRAIN_INTERVAL_MS = 60_000;

export function QueueReplayProvider() {
  const router = useRouter();
  const [pending, setPending] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const refreshCount = async () => {
      const next = await count();
      if (!cancelled) {
        setPending(next);
      }
    };

    const drain = async () => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        await refreshCount();
        return;
      }
      const { drained } = await drainQueue();
      if (!cancelled && drained > 0) {
        router.refresh();
      }
      await refreshCount();
    };

    void drain();
    const interval = setInterval(() => void drain(), DRAIN_INTERVAL_MS);
    window.addEventListener("online", drain);
    window.addEventListener(QUEUE_CHANGED_EVENT, drain);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("online", drain);
      window.removeEventListener(QUEUE_CHANGED_EVENT, drain);
    };
  }, [router]);

  if (pending === 0) {
    return null;
  }

  const label =
    pending === 1
      ? "1 entry is waiting to sync"
      : `${pending} entries are waiting to sync`;

  return (
    <div
      role="status"
      className="mx-auto w-full max-w-md px-4 pt-3"
    >
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        {label} — they&apos;ll go through when you&apos;re back online.
      </div>
    </div>
  );
}
