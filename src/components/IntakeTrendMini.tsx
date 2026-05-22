/**
 * IntakeTrendMini — the dashboard's at-a-glance "last 7 days" sparkline and the
 * doorway to the full `/history` trend graph. A React **Server Component** (no
 * "use client"): it is pure CSS bars, so it adds zero client JS and never
 * blocks first paint (CLAUDE.md §3 rule 3). Recharts stays on `/history`.
 *
 * Bars are each day's total intake; colour encodes the age-adjusted band
 * comparison (in range / below / above) using the SAME `target` the rollup
 * computed — no second derivation here. Tone (CLAUDE.md §11.3): never red.
 */
import Link from "next/link";

import type { DaySummaryPayload } from "@/lib/day-summary";

type Status = "within" | "below" | "above";

const STATUS_COLOR: Record<Status, string> = {
  within: "var(--chart-2)",
  below: "var(--chart-3)",
  above: "var(--chart-4)",
};

function statusOf(total: number, low: number, high: number): Status {
  if (total < low) return "below";
  if (total > high) return "above";
  return "within";
}

export function IntakeTrendMini({ days, timeZone }: { days: DaySummaryPayload[]; timeZone: string }) {
  if (days.length === 0) {
    return null;
  }

  // `getRangeSummary` is newest-first; the sparkline reads left→right oldest→newest.
  const ordered = [...days].reverse();
  const maxScale = Math.max(1, ...ordered.flatMap((d) => [d.feeds.total_oz, d.target.high_oz]));
  const dayInitial = (iso: string) =>
    new Intl.DateTimeFormat("en-US", { weekday: "narrow", timeZone }).format(new Date(iso));

  return (
    <Link
      href="/history"
      className="group block w-full rounded-lg bg-card p-5 text-card-foreground shadow-md ring-1 ring-black/5 transition-shadow hover:shadow-lg"
    >
      <div className="flex items-center justify-between">
        <p className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-card-foreground/55">Last 7 days</p>
        <span className="text-xs text-card-foreground/60 transition-colors group-hover:text-card-foreground">
          View trends →
        </span>
      </div>

      <div className="mt-4 flex h-16 items-end gap-2">
        {ordered.map((d) => {
          const status = statusOf(d.feeds.total_oz, d.target.low_oz, d.target.high_oz);
          const heightPct = Math.max(6, Math.round((d.feeds.total_oz / maxScale) * 100));
          return (
            <div
              key={d.day_start}
              className="flex-1 rounded-sm"
              style={{ height: `${heightPct}%`, backgroundColor: STATUS_COLOR[status] }}
              aria-hidden="true"
            />
          );
        })}
      </div>
      <div className="mt-1 flex gap-2">
        {ordered.map((d) => (
          <span key={d.day_start} className="flex-1 text-center text-[0.65rem] text-card-foreground/45">
            {dayInitial(d.day_start)}
          </span>
        ))}
      </div>

      <p className="mt-3 text-xs text-card-foreground/55">
        Daily intake vs. his healthy range — tap for week &amp; month views.
      </p>
    </Link>
  );
}
