/**
 * WHO/AAP-aligned, *informational* dashboard signals.
 *
 * Pure function, recomputed every render — no DB table, no state. Tone is
 * non-negotiable (CLAUDE.md §11.3): never alarmist, never the words
 * "alert/warning/error/wrong/problem/bad/concerning", never a popup. The
 * "Not medical advice…" line is appended by `InsightBanner`, not here.
 *
 * Time-of-day gates exist to avoid mid-day false alarms: a low-intake
 * signal at 11am is just "the day isn't over". Thresholds come from
 * WHO/AAP newborn norms; the *language* stays calm regardless.
 *
 * NOTE: the plan's literal formula_share copy says "not a problem"; the
 * §11.3 word-ban (convention file wins per §15) forbids "problem", so the
 * wording is preserved in spirit without the banned term. `insights.test.ts`
 * asserts no banned word ever reaches a user.
 */

import { formatInTimeZone } from "date-fns-tz";

export type InsightKind = "low_intake" | "low_pee" | "formula_share" | "long_gap" | "long_diaper_gap";

export type Insight = { kind: InsightKind; severity: "info"; text: string };

/** Mirrors the `/api/summary` JSON exactly so it can be passed straight in. */
export type DaySummary = {
  feeds: {
    total_oz: number;
    nursing_oz: number;
    pumped_oz: number;
    formula_oz: number;
    wasted_oz: number;
    count: number;
    last_at: string | null;
  };
  diapers: { pee_count: number; poop_count: number; last_at: string | null };
  target: { low_oz: number; high_oz: number; age_days: number; weight_oz: number | null };
  last_feed_minutes_ago: number | null;
};

export type BabyContext = { timeZone: string };

const LOW_INTAKE_SUPPRESS_BEFORE_HOUR = 18;
const LOW_PEE_SUPPRESS_BEFORE_HOUR = 20;
const FORMULA_SHARE_THRESHOLD = 0.66;
const LONG_GAP_FEED_MINUTES = 240;
const LONG_GAP_DIAPER_MINUTES = 360;
const DAYTIME_START_HOUR = 8;
const DAYTIME_END_HOUR = 22;
const MAX_EXPECTED_PEE_FLOOR = 6;
const PEE_RAMP_LAST_DAY = 5;

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function localHour(now: Date, timeZone: string): number {
  return Number(formatInTimeZone(now, timeZone, "H"));
}

function isDaytime(hour: number): boolean {
  return hour >= DAYTIME_START_HOUR && hour < DAYTIME_END_HOUR;
}

/** PLAN.md: `day_num` wet diapers for days 1–5, then 6+ from day 6 on. */
function expectedPeeFloor(ageDays: number): number {
  return ageDays <= PEE_RAMP_LAST_DAY ? Math.max(ageDays, 0) : MAX_EXPECTED_PEE_FLOOR;
}

function minutesSince(isoTimestamp: string | null, now: Date): number | null {
  if (isoTimestamp === null) {
    return null;
  }
  const then = Date.parse(isoTimestamp);
  if (Number.isNaN(then)) {
    return null;
  }
  return (now.getTime() - then) / 60_000;
}

/**
 * Zero-or-more informational signals for the dashboard, in stable order.
 * Empty array ⇒ render nothing (never a preachy "all good!").
 *
 * @param summary  The `/api/summary` rollup for the active baby's logical day.
 * @param baby     Carries the household timezone for the time-of-day gates.
 * @param now      Evaluation instant (UTC).
 */
export function computeInsights(summary: DaySummary, baby: BabyContext, now: Date): Insight[] {
  const insights: Insight[] = [];
  const hour = localHour(now, baby.timeZone);
  const { feeds, diapers, target, last_feed_minutes_ago } = summary;

  // 1. Low intake — only once the day is old enough to mean something.
  if (hour >= LOW_INTAKE_SUPPRESS_BEFORE_HOUR && feeds.total_oz < target.low_oz) {
    const toGo = roundToOneDecimal(target.low_oz - feeds.total_oz);
    insights.push({
      kind: "low_intake",
      severity: "info",
      text: `Today's running below the ${target.low_oz}–${target.high_oz} oz range. About ${toGo} oz to go.`,
    });
  }

  // 2. Low pee count — gated even later; mornings are naturally sparse.
  const peeFloor = expectedPeeFloor(target.age_days);
  if (hour >= LOW_PEE_SUPPRESS_BEFORE_HOUR && diapers.pee_count < peeFloor) {
    insights.push({
      kind: "low_pee",
      severity: "info",
      text: `${diapers.pee_count} wet diapers logged today so far. Healthy newborns usually have ${peeFloor}+ by end of day.`,
    });
  }

  // 3. High formula share — only when it's NOT an intentionally formula-only
  //    day (some breast/pumped milk also logged), so a formula family is
  //    never nagged.
  const breastOrPumpedOz = feeds.nursing_oz + feeds.pumped_oz;
  const totalFeedOz = breastOrPumpedOz + feeds.formula_oz;
  if (totalFeedOz > 0 && breastOrPumpedOz > 0 && feeds.formula_oz / totalFeedOz > FORMULA_SHARE_THRESHOLD) {
    const pct = Math.round((feeds.formula_oz / totalFeedOz) * 100);
    insights.push({
      kind: "formula_share",
      severity: "info",
      text: `${pct}% of today's feeds were formula. Just useful context — many families mix-feed.`,
    });
  }

  // 4. Long gap since last feed — daytime only (helps the just-woke caregiver).
  if (isDaytime(hour) && last_feed_minutes_ago !== null && last_feed_minutes_ago > LONG_GAP_FEED_MINUTES) {
    const hours = roundToOneDecimal(last_feed_minutes_ago / 60);
    insights.push({
      kind: "long_gap",
      severity: "info",
      text: `It's been about ${hours}h since the last logged feed.`,
    });
  }

  // 5. Long gap since last diaper — daytime only.
  const diaperMinutesAgo = minutesSince(diapers.last_at, now);
  if (isDaytime(hour) && diaperMinutesAgo !== null && diaperMinutesAgo > LONG_GAP_DIAPER_MINUTES) {
    const hours = roundToOneDecimal(diaperMinutesAgo / 60);
    insights.push({
      kind: "long_diaper_gap",
      severity: "info",
      text: `About ${hours}h since the last logged diaper.`,
    });
  }

  return insights;
}
