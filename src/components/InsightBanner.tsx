/**
 * InsightBanner — renders the WHO/AAP-aligned signals from `computeInsights`
 * as calm, inline cards under the TodayCard. A React **Server Component**
 * with no client JS: no close button, no toast, no modal, no push
 * (CLAUDE.md §11.3) — the signal simply disappears when the data shifts.
 *
 * Visual contract (§11.3): muted `bg-amber-50` for info, never red, ≤2 lines,
 * and every card ends with the non-negotiable medical-advice line. Empty
 * input renders nothing — never a preachy "all good!".
 */
import { Info } from "lucide-react";

import type { Insight } from "@/lib/insights";

const DISCLAIMER = "Not medical advice. Call your pediatrician if you're worried.";

export function InsightBanner({ insights }: { insights: Insight[] }) {
  if (insights.length === 0) {
    return null;
  }

  return (
    <div aria-label="Things worth a glance" className="w-full space-y-2">
      {insights.map((insight) => (
        <div
          key={insight.kind}
          className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100"
        >
          <Info className="mt-0.5 size-4 shrink-0 text-amber-500 dark:text-amber-400" aria-hidden="true" />
          <div className="min-w-0">
            <p className="line-clamp-2 text-sm">{insight.text}</p>
            <p className="mt-1 text-xs text-amber-700/80 dark:text-amber-200/70">{DISCLAIMER}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
