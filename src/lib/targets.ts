/**
 * Daily intake target band + nursing-ounces estimator.
 *
 * Canonical spec: PLAN.md §"Daily Target & Nursing-Minutes Estimation".
 * This is product math — every TodayCard number and every intake insight
 * depends on it, so it is unit-tested to the published checkpoints.
 *
 * `ageDays` throughout is the **day-of-life** as returned by
 * `dayNumberSinceBirth` (birth day = 1), not 0-based elapsed days.
 *
 * NOTE on file ownership (parallel work): Phase 1 Task 3 (`record-event.ts`)
 * must NOT also create this file — it uses an inline `duration_min * 0.15`
 * stub and is swapped to call `estimateNursingOz` at integration.
 */

const OUNCES_PER_POUND = 16;

/** PLAN.md §"Estimating ounces from direct nursing". */
const NURSING_RATE_UNDER_7_DAYS = 0.1;
const NURSING_RATE_7_TO_30_DAYS = 0.15;
const NURSING_RATE_30_TO_60_DAYS = 0.2;
const NURSING_RATE_60_DAYS_PLUS = 0.25;

/** Days 1–6 ramp: 0.5–1.0 oz/feed × 8 feeds/day ⇒ 4–8 oz/day per day-number. */
const RAMP_LAST_DAY = 6;
const RAMP_LOW_OZ_PER_DAY_NUMBER = 0.5 * 8;
const RAMP_HIGH_OZ_PER_DAY_NUMBER = 1.0 * 8;

/** Day 7+ newborn rule: 2.0–2.5 oz per lb of body weight per day, hard-capped. */
const WEIGHT_RULE_LOW_OZ_PER_LB = 2.0;
const WEIGHT_RULE_HIGH_OZ_PER_LB = 2.5;
const DAILY_INTAKE_CAP_OZ = 32;

/** Null-weight estimate: regain birth weight by ~day 14, then ~1 oz/day (≈7 oz/wk). */
const BIRTH_WEIGHT_REGAINED_BY_DAY = 14;
const WEIGHT_GAIN_OZ_PER_DAY_AFTER_REGAIN = 1;

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Default ounces-per-minute for direct nursing, by day-of-life (PLAN.md §312). */
export function nursingRateOzPerMin(ageDays: number): number {
  if (ageDays < 7) {
    return NURSING_RATE_UNDER_7_DAYS;
  }
  if (ageDays < 30) {
    return NURSING_RATE_7_TO_30_DAYS;
  }
  if (ageDays < 60) {
    return NURSING_RATE_30_TO_60_DAYS;
  }
  return NURSING_RATE_60_DAYS_PLUS;
}

/** Estimated ounces from a nursing session; persisted as `feed_events.estimated_oz`. */
export function estimateNursingOz(durationMin: number, ageDays: number): number {
  return roundToTwoDecimals(durationMin * nursingRateOzPerMin(ageDays));
}

/** Body weight (oz) to use for the newborn rule, estimating it when unmeasured. */
function resolveWeightOz(ageDays: number, currentWeightOz: number | null, birthWeightOz: number): number {
  if (currentWeightOz !== null) {
    return currentWeightOz;
  }
  if (ageDays <= BIRTH_WEIGHT_REGAINED_BY_DAY) {
    return birthWeightOz;
  }
  return birthWeightOz + (ageDays - BIRTH_WEIGHT_REGAINED_BY_DAY) * WEIGHT_GAIN_OZ_PER_DAY_AFTER_REGAIN;
}

/**
 * Informational daily intake target *range* (never a single "should" number).
 *
 * - Days 1–6: a ramp (`day# × 4` … `day# × 8` oz/day) that "saturates near
 *   the newborn rule" — implemented as the min of the ramp and the weight
 *   rule so a tiny newborn's band is never overstated (Day 1 ⇒ the ramp is
 *   the binding constraint, matching the plan's "saturates at the ramp").
 * - Day 7+: 2.0–2.5 oz per lb of body weight, high capped at 32 oz/day.
 *
 * @param ageDays         Day-of-life (birth day = 1).
 * @param currentWeightOz Latest measured weight in oz, or null to estimate.
 * @param birthWeightOz   Birth weight in oz (used for the null-weight estimate).
 * @returns `{ lowOz, highOz }` rounded to 0.1 oz, both ≤ 32, low ≤ high.
 */
export function dailyTargetRange(input: {
  ageDays: number;
  currentWeightOz: number | null;
  birthWeightOz: number;
}): { lowOz: number; highOz: number } {
  const { ageDays, currentWeightOz, birthWeightOz } = input;

  const weightLb = resolveWeightOz(ageDays, currentWeightOz, birthWeightOz) / OUNCES_PER_POUND;
  const weightRuleLow = weightLb * WEIGHT_RULE_LOW_OZ_PER_LB;
  const weightRuleHigh = Math.min(weightLb * WEIGHT_RULE_HIGH_OZ_PER_LB, DAILY_INTAKE_CAP_OZ);

  let lowOz: number;
  let highOz: number;

  if (ageDays <= RAMP_LAST_DAY) {
    lowOz = Math.min(ageDays * RAMP_LOW_OZ_PER_DAY_NUMBER, weightRuleLow);
    highOz = Math.min(ageDays * RAMP_HIGH_OZ_PER_DAY_NUMBER, weightRuleHigh);
  } else {
    lowOz = weightRuleLow;
    highOz = weightRuleHigh;
  }

  lowOz = Math.min(lowOz, DAILY_INTAKE_CAP_OZ);
  highOz = Math.min(highOz, DAILY_INTAKE_CAP_OZ);

  return { lowOz: roundToOneDecimal(lowOz), highOz: roundToOneDecimal(Math.max(lowOz, highOz)) };
}
