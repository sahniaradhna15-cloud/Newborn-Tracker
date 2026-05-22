"use client";

/**
 * IntakeTrendChart — the historical "how much did he drink, and how much is
 * good for his age?" graph behind `/history`. A client island (Recharts needs
 * the DOM); it is fed the per-day rollups from the shared `getRangeSummary`,
 * so the bars here and the TodayCard donut can never disagree (CLAUDE.md §3 —
 * one rollup definition, no second derivation).
 *
 * The shaded band is the age-adjusted good-intake range (`target.low_oz` →
 * `target.high_oz`) recomputed for EACH day's day-of-life, so it RISES as he
 * grows — that is the "in comparison with how old he is" view the dashboard
 * glance can't show. Bars are the day's actual intake.
 *
 * Tone (CLAUDE.md §11.3): never red, never alarmist. "Below the range" is a
 * calm warm tone and "above" is neutral — neither is framed as a problem.
 */

import { useMemo, useState } from "react";
import { Area, Bar, Cell, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { DaySummaryPayload } from "@/lib/day-summary";

type RangeKey = "week" | "this_month" | "last_month";
type Status = "within" | "below" | "above";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "week", label: "Week" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
];

const STATUS_COLOR: Record<Status, string> = {
  within: "var(--chart-2)",
  below: "var(--chart-3)",
  above: "var(--chart-4)",
};

// Calm, non-alarming wording (CLAUDE.md §11.3) — never "below"/"problem".
const STATUS_LABEL: Record<Status, string> = {
  within: "on track",
  below: "a bit under",
  above: "plenty",
};

