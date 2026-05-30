"use client";

/**
 * IntakeDonut — the dashboard's intake-at-a-glance ring. A client island on
 * the otherwise-server TodayCard (CLAUDE.md §3 rule 3): Recharts needs the DOM.
 *
 * Shows the split that actually matters to the day's feeding: breast milk
 * (nursing + pumped, combined) versus formula. "Wasted" is tracked elsewhere,
 * not intake, so it never appears here. A toggle drills the breast-milk slice
 * into its nursing vs pumped parts on demand.
 *
 * Tone (CLAUDE.md §11.3): calm, never red — colours reuse the shared chart
 * tokens. The centre shows only the day total (no second "should" number; the
 * target band lives in TargetGauge).
 */
import { useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

type Feeds = {
  total_oz: number;
  nursing_oz: number;
  pumped_oz: number;
  formula_oz: number;
};

const NURSING_COLOR = "var(--chart-2)";
const PUMPED_COLOR = "var(--chart-4)";
const BREAST_COLOR = "var(--chart-2)";
const FORMULA_COLOR = "var(--chart-3)";

function formatOz(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

function roundOz(value: number): number {
  return Math.round(value * 10) / 10;
}

export function IntakeDonut({ feeds }: { feeds: Feeds }) {
  const [showBreakdown, setShowBreakdown] = useState(false);

  const breastOz = roundOz(feeds.nursing_oz + feeds.pumped_oz);
  const hasBreast = breastOz > 0;

  const segments = showBreakdown
    ? [
        { name: "Nursing", value: feeds.nursing_oz, color: NURSING_COLOR },
        { name: "Pumped", value: feeds.pumped_oz, color: PUMPED_COLOR },
        { name: "Formula", value: feeds.formula_oz, color: FORMULA_COLOR },
      ]
    : [
        { name: "Breast milk", value: breastOz, color: BREAST_COLOR },
        { name: "Formula", value: feeds.formula_oz, color: FORMULA_COLOR },
      ];

  const data = segments.filter((s) => s.value > 0);
  const hasData = data.length > 0;

  return (
    <div>
      <p className="font-mono text-xs font-medium uppercase tracking-[0.15em] text-card-foreground/55">Intake</p>

      <div className="relative mx-auto mt-2 h-36 w-36">
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
            className="flex h-full w-full items-center justify-center rounded-full border-[12px] border-card-foreground/10"
            aria-hidden="true"
          />
        )}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="font-heading text-3xl leading-none text-card-foreground tabular-nums">
            {formatOz(feeds.total_oz)}
          </span>
          <span className="mt-0.5 text-xs text-card-foreground/55">oz</span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-card-foreground/65">
        {data.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ backgroundColor: s.color }} aria-hidden="true" />
            {s.name} {formatOz(s.value)} oz
          </span>
        ))}
      </div>

      {hasBreast ? (
        <button
          type="button"
          onClick={() => setShowBreakdown((prev) => !prev)}
          aria-expanded={showBreakdown}
          className="mx-auto mt-3 block rounded-full px-2.5 py-1 text-xs font-medium text-card-foreground/60 transition-colors hover:bg-card-foreground/5 hover:text-card-foreground"
        >
          {showBreakdown ? "Hide breast milk breakdown" : "Show breast milk breakdown"}
        </button>
      ) : null}
    </div>
  );
}
