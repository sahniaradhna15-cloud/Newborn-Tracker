import { describe, it, expect } from "vitest";
import {
  WEIGHT_FOR_AGE_BOYS_0_24M,
  weightPercentile,
  percentileBands,
  lengthPercentile,
  headCircumferencePercentile,
} from "./who-growth";

/**
 * Expected percentiles below were computed by hand from the LMS table in
 * who-growth.ts (Z = ((w/M)^L − 1)/(L·S), then Φ(Z)). Tolerances reflect
 * the plan's "approximately" intent while staying numerically honest:
 * the WHO median at birth is 3.346 kg and at 24mo is 12.15 kg, so the
 * plan's round "~50p" checkpoints land near 46th and 60th respectively.
 */
describe("weightPercentile — boys weight-for-age", () => {
  it("a 6.4 kg boy at 3 months is ~51st percentile (plan: 50 ± 2)", () => {
    const p = weightPercentile(3, 6.4);
    expect(p).not.toBeNull();
    expect(p as number).toBeCloseTo(51.3, 0);
    expect(p as number).toBeGreaterThan(48);
    expect(p as number).toBeLessThan(54);
  });

  it("a 3.3 kg boy at 0 months sits just below the median (~46th)", () => {
    const p = weightPercentile(0, 3.3) as number;
    expect(p).toBeGreaterThan(40);
    expect(p).toBeLessThan(52);
  });

  it("a 12.5 kg boy at 24 months sits above the median (~60th)", () => {
    const p = weightPercentile(24, 12.5) as number;
    expect(p).toBeGreaterThan(52);
    expect(p).toBeLessThan(68);
  });

  it("tail: 2.5 kg at birth ≈ 3rd percentile", () => {
    const p = weightPercentile(0, 2.5) as number;
    expect(p).toBeGreaterThan(1.5);
    expect(p).toBeLessThan(5);
  });

  it("tail: 4.4 kg at birth ≈ 97th percentile", () => {
    const p = weightPercentile(0, 4.4) as number;
    expect(p).toBeGreaterThan(94);
    expect(p).toBeLessThan(99.5);
  });

  it("at the exact median weight, percentile is 50 for every table row", () => {
    for (const row of WEIGHT_FOR_AGE_BOYS_0_24M) {
      const p = weightPercentile(row.ageMonths, row.M) as number;
      expect(p).toBeCloseTo(50, 4);
    }
  });

  it("is monotonic in weight at a fixed age", () => {
    const light = weightPercentile(6, 6.5) as number;
    const median = weightPercentile(6, 7.93) as number;
    const heavy = weightPercentile(6, 9.5) as number;
    expect(light).toBeLessThan(median);
    expect(median).toBeLessThan(heavy);
  });

  it("interpolates fractional ages (a ~19-day-old is between months 0 and 1)", () => {
    const ageMonths = 19 / 30.4375;
    const p = weightPercentile(ageMonths, 3.2) as number;
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(100);
  });

  it("clamps out-of-range ages instead of throwing (newborn safety)", () => {
    expect(() => weightPercentile(-1, 3.3)).not.toThrow();
    expect(() => weightPercentile(36, 13)).not.toThrow();
    expect(weightPercentile(-1, 3.3)).toEqual(weightPercentile(0, 3.3));
  });

  it("rejects a non-positive weight", () => {
    expect(() => weightPercentile(3, 0)).toThrow(RangeError);
    expect(() => weightPercentile(3, -5)).toThrow(RangeError);
  });

  it("girls are scaffolded — returns null until post-MVP", () => {
    expect(weightPercentile(3, 6.4, "girl")).toBeNull();
  });
});

describe("percentileBands — inverse LMS reference curves", () => {
  it("P50 band at age 0 equals the month-0 median weight", () => {
    const [point] = percentileBands([0], 50);
    expect(point.age).toBe(0);
    expect(point.weightKg).toBeCloseTo(WEIGHT_FOR_AGE_BOYS_0_24M[0].M, 4);
  });

  it("round-trips: weight on the P3/P50/P97 curve maps back to that percentile", () => {
    for (const pct of [3, 50, 97] as const) {
      for (const age of [0, 6, 12, 24]) {
        const [{ weightKg }] = percentileBands([age], pct);
        const recovered = weightPercentile(age, weightKg) as number;
        expect(recovered).toBeCloseTo(pct, 1);
      }
    }
  });

  it("bands are ordered P3 < P50 < P97 at every sampled age", () => {
    const ages = [0, 3, 6, 12, 24];
    const p3 = percentileBands(ages, 3);
    const p50 = percentileBands(ages, 50);
    const p97 = percentileBands(ages, 97);
    ages.forEach((_, i) => {
      expect(p3[i].weightKg).toBeLessThan(p50[i].weightKg);
      expect(p50[i].weightKg).toBeLessThan(p97[i].weightKg);
    });
  });

  it("girls are scaffolded — returns an empty band set", () => {
    expect(percentileBands([0, 6, 12], 50, "girl")).toEqual([]);
  });
});

describe("post-MVP scaffolds throw rather than mislead", () => {
  it("lengthPercentile is not implemented", () => {
    expect(() => lengthPercentile(3, 60)).toThrow(/not implemented/);
  });

  it("headCircumferencePercentile is not implemented", () => {
    expect(() => headCircumferencePercentile(3, 40)).toThrow(/not implemented/);
  });
});
