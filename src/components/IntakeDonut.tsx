"use client";

/**
 * IntakeDonut — the dashboard's intake-at-a-glance ring. The ONLY client
 * island on the otherwise-server TodayCard (CLAUDE.md §3 rule 3): Recharts
 * needs the DOM, so this is `"use client"` and TodayCard stays a server
 * component that simply renders it.
 *
 * Consumes the EXISTING `DaySummaryPayload.feeds` shape — no new query,
 * no derivation here beyond a layout split (CLAUDE.md §3 rule 4 / Task 4
 * reconciliation note: feed totals are computed once in `day-summary.ts`).
 *
 * Tone (CLAUDE.md §11.3): calm, never red, never alarmist — the colors
 * reuse TodayCard's existing chart tokens; `wasted_oz` is a small neutral
 * grey arc (tracked, not intake). The center shows the day total + the
 * informational target band, never a single "should" number.
 */
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

type Feeds = {
  total_oz: number;
  nursing_oz: number;
  pumped_oz: number;
  formula_oz: number;
  wasted_oz: number;
};

type Target = { low_oz: number; high_oz: number };

function formatOz(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

const SLICES: { key: keyof Feeds; label: string; color: string }[] = [
  { key: "nursing_oz", label: "Nursing", color: "var(--chart-2)" },
  { key: "pumped_oz", label: "Pumped", color: "var(--chart-4)" },
  { key: "formula_oz", label: "Formula", color: "var(--chart-3)" },
  { key: "wasted_oz", label: "Wasted", color: "var(--chart-5)" },
];

export function IntakeDonut({ feeds, target }: { feeds: Feeds; target: Target }) {
  const data = SLICES.map((s) => ({ name: s.label, value: Math.max(0, feeds[s.key]), color: s.color })).filter(
    (d) => d.value > 0,
  );
  const hasData = data.length > 0;

  return (
    <div className="relative mt-5">
      <div className="mx-auto h-44 w-44">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius="68%"
                outerRadius="100%"
                startAngle={90}
                endAngle={-270}
                paddingAngle={1}
                stroke="none"
                isAnimationActive={false}
              >
                {data.map((d) => (
                  <Cell key={d.name} fill={d.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div
            className="flex h-full w-full items-center justify-center rounded-full border-[14px] border-card-foreground/10"
            aria-hidden="true"
          />
        )}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="font-heading text-4xl leading-none text-card-foreground tabular-nums">
            {formatOz(feeds.total_oz)}
          </span>
          <span className="mt-0.5 text-xs text-card-foreground/55">oz today</span>
          <span className="mt-1 text-[0.7rem] text-card-foreground/45">
            target {formatOz(target.low_oz)}–{formatOz(target.high_oz)}
          </span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-card-foreground/60">
        {SLICES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ backgroundColor: s.color }} aria-hidden="true" />
            {s.label} {formatOz(feeds[s.key])} oz
          </span>
        ))}
      </div>
    </div>
  );
}
