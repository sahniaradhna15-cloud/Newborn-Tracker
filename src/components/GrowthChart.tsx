"use client";

/**
 * GrowthChart — Anay's weight on the WHO weight-for-age curves, presented for
 * a tired non-analytical parent rather than a clinician. A bold "latest weight
 * + plain-language percentile" header carries the headline; the chart below
 * uses two shaded reference bands (the wider WHO range and the narrower
 * typical band) + one soft median line, instead of the v1 spider-web of five
 * dashed percentile lines. Bands answer the actual question — "is he inside
 * the normal region?" — at a glance, no chart-reading needed.
 *
 * Anay's own curve is drawn on top with the most recent reading highlighted
 * by a larger dot and an amber halo so the eye lands there immediately.
 *
 * Tokens follow the Fresh Harvest palette (CLAUDE.md globals.css): cream card
 * surface, deep-green ink, amber-coral accent, soft brand tints for the
 * bands. Tone §11.3: calm, never red; out-of-band percentiles render as "your
 * pediatrician will track this with you", not "warning".
 *
 * Pure client component; the WHO LMS math from `lib/who-growth.ts` runs
 * in-process — no network call to draw the chart.
 */

import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { percentileBands, weightPercentile } from "@/lib/who-growth";

const OZ_TO_KG = 0.0283495231;
const KG_TO_LB = 2.2046226218;
const AVG_DAYS_PER_MONTH = 30.4375;

export type WeightPoint = {
  /** ISO timestamp of the reading. */
  occurredAt: string;
  weightOz: number;
};

type Unit = "kg" | "lb";

