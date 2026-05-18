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
  { key: "nursing_oz", label: "Nursing", className: "bg-[var(--chart-2)]" },
  { key: "pumped_oz", label: "Pumped", className: "bg-[var(--chart-4)]" },
  { key: "formula_oz", label: "Formula", className: "bg-[var(--chart-3)]" },
];

export function TodayCard({ summary }: { summary: DaySummary }) {
  const { feeds, diapers, target, last_feed_minutes_ago } = summary;
  const totalForBar = feeds.nursing_oz + feeds.pumped_oz + feeds.formula_oz;

  return (
    <section
      aria-label="Today at a glance"
      className="w-full rounded-lg bg-card p-6 text-card-foreground shadow-md ring-1 ring-black/5"
    >
      <p className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-card-foreground/55">Today</p>

      <div className="mt-2 flex items-baseline gap-2">
        <span className="font-heading text-6xl leading-none text-card-foreground tabular-nums">
          {formatOz(feeds.total_oz)}
        </span>
        <span className="text-lg text-card-foreground/55">oz</span>
      </div>

      <p className="mt-2 text-sm text-card-foreground/60">
        target {formatOz(target.low_oz)}–{formatOz(target.high_oz)} oz · {target.age_days}d old
        {target.weight_oz !== null ? ` · ${formatOz(target.weight_oz)} oz` : ""}
      </p>

      <div className="mt-5">
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-card-foreground/10">
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
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-card-foreground/60">
          {BAR_SEGMENTS.map((segment) => (
            <span key={segment.key} className="inline-flex items-center gap-1.5">
              <span className={`size-2 rounded-full ${segment.className}`} aria-hidden="true" />
              {segment.label} {formatOz(summary.feeds[segment.key])} oz
            </span>
          ))}
        </div>
      </div>

      <div className="mt-5 flex items-center gap-5 text-sm text-card-foreground/80">
        <span>
          <strong className="font-semibold tabular-nums">{diapers.pee_count}</strong> wet
        </span>
        <span>
          <strong className="font-semibold tabular-nums">{diapers.poop_count}</strong> dirty
        </span>
        <span className="text-card-foreground/55">{formatLastFed(last_feed_minutes_ago)}</span>
      </div>

      <p className="mt-6 border-t border-card-foreground/10 pt-3 text-xs text-card-foreground/45">
        Not medical advice. Call your pediatrician if you&apos;re worried.
      </p>
    </section>
  );
}
