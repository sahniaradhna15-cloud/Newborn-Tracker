"use client";

/**
 * Growth chart (Phase 3 Task 3) — Anay's logged weights overlaid on the WHO
 * weight-for-age reference percentile curves (P3/P15/P50/P85/P97).
 *
 * The reference curves come from the inverse-LMS `percentileBands` and the
 * header percentile from `weightPercentile` (lib/who-growth.ts — pure, safe
 * to run client-side). Weights are stored in oz; the chart works in kg with a
 * kg/lb display toggle. Below the 1st / above the 99th render as words rather
 * than a misleading precise number.
 */

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Legend,
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

function percentileLabel(pct: number): string {
  if (pct < 1) return "below the 1st";
  if (pct > 99) return "above the 99th";
  const n = Math.round(pct);
  const suffix =
    n % 10 === 1 && n !== 11
      ? "st"
      : n % 10 === 2 && n !== 12
        ? "nd"
        : n % 10 === 3 && n !== 13
          ? "rd"
          : "th";
  return `${n}${suffix}`;
}

const REFERENCE_AGES = Array.from({ length: 49 }, (_, i) => i * 0.5); // 0–24mo

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

  const toUnit = (kg: number) =>
    Math.round((unit === "kg" ? kg : kg * KG_TO_LB) * 100) / 100;

  const referenceData = useMemo(() => {
    const p3 = percentileBands(REFERENCE_AGES, 3);
    const p15 = percentileBands(REFERENCE_AGES, 15);
    const p50 = percentileBands(REFERENCE_AGES, 50);
    const p85 = percentileBands(REFERENCE_AGES, 85);
    const p97 = percentileBands(REFERENCE_AGES, 97);
    return REFERENCE_AGES.map((age, i) => ({
      age,
      p3: toUnit(p3[i].weightKg),
      p15: toUnit(p15[i].weightKg),
      p50: toUnit(p50[i].weightKg),
      p85: toUnit(p85[i].weightKg),
      p97: toUnit(p97[i].weightKg),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit]);

  const anayData = useMemo(
    () =>
      [...weights]
        .sort(
          (a, b) =>
            new Date(a.occurredAt).getTime() -
            new Date(b.occurredAt).getTime(),
        )
        .map((w) => ({
          age: Math.round(ageMonthsAt(w.occurredAt, birthDate) * 100) / 100,
          weight: toUnit(w.weightOz * OZ_TO_KG),
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [weights, birthDate, unit],
  );

  const latest = useMemo(() => {
    if (weights.length === 0) return null;
    const newest = [...weights].sort(
      (a, b) =>
        new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
    )[0];
    const ageMonths = ageMonthsAt(newest.occurredAt, birthDate);
    const pct = weightPercentile(ageMonths, newest.weightOz * OZ_TO_KG);
    return pct === null ? null : percentileLabel(pct);
  }, [weights, birthDate]);

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-stone-600 dark:text-stone-400">
          {latest
            ? `${babyName} is currently at the ${latest} percentile for weight.`
            : `Log ${babyName}'s first weight below to see where they land on the WHO curves.`}
        </p>
        <div className="flex shrink-0 overflow-hidden rounded-lg border border-stone-200 text-xs dark:border-stone-800">
          {(["lb", "kg"] as const).map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => setUnit(u)}
              className={
                unit === u
                  ? "bg-stone-900 px-3 py-1.5 text-white dark:bg-stone-100 dark:text-stone-900"
                  : "px-3 py-1.5 text-stone-600 dark:text-stone-400"
              }
            >
              {u}
            </button>
          ))}
        </div>
      </div>

      <div className="h-[360px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={referenceData}
            margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
            <XAxis
              dataKey="age"
              type="number"
              domain={[0, 24]}
              ticks={[0, 3, 6, 9, 12, 15, 18, 21, 24]}
              tickLine={false}
              label={{ value: "Age (months)", position: "insideBottom", offset: -4 }}
              fontSize={12}
            />
            <YAxis
              tickLine={false}
              width={44}
              label={{ value: unit, angle: -90, position: "insideLeft" }}
              fontSize={12}
            />
            <Tooltip
              formatter={(value) => `${value} ${unit}`}
              labelFormatter={(label) => `${Number(label)} mo`}
            />
            <Legend />
            {(
              [
                ["p3", "P3"],
                ["p15", "P15"],
                ["p50", "P50"],
                ["p85", "P85"],
                ["p97", "P97"],
              ] as const
            ).map(([key, name]) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                name={name}
                stroke="#a8a29e"
                strokeWidth={key === "p50" ? 1.5 : 1}
                strokeDasharray={key === "p50" ? undefined : "4 3"}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
            ))}
            <Scatter
              data={anayData}
              dataKey="weight"
              name={babyName}
              line={{ stroke: "#0A3824", strokeWidth: 2 }}
              fill="#0A3824"
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <p className="text-xs text-stone-500 dark:text-stone-500">
        Reference curves: WHO Child Growth Standards, weight-for-age, boys
        0–24 months. Not medical advice. Call your pediatrician if you&apos;re
        worried.
      </p>
    </div>
  );
}