function ageMonthsAt(occurredAtIso: string, birthDateIso: string): number {
  const ms = new Date(occurredAtIso).getTime() - new Date(birthDateIso).getTime();
  return ms / (AVG_DAYS_PER_MONTH * 24 * 60 * 60 * 1000);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function percentileOrdinal(n: number): string {
  const rounded = Math.round(n);
  const lastTwo = rounded % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${rounded}th`;
  const last = rounded % 10;
  if (last === 1) return `${rounded}st`;
  if (last === 2) return `${rounded}nd`;
  if (last === 3) return `${rounded}rd`;
  return `${rounded}th`;
}

/**
 * The pill label for the current percentile — kept calm and non-clinical
 * (CLAUDE.md §11.3 word-ban). Out-of-LMS values fall back to gentler wording
 * that nudges toward the pediatrician without sounding alarmed.
 */
function percentilePillLabel(pct: number | null): string | null {
  if (pct === null) return null;
  if (pct < 1) return "Below the 1st percentile";
  if (pct > 99) return "Above the 99th percentile";
  return `Around the ${percentileOrdinal(pct)} percentile`;
}

/**
 * One-sentence plain-language reading of the percentile — written for a
 * non-analytical parent. Never alarmist, never the words banned by
 * CLAUDE.md §11.3.
 */
function friendlyPercentileSentence(pct: number | null, babyName: string): string {
  if (pct === null) {
    return `Log ${babyName}'s first weight to see how he's tracking.`;
  }
  if (pct < 1) return "Below the typical WHO band — your pediatrician will track this with you.";
  if (pct > 99) return "Above the typical WHO band — your pediatrician will track this with you.";
  if (pct < 10) return "On the slimmer side of typical — well inside the normal range.";
  if (pct < 25) return "A bit smaller than most newborns — comfortably typical.";
  if (pct <= 75) return "Right where most newborns are at this age.";
  if (pct < 90) return "A bit bigger than most newborns — comfortably typical.";
  return "On the larger side of typical — well inside the normal range.";
}

// 0–24 months on a half-month grid: dense enough for smooth bands.
const REFERENCE_AGES = Array.from({ length: 49 }, (_, i) => i * 0.5);

type AnayPoint = { age: number; weight: number; occurredAt: string; isLatest: boolean };
type ReferenceRow = {
  age: number;
  outer: [number, number];
  inner: [number, number];
  median: number;
};

export function GrowthChart({
  babyName,
  birthDate,
  weights,
}: {
  babyName: string;
  birthDate: string;
  weights: WeightPoint[];
}) {
  const [unit, setUnit] = useState<Unit>("lb");

  const toUnit = (kg: number) => round2(unit === "kg" ? kg : kg * KG_TO_LB);

  const sortedNewestFirst = useMemo(
    () =>
      [...weights].sort(
        (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
      ),
    [weights],
  );

  const latestRaw = sortedNewestFirst[0] ?? null;
  const previousRaw = sortedNewestFirst[1] ?? null;
  const latestAgeMonths = latestRaw ? ageMonthsAt(latestRaw.occurredAt, birthDate) : 0;

  // Adaptive X domain: a 1-month-old does not need to see 24 months. Zoom to
  // a window that covers the baby's life so far + a little headroom, clamped
  // to the WHO data range (0–24mo).
  const xMax = Math.min(24, Math.max(6, Math.ceil(latestAgeMonths + 3)));
  const xTickEvery = xMax <= 6 ? 1 : xMax <= 12 ? 2 : 3;
  const xTicks = useMemo(() => {
    const ticks: number[] = [];
    for (let m = 0; m <= xMax; m += xTickEvery) ticks.push(m);
    if (ticks[ticks.length - 1] !== xMax) ticks.push(xMax);
    return ticks;
  }, [xMax, xTickEvery]);

  // Each row carries the two range tuples + the median, ready for Recharts'
  // Area to render between [low, high] (supported since Recharts 2.x).
  const referenceData = useMemo<ReferenceRow[]>(() => {
    const ages = REFERENCE_AGES.filter((a) => a <= xMax);
    const p3 = percentileBands(ages, 3);
    const p15 = percentileBands(ages, 15);
    const p50 = percentileBands(ages, 50);
    const p85 = percentileBands(ages, 85);
    const p97 = percentileBands(ages, 97);
    return ages.map((age, i) => ({
      age,
      outer: [toUnit(p3[i].weightKg), toUnit(p97[i].weightKg)] as [number, number],
      inner: [toUnit(p15[i].weightKg), toUnit(p85[i].weightKg)] as [number, number],
      median: toUnit(p50[i].weightKg),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit, xMax]);

  // Oldest→newest so the connecting line draws in order; tag the last point
  // so the custom shape can render it bigger.
  const anayData: AnayPoint[] = useMemo(() => {
    if (sortedNewestFirst.length === 0) return [];
    const oldestFirst = [...sortedNewestFirst].reverse();
    const latestId = sortedNewestFirst[0].occurredAt;
    return oldestFirst.map((w) => ({
      age: round2(ageMonthsAt(w.occurredAt, birthDate)),
      weight: toUnit(w.weightOz * OZ_TO_KG),
      occurredAt: w.occurredAt,
      isLatest: w.occurredAt === latestId,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedNewestFirst, birthDate, unit]);

  const hero = useMemo(() => {
    if (!latestRaw) return null;
    const ageMonths = ageMonthsAt(latestRaw.occurredAt, birthDate);
    const ageDays = Math.max(0, Math.round(ageMonths * AVG_DAYS_PER_MONTH));
    const pct = weightPercentile(ageMonths, latestRaw.weightOz * OZ_TO_KG);
    const delta = previousRaw
      ? round2(toUnit(latestRaw.weightOz * OZ_TO_KG) - toUnit(previousRaw.weightOz * OZ_TO_KG))
      : null;
    return {
      weight: toUnit(latestRaw.weightOz * OZ_TO_KG),
      ageDays,
      percentile: pct,
      pill: percentilePillLabel(pct),
      sentence: friendlyPercentileSentence(pct, babyName),
      delta,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestRaw, previousRaw, birthDate, babyName, unit]);

  return (
    <section
      aria-label={`${babyName}'s growth`}
      className="w-full rounded-lg bg-card p-6 text-card-foreground shadow-md ring-1 ring-black/5"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-xs font-medium uppercase tracking-[0.15em] text-card-foreground/55">
            {hero ? "Latest weight" : "First weigh-in"}
          </p>
          {hero ? (
            <>
              <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="font-heading text-4xl leading-none tabular-nums text-card-foreground">
                  {hero.weight}
                </span>
                <span className="text-base text-card-foreground/55">{unit}</span>
                {hero.delta !== null && hero.delta !== 0 ? (
                  <span className="text-xs text-card-foreground/55 tabular-nums">
                    {hero.delta > 0 ? "+" : "−"}
                    {Math.abs(hero.delta).toFixed(2)} {unit} since last
                  </span>
                ) : null}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {hero.pill ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-card-foreground/[0.07] px-2.5 py-1 text-xs font-medium text-card-foreground/75">
                    <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
                    {hero.pill}
                  </span>
                ) : null}
                <span className="text-xs text-card-foreground/55">{hero.ageDays} days old</span>
              </div>
              <p className="mt-3 max-w-md text-sm text-card-foreground/70">{hero.sentence}</p>
            </>
          ) : (
            <p className="mt-2 max-w-md text-sm text-card-foreground/70">
              Log {babyName}&apos;s first weight to see how he&apos;s tracking on the WHO curves.
            </p>
          )}
        </div>
        <div
          className="flex shrink-0 overflow-hidden rounded-full bg-card-foreground/[0.06] p-0.5 text-xs"
          role="group"
          aria-label="Weight unit"
        >
          {(["lb", "kg"] as const).map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => setUnit(u)}
              aria-pressed={unit === u}
              className={
                unit === u
                  ? "rounded-full bg-card-foreground px-3 py-1 font-medium text-card"
                  : "rounded-full px-3 py-1 text-card-foreground/65 transition-colors hover:text-card-foreground"
              }
            >
              {u}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 h-[340px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={referenceData} margin={{ top: 8, right: 12, bottom: 12, left: 0 }}>
            <defs>
              <linearGradient id="growthOuterBand" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--card-foreground)" stopOpacity={0.1} />
                <stop offset="100%" stopColor="var(--card-foreground)" stopOpacity={0.04} />
              </linearGradient>
              <linearGradient id="growthInnerBand" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--card-foreground)" stopOpacity={0.18} />
                <stop offset="100%" stopColor="var(--card-foreground)" stopOpacity={0.1} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--card-foreground)" strokeOpacity={0.08} vertical={false} />
            <XAxis
              dataKey="age"
              type="number"
              domain={[0, xMax]}
              ticks={xTicks}
              tickLine={false}
              axisLine={{ stroke: "var(--card-foreground)", strokeOpacity: 0.15 }}
              tick={{ fill: "var(--card-foreground)", fillOpacity: 0.55, fontSize: 11 }}
              tickFormatter={(v: number) => `${v}m`}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={36}
              tick={{ fill: "var(--card-foreground)", fillOpacity: 0.55, fontSize: 11 }}
              tickFormatter={(v: number) => `${v}`}
              domain={["auto", "auto"]}
            />
            <Tooltip
              content={<GrowthTooltip unit={unit} />}
              cursor={{ stroke: "var(--card-foreground)", strokeOpacity: 0.15 }}
            />

            <Area
              type="monotone"
              dataKey="outer"
              stroke="none"
              fill="url(#growthOuterBand)"
              isAnimationActive={false}
              activeDot={false}
            />
            <Area
              type="monotone"
              dataKey="inner"
              stroke="none"
              fill="url(#growthInnerBand)"
              isAnimationActive={false}
              activeDot={false}
            />
            <Line
              type="monotone"
              dataKey="median"
              stroke="var(--primary)"
              strokeWidth={1.5}
              strokeDasharray="5 4"
              strokeOpacity={0.75}
              dot={false}
              activeDot={false}
              isAnimationActive={false}
            />
            <Scatter
              data={anayData}
              dataKey="weight"
              line={{ stroke: "var(--card-foreground)", strokeWidth: 2.5 }}
              shape={<AnayDot />}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-card-foreground/65">
        <LegendItem swatch={<span className="block size-2.5 rounded-full bg-card-foreground" />} label={babyName} />
        <LegendItem
          swatch={<span className="block h-0.5 w-4 rounded-full bg-primary opacity-80" />}
          label="Average baby (P50)"
        />
        <LegendItem
          swatch={<span className="block h-2 w-4 rounded-sm bg-card-foreground/20" />}
          label="Typical (15th–85th)"
        />
        <LegendItem
          swatch={<span className="block h-2 w-4 rounded-sm bg-card-foreground/[0.08]" />}
          label="WHO range (3rd–97th)"
        />
      </div>

      <PercentileExplainer />

      <p className="mt-4 border-t border-card-foreground/10 pt-3 text-xs text-card-foreground/45">
        WHO Child Growth Standards, weight-for-age, boys 0–24 months. Not medical advice. Call your pediatrician if
        you&apos;re worried.
      </p>
    </section>
  );
}