function roundOz(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatOz(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

function statusOf(total: number, low: number, high: number): Status {
  if (total < low) return "below";
  if (total > high) return "above";
  return "within";
}

/** Year-month key ("2026-05") for the logical day's date as read in `timeZone`. */
function monthKeyInZone(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(
    new Date(iso),
  );
  const year = parts.find((p) => p.type === "year")?.value ?? "0000";
  const month = parts.find((p) => p.type === "month")?.value ?? "00";
  return `${year}-${month}`;
}

function previousMonthKey(key: string): string {
  const [year, month] = key.split("-").map(Number);
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  return `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
}

function fullDayLabel(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone }).format(
    new Date(iso),
  );
}

type ChartDatum = {
  key: string;
  axisLabel: string;
  fullLabel: string;
  total: number;
  low: number;
  high: number;
  bandHeight: number;
  ageDays: number;
  pee: number;
  poop: number;
  status: Status;
};

function IntakeTooltip({ active, payload }: { active?: boolean; payload?: { payload: ChartDatum }[] }) {
  if (!active || !payload?.length) {
    return null;
  }
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-card-foreground/10 bg-card px-3 py-2 text-xs text-card-foreground shadow-md">
      <p className="font-medium">
        {d.fullLabel} · {d.ageDays}d old
      </p>
      <p className="mt-1">
        {formatOz(d.total)} oz{" "}
        <span className="text-card-foreground/55">
          · good range {formatOz(d.low)}–{formatOz(d.high)}
        </span>
      </p>
      <p className="mt-0.5 text-card-foreground/55">
        {d.pee} wet · {d.poop} dirty
      </p>
    </div>
  );
}

export function IntakeTrendChart({ days, timeZone }: { days: DaySummaryPayload[]; timeZone: string }) {
  const [range, setRange] = useState<RangeKey>("week");

  const { thisKey, prevKey } = useMemo(() => {
    const newest = days[0]?.day_start;
    const tk = newest ? monthKeyInZone(newest, timeZone) : "";
    return { thisKey: tk, prevKey: tk ? previousMonthKey(tk) : "" };
  }, [days, timeZone]);

  // getRangeSummary returns newest-first; keep that order for the list below.
  const selected = useMemo<DaySummaryPayload[]>(() => {
    if (range === "week") return days.slice(0, 7);
    if (range === "this_month") return days.filter((d) => monthKeyInZone(d.day_start, timeZone) === thisKey);
    return days.filter((d) => monthKeyInZone(d.day_start, timeZone) === prevKey);
  }, [days, range, timeZone, thisKey, prevKey]);

  const data = useMemo<ChartDatum[]>(() => {
    const axisFmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      ...(range === "week" ? { weekday: "short" } : { day: "numeric" }),
    });
    // Chart reads left→right oldest→newest, the reverse of `selected`.
    return [...selected].reverse().map((d) => {
      const total = roundOz(d.feeds.total_oz);
      const low = roundOz(d.target.low_oz);
      const high = roundOz(d.target.high_oz);
      return {
        key: d.day_start,
        axisLabel: axisFmt.format(new Date(d.day_start)),
        fullLabel: fullDayLabel(d.day_start, timeZone),
        total,
        low,
        high,
        bandHeight: Math.max(0, roundOz(high - low)),
        ageDays: d.target.age_days,
        pee: d.diapers.pee_count,
        poop: d.diapers.poop_count,
        status: statusOf(total, low, high),
      };
    });
  }, [selected, range, timeZone]);

  const stats = useMemo(() => {
    if (data.length === 0) return null;
    const totals = data.map((d) => d.total);
    const avg = roundOz(totals.reduce((sum, t) => sum + t, 0) / totals.length);
    const inBand = data.filter((d) => d.status === "within").length;
    const includesToday = range !== "last_month";
    return {
      avg,
      inBand,
      count: data.length,
      includesToday,
      today: data[data.length - 1] ?? null,
      yesterday: data.length > 1 ? data[data.length - 2] : null,
    };
  }, [data, range]);

  // Thin out x-axis labels once a month's worth of bars would overlap.
  const tickInterval = data.length > 10 ? Math.floor(data.length / 8) : 0;

  return (
    <section
      aria-label="Intake trend"
      className="w-full rounded-lg bg-card p-5 text-card-foreground shadow-md ring-1 ring-black/5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-card-foreground/55">
            Intake trend
          </p>
          <p className="mt-1 text-sm text-card-foreground/60">Daily ounces against the healthy range for his age.</p>
        </div>
        <div className="flex shrink-0 overflow-hidden rounded-lg border border-card-foreground/15 text-xs">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRange(r.key)}
              aria-pressed={range === r.key}
              className={
                range === r.key
                  ? "bg-card-foreground px-3 py-1.5 text-card"
                  : "px-3 py-1.5 text-card-foreground/60 transition-colors hover:text-card-foreground"
              }
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {data.length === 0 ? (
        <p className="mt-10 mb-8 text-center text-sm text-card-foreground/55">
          {range === "last_month" ? "No feeds logged last month." : "No feeds logged in this range yet."}
        </p>
      ) : (
        <>
          <div className="mt-4 h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                <XAxis
                  dataKey="axisLabel"
                  tickLine={false}
                  axisLine={false}
                  interval={tickInterval}
                  tick={{ fontSize: 11, fill: "var(--card-foreground)" }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={40}
                  tick={{ fontSize: 11, fill: "var(--card-foreground)" }}
                />
                <Tooltip content={<IntakeTooltip />} cursor={{ fill: "var(--card-foreground)", fillOpacity: 0.05 }} />
                {/* Two stacked areas draw the per-day band: an invisible base up
                    to `low`, then the tinted `bandHeight` from `low` to `high`. */}
                <Area dataKey="low" stackId="band" stroke="none" fill="transparent" isAnimationActive={false} />
                <Area
                  dataKey="bandHeight"
                  stackId="band"
                  stroke="none"
                  fill="var(--chart-2)"
                  fillOpacity={0.18}
                  isAnimationActive={false}
                />
                <Bar dataKey="total" maxBarSize={30} radius={[3, 3, 0, 0]} isAnimationActive={false}>
                  {data.map((d) => (
                    <Cell key={d.key} fill={STATUS_COLOR[d.status]} />
                  ))}
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {stats ? (
            <p className="mt-3 text-sm text-card-foreground/70">
              {stats.includesToday && stats.today ? (
                <>
                  <span className="text-card-foreground">Today {formatOz(stats.today.total)} oz</span>
                  {stats.yesterday ? <> · Yesterday {formatOz(stats.yesterday.total)} oz</> : null} ·{" "}
                </>
              ) : null}
              avg {formatOz(stats.avg)} oz/day · {stats.inBand} of {stats.count} days on track
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-card-foreground/55">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ backgroundColor: "var(--chart-2)" }} aria-hidden="true" />
              On track
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ backgroundColor: "var(--chart-3)" }} aria-hidden="true" />
              A bit under
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ backgroundColor: "var(--chart-4)" }} aria-hidden="true" />
              Plenty
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="h-2 w-3 rounded-sm"
                style={{ backgroundColor: "var(--chart-2)", opacity: 0.3 }}
                aria-hidden="true"
              />
              Healthy range (by age)
            </span>
          </div>

          <p className="mt-3 text-xs text-card-foreground/45">
            Breast feeds use your own estimate, so totals can read a little low — his real intake is likely higher.
          </p>

          <ul className="mt-5 space-y-1.5 border-t border-card-foreground/10 pt-4">
            {selected.map((d) => (
              <li key={d.day_start} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate text-card-foreground/80">{fullDayLabel(d.day_start, timeZone)}</span>
                <span className="flex shrink-0 items-center gap-2 text-card-foreground/55 tabular-nums">
                  {formatOz(d.feeds.total_oz)} oz · {d.diapers.pee_count} wet · {d.diapers.poop_count} dirty
                  {(() => {
                    const status = statusOf(d.feeds.total_oz, d.target.low_oz, d.target.high_oz);
                    return (
                      <span
                        className={
                          status === "below"
                            ? "rounded-full bg-amber-100/70 px-2 py-0.5 text-amber-800"
                            : "rounded-full bg-card-foreground/5 px-2 py-0.5 text-card-foreground/60"
                        }
                      >
                        {STATUS_LABEL[status]}
                      </span>
                    );
                  })()}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
