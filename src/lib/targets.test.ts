import { describe, it, expect } from "vitest";
import { nursingRateOzPerMin, estimateNursingOz, dailyTargetRange, intakeRangeForWeek } from "./targets";

const ANAY_BIRTH_WEIGHT_OZ = 109; // CLAUDE.md seed: 6 lb 13 oz

describe("nursingRateOzPerMin — day-of-life tiers (PLAN.md §312)", () => {
  it("applies the right tier at each boundary", () => {
    expect(nursingRateOzPerMin(0)).toBe(0.1);
    expect(nursingRateOzPerMin(6)).toBe(0.1);
    expect(nursingRateOzPerMin(7)).toBe(0.15);
    expect(nursingRateOzPerMin(29)).toBe(0.15);
    expect(nursingRateOzPerMin(30)).toBe(0.2);
    expect(nursingRateOzPerMin(59)).toBe(0.2);
    expect(nursingRateOzPerMin(60)).toBe(0.25);
    expect(nursingRateOzPerMin(180)).toBe(0.25);
  });
});

describe("estimateNursingOz", () => {
  it("plan checkpoint: 20 min at day 14 === 3.0 oz", () => {
    expect(estimateNursingOz(20, 14)).toBe(3.0);
  });

  it("Task 3 DoD: 10 min nursing for ~19-day-old ≈ 1.5 oz", () => {
    expect(estimateNursingOz(10, 19)).toBe(1.5);
  });

  it("rounds to 2 decimals (no float noise)", () => {
    expect(estimateNursingOz(7, 3)).toBe(0.7); // 7 * 0.10
    expect(estimateNursingOz(13, 45)).toBe(2.6); // 13 * 0.20
  });
});

describe("dailyTargetRange — plan checkpoints", () => {
  it("Day 1: band saturates at the day-number ramp (4–8 oz)", () => {
    expect(dailyTargetRange({ ageDays: 1, currentWeightOz: null, birthWeightOz: ANAY_BIRTH_WEIGHT_OZ })).toEqual({
      lowOz: 4,
      highOz: 8,
    });
  });

  it("Day 7, 7.0 lb ⇒ low 14.0, high 17.5", () => {
    expect(dailyTargetRange({ ageDays: 7, currentWeightOz: 7 * 16, birthWeightOz: ANAY_BIRTH_WEIGHT_OZ })).toEqual({
      lowOz: 14.0,
      highOz: 17.5,
    });
  });

  it("Day 30, 10 lb ⇒ high 25.0 (under the 32 cap)", () => {
    expect(dailyTargetRange({ ageDays: 30, currentWeightOz: 10 * 16, birthWeightOz: ANAY_BIRTH_WEIGHT_OZ })).toEqual({
      lowOz: 20.0,
      highOz: 25.0,
    });
  });

  it("Day 60, 16 lb ⇒ high capped at 32.0", () => {
    expect(dailyTargetRange({ ageDays: 60, currentWeightOz: 16 * 16, birthWeightOz: ANAY_BIRTH_WEIGHT_OZ })).toEqual({
      lowOz: 32.0,
      highOz: 32.0,
    });
  });
});

describe("dailyTargetRange — estimated weight & invariants", () => {
  it("Task 4 DoD: 19-day-old, 109 oz birth weight, null current ⇒ ≈14–18 oz", () => {
    const band = dailyTargetRange({ ageDays: 19, currentWeightOz: null, birthWeightOz: ANAY_BIRTH_WEIGHT_OZ });
    // est weight = 109 + (19-14)*1 = 114 oz = 7.125 lb ⇒ 14.25 / 17.8125
    expect(band.lowOz).toBeCloseTo(14.3, 1);
    expect(band.highOz).toBeCloseTo(17.8, 1);
    expect(band.lowOz).toBeGreaterThanOrEqual(14);
    expect(band.highOz).toBeLessThanOrEqual(18);
  });

  it("null current weight at/under day 14 uses birth weight (no gain yet)", () => {
    const atBirthWeight = dailyTargetRange({ ageDays: 7, currentWeightOz: null, birthWeightOz: 7 * 16 });
    expect(atBirthWeight).toEqual({ lowOz: 14.0, highOz: 17.5 });
  });

  it("days 2–6 ramp: high saturates to the weight rule for a small newborn", () => {
    // Day 3, 109 oz: ramp 12–24, weight rule ~13.6–17.0 ⇒ low 12, high ~17.0
    const band = dailyTargetRange({ ageDays: 3, currentWeightOz: null, birthWeightOz: ANAY_BIRTH_WEIGHT_OZ });
    expect(band.lowOz).toBe(12.0);
    expect(band.highOz).toBeCloseTo(17.0, 1);
  });

  it("low never exceeds high and nothing exceeds the 32 oz cap", () => {
    for (const ageDays of [1, 3, 6, 7, 14, 30, 60, 120]) {
      for (const currentWeightOz of [null, 80, 160, 320, 640]) {
        const { lowOz, highOz } = dailyTargetRange({ ageDays, currentWeightOz, birthWeightOz: ANAY_BIRTH_WEIGHT_OZ });
        expect(lowOz).toBeLessThanOrEqual(highOz);
        expect(highOz).toBeLessThanOrEqual(32);
        expect(lowOz).toBeGreaterThan(0);
      }
    }
  });
});

describe("intakeRangeForWeek — age-appropriate band (birth-weight estimate)", () => {
  it("two weeks old (Anay): ~13.6–17.0 oz/day from birth weight", () => {
    const r = intakeRangeForWeek(2, ANAY_BIRTH_WEIGHT_OZ);
    expect(r.ageDays).toBe(14);
    expect(r.lowOz).toBeCloseTo(13.6, 1);
    expect(r.highOz).toBeCloseTo(17.0, 1);
  });

  it("four weeks old (Anay): ~15.4–19.2 oz/day (weight climbs ~1 oz/day after day 14)", () => {
    const r = intakeRangeForWeek(4, ANAY_BIRTH_WEIGHT_OZ);
    expect(r.ageDays).toBe(28);
    expect(r.lowOz).toBeCloseTo(15.4, 1);
    expect(r.highOz).toBeCloseTo(19.2, 1);
  });

  it("the band climbs week over week", () => {
    const weeks = [2, 3, 4, 5].map((w) => intakeRangeForWeek(w, ANAY_BIRTH_WEIGHT_OZ));
    for (let i = 1; i < weeks.length; i++) {
      expect(weeks[i].lowOz).toBeGreaterThan(weeks[i - 1].lowOz);
      expect(weeks[i].highOz).toBeGreaterThan(weeks[i - 1].highOz);
    }
  });
});