/**
 * Collapsible plain-language explainer for what percentile numbers actually
 * mean — answers the "is my baby OK?" question without clinical jargon.
 * Default-collapsed so it doesn't clutter return visits; the disclosure
 * triangle rotates on open for affordance. Wording sticks to CLAUDE.md §11.3:
 * calm, factual, never the banned words.
 */
function PercentileExplainer() {
  return (
    <details className="group mt-4 rounded-md bg-card-foreground/[0.04] px-4 py-3 text-sm text-card-foreground/75 open:bg-card-foreground/[0.06]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-medium text-card-foreground/85 [&::-webkit-details-marker]:hidden">
        <span>What do these percentiles mean?</span>
        <svg
          viewBox="0 0 12 12"
          className="size-3 shrink-0 text-card-foreground/55 transition-transform duration-200 group-open:rotate-180"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 4.5l3 3 3-3" />
        </svg>
      </summary>
      <div className="mt-3 space-y-3 leading-relaxed">
        <p>
          A percentile compares your baby to 100 other babies the same age. If yours is at the 50th, half weigh more
          and half weigh less — that&apos;s just the average. A few examples to make it concrete:
        </p>
        <ul className="space-y-1.5 text-card-foreground/70">
          <li>
            <span className="font-medium text-card-foreground/90">3rd percentile</span> — 3 out of every 100 babies
            weigh less than yours; 97 weigh more. Small but normal — about 1 in every 33 healthy babies sits right
            here.
          </li>
          <li>
            <span className="font-medium text-card-foreground/90">50th percentile</span> — right in the middle. The
            &ldquo;Average baby&rdquo; dashed line on the chart.
          </li>
          <li>
            <span className="font-medium text-card-foreground/90">97th percentile</span> — only 3 out of every 100
            babies weigh more. Big but normal.
          </li>
        </ul>
        <p>
          <span className="font-medium text-card-foreground/90">Is it OK?</span> Anywhere inside the wide shaded WHO
          range (3rd to 97th) is what doctors consider the normal range — that&apos;s about 94 out of every 100
          healthy babies. The narrower band (15th to 85th) is where most newborns sit.
        </p>
        <p>
          Pediatricians care more about the <span className="font-medium text-card-foreground/90">trend</span> than
          the exact number — they look for steady, predictable growth along roughly the same band over time. A
          reading that jumps across two bands quickly, or sits outside the WHO range, is when they&apos;ll want a
          closer look. Either way, you&apos;re not meant to read this chart alone — bring it to your next visit.
        </p>
      </div>
    </details>
  );
}

