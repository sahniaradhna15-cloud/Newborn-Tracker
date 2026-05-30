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

  // The healthy range rises with age; over a 7-day glance the spread is small,
  // so one averaged band reads cleanly. The full /history chart shows the exact
  // per-day band. Positioned as a % of the same `maxScale` the bars use.
  const avgLow = ordered.reduce((sum, d) => sum + d.target.low_oz, 0) / ordered.length;
  const avgHigh = ordered.reduce((sum, d) => sum + d.target.high_oz, 0) / ordered.length;
  const lowPct = (avgLow / maxScale) * 100;
  const highPct = (avgHigh / maxScale) * 100;

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

      <div className="relative mt-4 h-16">
        {/* Recommended range for his age: faint band low→high with a dashed
            line on the lower edge (the level to reach). Sits behind the bars. */}
        <div
          className="pointer-events-none absolute inset-x-0 z-0 rounded-sm"
          style={{ bottom: `${lowPct}%`, height: `${Math.max(0, highPct - lowPct)}%`, backgroundColor: "var(--chart-2)", opacity: 0.16 }}
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute inset-x-0 z-0 border-t border-dashed"
          style={{ bottom: `${lowPct}%`, borderColor: "var(--chart-2)" }}
          aria-hidden="true"
        />
        <div className="relative z-10 flex h-full items-end gap-2">
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
      </div>
      <div className="mt-1 flex gap-2">
        {ordered.map((d) => (
          <span key={d.day_start} className="flex-1 text-center text-[0.65rem] text-card-foreground/45">
            {dayInitial(d.day_start)}
          </span>
        ))}
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-xs text-card-foreground/55">
        <span
          className="inline-block h-2 w-3 shrink-0 rounded-sm"
          style={{ backgroundColor: "var(--chart-2)", opacity: 0.3 }}
          aria-hidden="true"
        />
        Shaded band is his healthy range — tap for week &amp; month views.
      </p>
    </Link>
  );
}
