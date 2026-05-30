/**
 * TargetGauge — a calm, visual read of "where today's intake sits versus the
 * age-adjusted healthy range" (CLAUDE.md §11.3: never red, never alarmist).
 *
 * Pure CSS, no client JS — a React Server Component so it never blocks the
 * TodayCard's first paint (CLAUDE.md §3 rule 3). The healthy band is the
 * highlighted segment; a marker shows where the day's total falls. The exact
 * total lives in the donut center, so the gauge stays about *position*, not a
 * second "should" number.
 */

type GaugeStatus = "within" | "below" | "above";

function formatOz(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

function statusOf(total: number, low: number, high: number): GaugeStatus {
  if (total < low) return "below";
  if (total > high) return "above";
  return "within";
}

export function TargetGauge({ totalOz, lowOz, highOz }: { totalOz: number; lowOz: number; highOz: number }) {
  const status = statusOf(totalOz, lowOz, highOz);

  // Leave ~18% headroom past the binding edge so the band and marker never hug
  // the track ends. Floor at 1 so a brand-new day still has a sane scale.
  const scaleMax = Math.max(1, Math.max(highOz, totalOz) * 1.18);
  const pct = (value: number) => Math.min(100, Math.max(0, (value / scaleMax) * 100));

  const bandLeft = pct(lowOz);
  const bandWidth = Math.max(0, pct(highOz) - pct(lowOz));
  const markerLeft = Math.min(98, Math.max(2, pct(totalOz)));

  const toGo = Math.round((lowOz - totalOz) * 10) / 10;
  const caption =
    status === "below"
      ? `${formatOz(toGo)} oz to go`
      : status === "above"
        ? "A little above the range — that's okay"
        : "In the healthy range";

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-xs font-medium uppercase tracking-[0.15em] text-card-foreground/55">
          Daily target
        </span>
        <span className="text-sm font-semibold tabular-nums text-card-foreground/80">
          {formatOz(lowOz)}–{formatOz(highOz)} oz
        </span>
      </div>

      <div className="relative mt-2 h-3 w-full rounded-full bg-card-foreground/10">
        <div
          className="absolute top-0 h-full rounded-full"
          style={{ left: `${bandLeft}%`, width: `${bandWidth}%`, backgroundColor: "var(--chart-2)", opacity: 0.4 }}
          aria-hidden="true"
        />
        <div
          className="absolute -top-1 h-5 w-[3px] -translate-x-1/2 rounded-full bg-card-foreground/80 ring-2 ring-card"
          style={{ left: `${markerLeft}%` }}
          aria-hidden="true"
        />
      </div>

      <p
        className={`mt-2 text-xs ${status === "below" ? "text-amber-700 dark:text-amber-400" : "text-card-foreground/55"}`}
      >
        {caption}
      </p>
    </div>
  );
}
