"use client";

/**
 * IntakeByAgeTrend — the interactive "is he drinking enough for his age, week by
 * week?" view on `/history`. Replaces the old static row list (which read as a
 * clumsy table) with a small trend line: the age-appropriate daily band (shaded,
 * rising as he grows) and a line of his actual weekly average on top, so a new
 * mom can see at a glance whether each week ran a little under, typical, or
 * plenty — and tap any week to compare it with the week before and after.
 *
 * Client island because Recharts needs the DOM and the week filter is stateful.
 * It is fed the SAME per-week rows the server already computes, so the numbers
 * here can never disagree with the rest of `/history`.
 *
 * Tone (CLAUDE.md §11.3): never red, never "below"/"problem". A week that runs a
 * little under the band is shown gently and always paired with the reminder that
 * breast feeds are estimated low, so true intake is likely higher.
 */

import { useMemo, useState } from "react";
import {
  Area,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ozToMl } from "@/lib/units";

export type IntakeByAgeRow = {
  weekOfAge: number;
  ageDays: number;
  lowOz: number;
  highOz: number;
  /** His average daily intake over the logged days that week; null if none logged. */
  avgOz: number | null;
  isCurrent: boolean;
  /** True for a week he hasn't reached yet (shown as a preview of what's next). */
  isUpcoming: boolean;
};

type Tone = "typical" | "under" | "plenty" | "none";

const STATUS_COLOR: Record<Exclude<Tone, "none">, string> = {
  typical: "var(--chart-2)",
  under: "var(--chart-3)",
  plenty: "var(--chart-4)",
};

const TONE_LABEL: Record<Tone, string> = {
  typical: "right in the typical range",
  under: "a little under — breast feeds are counted low, so likely higher",
  plenty: "plenty",
  none: "no feeds logged this week",
};

function toneFor(row: IntakeByAgeRow): Tone {
  if (row.avgOz === null) return "none";
  if (row.avgOz < row.lowOz) return "under";
  if (row.avgOz > row.highOz) return "plenty";
  return "typical";
}

