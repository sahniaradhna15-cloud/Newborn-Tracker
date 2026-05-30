"use client";

/**
 * DiaperDonut — the diaper companion to {@link IntakeDonut}, so the day's
 * changes read at a glance the same way intake does. A client island (Recharts
 * needs the DOM); TodayCard stays a server component (CLAUDE.md §3 rule 3).
 *
 * Three slices that PARTITION the day's changes with no overlap — wet only,
 * dirty only, and wet + dirty — so a both-diaper is its own honest category
 * instead of being double-counted across two slices. The slices sum to the
 * "changes today" total in the centre. Tone (CLAUDE.md §11.3): calm, never red.
 */
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

type Diapers = {
  wet_only_count: number;
  dirty_only_count: number;
  both_count: number;
  change_count: number;
};

const WET_COLOR = "var(--chart-4)";
const DIRTY_COLOR = "var(--chart-1)";
const BOTH_COLOR = "var(--chart-3)";

export function DiaperDonut({ diapers }: { diapers: Diapers }) {
  const segments = [
    { name: "Wet", value: diapers.wet_only_count, color: WET_COLOR },
    { name: "Dirty", value: diapers.dirty_only_count, color: DIRTY_COLOR },
    { name: "Wet + dirty", value: diapers.both_count, color: BOTH_COLOR },
  ];
  const data = segments.filter((s) => s.value > 0);
  const hasData = data.length > 0;

  return (
    <div>
      <p className="font-mono text-xs font-medium uppercase tracking-[0.15em] text-card-foreground/55">Diapers</p>

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
            {diapers.change_count}
          </span>
          <span className="mt-0.5 text-xs text-card-foreground/55">
            {diapers.change_count === 1 ? "change" : "changes"}
          </span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-card-foreground/65">
        {segments.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ backgroundColor: s.color }} aria-hidden="true" />
            {s.name} {s.value}
          </span>
        ))}
      </div>
    </div>
  );
}