function LegendItem({ swatch, label }: { swatch: ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      {swatch}
      {label}
    </span>
  );
}

/**
 * Custom Scatter shape that draws a small filled deep-green dot for every
 * reading, except the most recent — which gets a larger dot wrapped in an
 * amber halo so the parent's eye lands on it instantly.
 */
function AnayDot(props: { cx?: number; cy?: number; payload?: AnayPoint }) {
  const { cx, cy, payload } = props;
  if (cx === undefined || cy === undefined || !payload) return null;
  if (payload.isLatest) {
    return (
      <g>
        <circle cx={cx} cy={cy} r={10} fill="var(--primary)" fillOpacity={0.22} />
        <circle cx={cx} cy={cy} r={5.5} fill="var(--card-foreground)" stroke="var(--card)" strokeWidth={1.5} />
      </g>
    );
  }
  return <circle cx={cx} cy={cy} r={3.5} fill="var(--card-foreground)" />;
}

function GrowthTooltip({
  active,
  label,
  payload,
  unit,
}: {
  active?: boolean;
  label?: string | number;
  payload?: { payload: Record<string, unknown> }[];
  unit: Unit;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as
    | { outer?: [number, number]; inner?: [number, number]; median?: number }
    | undefined;
  if (!row || !row.outer || !row.inner || row.median === undefined) return null;
  const ageMonths = typeof label === "number" ? label : Number(label);
  return (
    <div className="rounded-lg border border-card-foreground/10 bg-card px-3 py-2 text-xs text-card-foreground shadow-md">
      <p className="font-medium">{ageMonths.toFixed(1)} months</p>
      <p className="mt-1">
        Average · <span className="tabular-nums">{row.median}</span> {unit}
      </p>
      <p className="mt-0.5 text-card-foreground/65">
        Typical{" "}
        <span className="tabular-nums">
          {row.inner[0]}–{row.inner[1]}
        </span>{" "}
        {unit}
      </p>
      <p className="mt-0.5 text-card-foreground/55">
        WHO range{" "}
        <span className="tabular-nums">
          {row.outer[0]}–{row.outer[1]}
        </span>{" "}
        {unit}
      </p>
    </div>
  );
}