function fmtOz(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

/** Approx ml for parents who track in ml, rounded to the nearest 10. */
function fmtMl(oz: number): string {
  return `${Math.round(ozToMl(oz) / 10) * 10}`;
}

type WeekDatum = {
  week: number;
  weekLabel: string;
  low: number;
  high: number;
  bandHeight: number;
  avg: number | null;
  tone: Tone;
  isCurrent: boolean;
  isUpcoming: boolean;
};

type DotProps = {
  cx?: number;
  cy?: number;
  index?: number;
  payload?: WeekDatum;
};

/** Per-week marker on the average line, colored by tone and ringed when selected. */
function AvgDot({ cx, cy, index, payload, selectedWeek }: DotProps & { selectedWeek: number }) {
  if (cx == null || cy == null || !payload || payload.avg == null || payload.tone === "none") {
    return <g key={index} />;
  }
  const color = STATUS_COLOR[payload.tone];
  const isSelected = payload.week === selectedWeek;
  return (
    <g key={index}>
      {isSelected ? <circle cx={cx} cy={cy} r={9} fill={color} fillOpacity={0.2} /> : null}
      <circle
        cx={cx}
        cy={cy}
        r={isSelected ? 5 : 3.5}
        fill={color}
        stroke="var(--card)"
        strokeWidth={1.5}
      />
    </g>
  );
}

function WeekTooltip({ active, payload }: { active?: boolean; payload?: { payload: WeekDatum }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-card-foreground/10 bg-card px-3 py-2 text-xs text-card-foreground shadow-md">
      <p className="font-medium">Week {d.week}</p>
      <p className="mt-1">
        Needs{" "}
        <span className="text-card-foreground/70">
          {fmtOz(d.low)}–{fmtOz(d.high)} oz
        </span>
      </p>
      <p className="mt-0.5">
        Got{" "}
        {d.avg === null ? (
          <span className="text-card-foreground/55">nothing logged</span>
        ) : (
          <span className="text-card-foreground/70">avg {fmtOz(d.avg)} oz</span>
        )}
      </p>
    </div>
  );
}

export function IntakeByAgeTrend({ babyName, rows }: { babyName: string; rows: IntakeByAgeRow[] }) {
  const data = useMemo<WeekDatum[]>(
    () =>
      rows.map((row) => ({
        week: row.weekOfAge,
        weekLabel: `W${row.weekOfAge}`,
        low: row.lowOz,
        high: row.highOz,
        bandHeight: Math.max(0, Math.round((row.highOz - row.lowOz) * 10) / 10),
        avg: row.avgOz,
        tone: toneFor(row),
        isCurrent: row.isCurrent,
        isUpcoming: row.isUpcoming,
      })),
    [rows],
  );

  const currentWeek = rows.find((r) => r.isCurrent)?.weekOfAge ?? rows[rows.length - 1]?.weekOfAge ?? 1;
  const [selectedWeek, setSelectedWeek] = useState<number>(currentWeek);

  const selected = data.find((d) => d.week === selectedWeek) ?? null;
  const previous = data.find((d) => d.week === selectedWeek - 1) ?? null;
  const next = data.find((d) => d.week === selectedWeek + 1) ?? null;
  const selectedLabel = selected?.weekLabel;

  function handleChartClick(state: { activeTooltipIndex?: number | string | null } | null) {
    const raw = state?.activeTooltipIndex;
    const index = typeof raw === "string" ? Number(raw) : raw;
    if (index != null && Number.isInteger(index) && data[index]) setSelectedWeek(data[index].week);
  }

  return (
    <section
      aria-label="Intake by age"
      className="w-full rounded-lg bg-card p-5 text-card-foreground shadow-md ring-1 ring-black/5"
    >
      <p className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-card-foreground/55">By age</p>
      <p className="mt-1 text-sm text-card-foreground/60">
        How much {babyName} needs each day as he grows, next to what he&apos;s actually been getting. Tap a week to
        compare.
      </p>

      {/* Week filter — tap any week to focus it; the colored dot pre-reads its tone. */}
      <div className="mt-4 -mx-1 flex gap-1.5 overflow-x-auto pb-1">
        {data.map((d) => {
          const isSelected = d.week === selectedWeek;
          return (
            <button
              key={d.week}
              type="button"
              onClick={() => setSelectedWeek(d.week)}
              aria-pressed={isSelected}
              className={
                isSelected
                  ? "flex shrink-0 items-center gap-1.5 rounded-full bg-card-foreground px-3 py-1 text-xs text-card"
                  : "flex shrink-0 items-center gap-1.5 rounded-full border border-card-foreground/15 px-3 py-1 text-xs text-card-foreground/60 transition-colors hover:text-card-foreground"
              }
            >
              <span>W{d.week}</span>
              {d.tone !== "none" ? (
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: STATUS_COLOR[d.tone] }}
                  aria-hidden
                />
              ) : null}
              {d.isCurrent ? <span className="text-[9px] uppercase opacity-70">now</span> : null}
            </button>
          );
        })}
      </div>

      <div className="mt-3 h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }} onClick={handleChartClick}>
            <XAxis
              dataKey="weekLabel"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: "var(--card-foreground)" }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={40}
              tick={{ fontSize: 11, fill: "var(--card-foreground)" }}
            />
            <Tooltip content={<WeekTooltip />} cursor={{ stroke: "var(--card-foreground)", strokeOpacity: 0.15 }} />
            {selectedLabel ? (
              <ReferenceLine x={selectedLabel} stroke="var(--card-foreground)" strokeOpacity={0.18} />
            ) : null}
            {/* Two stacked areas draw the per-week "needs" band: an invisible base
                up to `low`, then the tinted height from `low` to `high`. */}
            <Area dataKey="low" stackId="band" stroke="none" fill="transparent" isAnimationActive={false} />
            <Area
              dataKey="bandHeight"
              stackId="band"
              stroke="none"
              fill="var(--chart-2)"
              fillOpacity={0.16}
              isAnimationActive={false}
            />
            <Line
              dataKey="avg"
              type="monotone"
              connectNulls={false}
              stroke="var(--card-foreground)"
              strokeOpacity={0.35}
              strokeWidth={2}
              isAnimationActive={false}
              dot={(props: DotProps) => <AvgDot {...props} selectedWeek={selectedWeek} />}
              activeDot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Selected-week readout: needs vs. got, plus the week before and after. */}
      {selected ? (
        <div className="mt-3 rounded-md bg-card-foreground/5 px-3 py-3">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-medium text-card-foreground">Week {selected.week}</span>
            {selected.isCurrent ? (
              <span className="rounded-full bg-card-foreground/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-card-foreground/70">
                now
              </span>
            ) : null}
            {selected.isUpcoming ? (
              <span className="rounded-full bg-card-foreground/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-card-foreground/50">
                next
              </span>
            ) : null}
          </div>

          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm tabular-nums">
            <span className="text-card-foreground/55">
              Needs{" "}
              <span className="text-card-foreground/80">
                {fmtOz(selected.low)}–{fmtOz(selected.high)} oz
              </span>
              <span className="ml-1 text-card-foreground/40">
                ({fmtMl(selected.low)}–{fmtMl(selected.high)} ml)
              </span>
            </span>
            <span className="text-card-foreground/55">
              Got{" "}
              {selected.avg === null ? (
                <span className="text-card-foreground/40">—</span>
              ) : (
                <>
                  <span className="text-card-foreground/80">avg {fmtOz(selected.avg)} oz</span>
                  <span className="ml-1 text-card-foreground/40">({fmtMl(selected.avg)} ml)</span>
                </>
              )}
            </span>
          </div>

          {selected.tone !== "none" ? (
            <p className={selected.tone === "under" ? "mt-1.5 text-xs text-amber-700" : "mt-1.5 text-xs text-card-foreground/55"}>
              {TONE_LABEL[selected.tone]}
            </p>
          ) : (
            <p className="mt-1.5 text-xs text-card-foreground/45">{TONE_LABEL.none}</p>
          )}

          {(previous?.avg != null || next != null) ? (
            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 border-t border-card-foreground/10 pt-2 text-xs text-card-foreground/55">
              {previous?.avg != null ? (
                <span>
                  Last week: avg <span className="text-card-foreground/75">{fmtOz(previous.avg)} oz</span>
                </span>
              ) : null}
              {next ? (
                <span>
                  Next week he&apos;ll need{" "}
                  <span className="text-card-foreground/75">
                    {fmtOz(next.low)}–{fmtOz(next.high)} oz
                  </span>
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <p className="mt-4 border-t border-card-foreground/10 pt-3 text-xs text-card-foreground/55">
        General guidance only (~2–2½ oz per pound of body weight a day), based on his birth weight — not medical advice.
        Breast feeds use your own conservative estimate, so his real intake is likely a bit higher than shown. Call your
        pediatrician with any concerns.
      </p>
    </section>
  );
}
