/**
 * TodayCard — the differentiator. A React **Server Component**: first paint
 * on mobile 4G must be a single round-trip (CLAUDE.md architecture rule 3),
 * so there is no "use client" and no client state here. Purely presentational
 * and props-driven; the page fetches the summary server-side and passes it in.
 *
 * The donut is Phase 2 (`IntakeDonut`); Phase 1 ships a calm stacked bar.
 * Never red, never alarmist (CLAUDE.md §11.3) — the dashboard is a quiet glance.
 */
import type { DaySummary } from "@/lib/insights";

function formatOz(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

function formatLastFed(minutesAgo: number | null): string {
  if (minutesAgo === null) {
    return "No feeds logged yet";
  }
  if (minutesAgo < 60) {
    return `Last fed ${minutesAgo} min ago`;
  }
  const hours = Math.floor(minutesAgo / 60);
  const minutes = minutesAgo % 60;
  return minutes === 0 ? `Last fed ${hours}h ago` : `Last fed ${hours}h ${minutes}m ago`;
}

type FeedOzKey = "nursing_oz" | "pumped_oz" | "formula_oz";

const BAR_SEGMENTS: { key: FeedOzKey; label: string; className: string }[] = [
  { key: "nursing_oz", label: "Nursing", className: "bg-sky-500" },
  { key: "pumped_oz", label: "Pumped", className: "bg-teal-500" },
  { key: "formula_oz", label: "Formula", className: "bg-violet-400" },
];

export function TodayCard({ summary }: { summary: DaySummary }) {
  const { feeds, diapers, target, last_feed_minutes_ago } = summary;
  const totalForBar = feeds.nursing_oz + feeds.pumped_oz + feeds.formula_oz;

  return (
    <section
      aria-label="Today at a glance"
      className="w-full rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900"
    >
      <p className="text-xs font-medium uppercase tracking-widest text-stone-500 dark:text-stone-400">Today</p>

      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-5xl font-semibold tracking-tight text-stone-900 tabular-nums dark:text-stone-50">
          {formatOz(feeds.total_oz)}
        </span>
        <span className="text-lg text-stone-500 dark:text-stone-400">oz</span>
      </div>

      <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
        target {formatOz(target.low_oz)}–{formatOz(target.high_oz)} oz · {target.age_days}d old
        {target.weight_oz !== null ? ` · ${formatOz(target.weight_oz)} oz` : ""}
      </p>

      <div className="mt-4">
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
          {totalForBar > 0
            ? BAR_SEGMENTS.map((segment) => {
                const oz = summary.feeds[segment.key];
                if (oz <= 0) {
                  return null;
                }
                return (
                  <div
                    key={segment.key}
                    className={segment.className}
                    style={{ width: `${(oz / totalForBar) * 100}%` }}
                    aria-hidden="true"
                  />
                );
              })
            : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
          {BAR_SEGMENTS.map((segment) => (
            <span key={segment.key} className="inline-flex items-center gap-1.5">
              <span className={`size-2 rounded-full ${segment.className}`} aria-hidden="true" />
              {segment.label} {formatOz(summary.feeds[segment.key])} oz
            </span>
          ))}
        </div>
      </div>

      <div className="mt-5 flex items-center gap-5 text-sm text-stone-700 dark:text-stone-300">
        <span>
          <strong className="font-semibold tabular-nums">{diapers.pee_count}</strong> wet
        </span>
        <span>
          <strong className="font-semibold tabular-nums">{diapers.poop_count}</strong> dirty
        </span>
        <span className="text-stone-500 dark:text-stone-400">{formatLastFed(last_feed_minutes_ago)}</span>
      </div>

      <p className="mt-6 border-t border-stone-100 pt-3 text-xs text-stone-400 dark:border-stone-800 dark:text-stone-500">
        Not medical advice. Call your pediatrician if you&apos;re worried.
      </p>
    </section>
  );
}
