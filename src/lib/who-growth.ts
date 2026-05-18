/**
 * WHO Child Growth Standards — LMS reference data + percentile math.
 *
 * Source (publicly published, license: WHO permits reuse with attribution):
 *   Weight-for-age, boys, 0–24 months (expanded tables, by month):
 *   https://www.who.int/tools/child-growth-standards/standards/weight-for-age
 *
 * The LMS method models a skewed distribution with three age-varying
 * coefficients (L = Box-Cox power, M = median, S = coefficient of variation).
 * A measurement's z-score is recovered with:
 *
 *   Z = ((value / M)^L − 1) / (L · S)        when L ≠ 0
 *   Z = ln(value / M) / S                    when L = 0
 *
 * and the inverse (weight at a given z) is:
 *
 *   value = M · (1 + L · S · Z)^(1/L)        when L ≠ 0
 *   value = M · exp(S · Z)                    when L = 0
 *
 * Phase 1/MVP ships boys' weight-for-age only. Girls' weight, length-for-age,
 * and head-circumference are scaffolded (return null / throw) and surfaced
 * post-MVP once those measurements are captured.
 */

export type LmsRow = {
  /** Age in completed months (integer rows; fractional ages are interpolated). */
  ageMonths: number;
  /** Box-Cox power. */
  L: number;
  /** Median. */
  M: number;
  /** Coefficient of variation. */
  S: number;
};

export type Sex = "boy" | "girl";

/** Reference percentiles plotted by the growth chart. */
export type ReferencePercentile = 3 | 15 | 50 | 85 | 97;

/**
 * WHO weight-for-age, boys, 0–24 months (kg). One row per completed month.
 * Verbatim LMS coefficients from the WHO expanded tables linked above.
 */
export const WEIGHT_FOR_AGE_BOYS_0_24M: readonly LmsRow[] = [
  { ageMonths: 0, L: 0.3487, M: 3.3464, S: 0.14602 },
  { ageMonths: 1, L: 0.2297, M: 4.4709, S: 0.13395 },
  { ageMonths: 2, L: 0.197, M: 5.5675, S: 0.12385 },
  { ageMonths: 3, L: 0.1738, M: 6.3762, S: 0.11727 },
  { ageMonths: 4, L: 0.1553, M: 7.0023, S: 0.11316 },
  { ageMonths: 5, L: 0.1395, M: 7.5105, S: 0.1108 },
  { ageMonths: 6, L: 0.1257, M: 7.934, S: 0.10958 },
  { ageMonths: 7, L: 0.1134, M: 8.297, S: 0.10902 },
  { ageMonths: 8, L: 0.1021, M: 8.6151, S: 0.10882 },
  { ageMonths: 9, L: 0.0917, M: 8.9014, S: 0.10881 },
  { ageMonths: 10, L: 0.082, M: 9.1649, S: 0.10891 },
  { ageMonths: 11, L: 0.073, M: 9.4122, S: 0.10906 },
  { ageMonths: 12, L: 0.0644, M: 9.6479, S: 0.10925 },
  { ageMonths: 13, L: 0.0563, M: 9.8749, S: 0.10949 },
  { ageMonths: 14, L: 0.0487, M: 10.0953, S: 0.10976 },
  { ageMonths: 15, L: 0.0413, M: 10.3108, S: 0.11007 },
  { ageMonths: 16, L: 0.0343, M: 10.5228, S: 0.11041 },
  { ageMonths: 17, L: 0.0275, M: 10.7319, S: 0.11079 },
  { ageMonths: 18, L: 0.0211, M: 10.9385, S: 0.11119 },
  { ageMonths: 19, L: 0.0148, M: 11.143, S: 0.11164 },
  { ageMonths: 20, L: 0.0087, M: 11.3462, S: 0.11211 },
  { ageMonths: 21, L: 0.0029, M: 11.5486, S: 0.11261 },
  { ageMonths: 22, L: -0.0028, M: 11.7504, S: 0.11314 },
  { ageMonths: 23, L: -0.0083, M: 11.9514, S: 0.11369 },
  { ageMonths: 24, L: -0.0137, M: 12.1515, S: 0.11426 },
];

const MIN_AGE_MONTHS = WEIGHT_FOR_AGE_BOYS_0_24M[0].ageMonths;
const MAX_AGE_MONTHS = WEIGHT_FOR_AGE_BOYS_0_24M[WEIGHT_FOR_AGE_BOYS_0_24M.length - 1].ageMonths;

/**
 * Cumulative distribution function of the standard normal, via the
 * Abramowitz & Stegun 7.1.26 erf approximation (max abs error ≈ 1.5e-7 —
 * far tighter than the ±1 percentile precision the UI ever displays).
 */
function cumulativeStandardNormal(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

/**
 * Inverse CDF of the standard normal (Acklam's rational approximation,
 * relative error < 1.15e-9). Used to turn a target percentile into the
 * z-score that the inverse-LMS step needs.
 */
function inverseStandardNormal(probability: number): number {
  if (probability <= 0 || probability >= 1) {
    throw new RangeError(`inverseStandardNormal expects 0 < p < 1, received ${probability}`);
  }

  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];

  const lowBreakpoint = 0.02425;
  const highBreakpoint = 1 - lowBreakpoint;

  if (probability < lowBreakpoint) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }

  if (probability <= highBreakpoint) {
    const q = probability - 0.5;
    const r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  }

  const q = Math.sqrt(-2 * Math.log(1 - probability));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

/**
 * Linearly interpolate the LMS triple for a (possibly fractional) age.
 *
 * WHY clamp instead of throw: a newborn is ~0.6 months old and the dashboard
 * must never crash on an edge age. Out-of-range ages degrade to the nearest
 * boundary row rather than raising.
 */
function interpolateLmsForAge(ageMonths: number, table: readonly LmsRow[]): LmsRow {
  const clampedAge = Math.min(Math.max(ageMonths, MIN_AGE_MONTHS), MAX_AGE_MONTHS);

  const exactRow = table.find((row) => row.ageMonths === clampedAge);
  if (exactRow) {
    return exactRow;
  }

  const lower = [...table].reverse().find((row) => row.ageMonths < clampedAge);
  const upper = table.find((row) => row.ageMonths > clampedAge);
  if (!lower || !upper) {
    throw new Error(`No bracketing LMS rows for age ${ageMonths} (clamped ${clampedAge})`);
  }

  const fraction = (clampedAge - lower.ageMonths) / (upper.ageMonths - lower.ageMonths);
  return {
    ageMonths: clampedAge,
    L: lower.L + fraction * (upper.L - lower.L),
    M: lower.M + fraction * (upper.M - lower.M),
    S: lower.S + fraction * (upper.S - lower.S),
  };
}

function lmsToZScore(value: number, { L, M, S }: Pick<LmsRow, "L" | "M" | "S">): number {
  if (L === 0) {
    return Math.log(value / M) / S;
  }
  return (Math.pow(value / M, L) - 1) / (L * S);
}

function zScoreToWeight(z: number, { L, M, S }: Pick<LmsRow, "L" | "M" | "S">): number {
  if (L === 0) {
    return M * Math.exp(S * z);
  }
  return M * Math.pow(1 + L * S * z, 1 / L);
}

/**
 * Percentile (0–100, not rounded) of a weight-for-age measurement.
 *
 * @param ageMonths Age in months; fractional ages are interpolated, and ages
 *                  outside 0–24 are clamped to the nearest boundary.
 * @param weightKg  Measured weight in kilograms.
 * @param sex       "boy" (supported) or "girl" (scaffold — returns null).
 * @returns The percentile in (0, 100), or null for unsupported sexes.
 *          Callers render "below 1st" / "above 99th" at the UI layer.
 */
export function weightPercentile(ageMonths: number, weightKg: number, sex: Sex = "boy"): number | null {
  if (sex === "girl") {
    return null;
  }
  if (!Number.isFinite(weightKg) || weightKg <= 0) {
    throw new RangeError(`weightPercentile expects a positive weightKg, received ${weightKg}`);
  }

  const lms = interpolateLmsForAge(ageMonths, WEIGHT_FOR_AGE_BOYS_0_24M);
  const z = lmsToZScore(weightKg, lms);
  return cumulativeStandardNormal(z) * 100;
}

/**
 * For each requested age, the weight (kg) sitting on a given reference
 * percentile curve — the inverse-LMS used by GrowthChart to draw P3/P15/
 * P50/P85/P97 reference lines.
 *
 * @param ageMonthsRange Ages (months) at which to sample the curve.
 * @param percentile     One of the WHO reference percentiles.
 * @param sex            "boy" (supported) or "girl" (scaffold — returns []).
 */
export function percentileBands(
  ageMonthsRange: number[],
  percentile: ReferencePercentile,
  sex: Sex = "boy",
): { age: number; weightKg: number }[] {
  if (sex === "girl") {
    return [];
  }

  const z = inverseStandardNormal(percentile / 100);
  return ageMonthsRange.map((age) => {
    const lms = interpolateLmsForAge(age, WEIGHT_FOR_AGE_BOYS_0_24M);
    return { age, weightKg: zScoreToWeight(z, lms) };
  });
}

/*
 * Post-MVP scaffolds. The full (ageMonths, measureCm, sex) signatures are
 * fixed now so the future implementer matches weightPercentile's shape; the
 * params are intentionally unused until the real LMS math lands, hence the
 * scoped lint suppression.
 */
/* eslint-disable @typescript-eslint/no-unused-vars -- scaffold params; real impl is post-MVP */

/**
 * Length-for-age — scaffolded for post-MVP. WHO length-for-age LMS tables
 * exist but length is not captured in Phase 1, so this intentionally throws
 * rather than returning a misleading number.
 */
export function lengthPercentile(ageMonths: number, lengthCm: number, sex: Sex = "boy"): number {
  throw new Error("lengthPercentile not implemented — length-for-age is post-MVP");
}

/**
 * Head-circumference-for-age — scaffolded for post-MVP, same rationale as
 * {@link lengthPercentile}.
 */
export function headCircumferencePercentile(
  ageMonths: number,
  headCircumferenceCm: number,
  sex: Sex = "boy",
): number {
  throw new Error("headCircumferencePercentile not implemented — HC-for-age is post-MVP");
}

/* eslint-enable @typescript-eslint/no-unused-vars */
