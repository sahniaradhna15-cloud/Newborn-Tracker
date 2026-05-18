import { describe, it, expect } from "vitest";
import { fromZonedTime } from "date-fns-tz";
import { computeInsights, type DaySummary, type BabyContext } from "./insights";

const baby: BabyContext = { timeZone: "America/Chicago" };

/** A Date whose America/Chicago wall clock is 2026-06-15 (CDT) at `hour`:00. */
function chicagoAt(hour: number): Date {
  const hh = hour < 10 ? `0${hour}` : `${hour}`;
  return fromZonedTime(`2026-06-15T${hh}:00:00`, "America/Chicago");
}

/** Summary that triggers NOTHING; override per test. */
function baseSummary(): DaySummary {
  return {
    feeds: { total_oz: 20, nursing_oz: 10, pumped_oz: 10, formula_oz: 0, wasted_oz: 0, count: 5, last_at: null },
    diapers: { pee_count: 10, poop_count: 3, last_at: null },
    target: { low_oz: 14, high_oz: 18, age_days: 20, weight_oz: 114 },
    last_feed_minutes_ago: 30,
  };
}

const kindsOf = (s: DaySummary, now: Date) => computeInsights(s, baby, now).map((i) => i.kind);

describe("computeInsights — quiet by default", () => {
  it("returns nothing when the day looks normal", () => {
    expect(computeInsights(baseSummary(), baby, chicagoAt(12))).toEqual([]);
  });
});

describe("low_intake — gated at 18:00 local", () => {
  it("fires after 18:00 when total is below the band", () => {
    const s = { ...baseSummary(), feeds: { ...baseSummary().feeds, total_oz: 10 } };
    expect(kindsOf(s, chicagoAt(18))).toContain("low_intake");
  });

  it("is suppressed before 18:00 even when below the band", () => {
    const s = { ...baseSummary(), feeds: { ...baseSummary().feeds, total_oz: 10 } };
    expect(kindsOf(s, chicagoAt(17))).not.toContain("low_intake");
  });

  it("does not fire when total is within the band", () => {
    const s = { ...baseSummary(), feeds: { ...baseSummary().feeds, total_oz: 15 } };
    expect(kindsOf(s, chicagoAt(21))).not.toContain("low_intake");
  });
});

describe("low_pee — gated at 20:00 local, ramped floor", () => {
  it("fires after 20:00 when below the expected floor", () => {
    const s = { ...baseSummary(), diapers: { ...baseSummary().diapers, pee_count: 3 } };
    expect(kindsOf(s, chicagoAt(20))).toContain("low_pee"); // age 20 ⇒ floor 6
  });

  it("is suppressed before 20:00", () => {
    const s = { ...baseSummary(), diapers: { ...baseSummary().diapers, pee_count: 3 } };
    expect(kindsOf(s, chicagoAt(19))).not.toContain("low_pee");
  });

  it("does not fire at exactly the floor", () => {
    const s = { ...baseSummary(), diapers: { ...baseSummary().diapers, pee_count: 6 } };
    expect(kindsOf(s, chicagoAt(22))).not.toContain("low_pee");
  });

  it("uses day-number floor for a 3-day-old (floor = 3)", () => {
    const s: DaySummary = {
      ...baseSummary(),
      diapers: { ...baseSummary().diapers, pee_count: 2 },
      target: { ...baseSummary().target, age_days: 3 },
    };
    expect(kindsOf(s, chicagoAt(21))).toContain("low_pee");
  });
});

describe("formula_share — never nags a formula-only family", () => {
  it("fires when >66% formula AND some breast/pumped milk logged", () => {
    const s = { ...baseSummary(), feeds: { ...baseSummary().feeds, nursing_oz: 1, pumped_oz: 0, formula_oz: 10 } };
    expect(kindsOf(s, chicagoAt(12))).toContain("formula_share");
  });

  it("is suppressed on an intentional formula-only day (no breast/pumped)", () => {
    const s = { ...baseSummary(), feeds: { ...baseSummary().feeds, nursing_oz: 0, pumped_oz: 0, formula_oz: 12 } };
    expect(kindsOf(s, chicagoAt(12))).not.toContain("formula_share");
  });

  it("does not fire at 60% formula (below the 66% threshold)", () => {
    const s = { ...baseSummary(), feeds: { ...baseSummary().feeds, nursing_oz: 4, pumped_oz: 0, formula_oz: 6 } };
    expect(kindsOf(s, chicagoAt(12))).not.toContain("formula_share");
  });
});

describe("long_gap / long_diaper_gap — daytime only", () => {
  it("long_gap fires in daytime past 4h since last feed", () => {
    const s = { ...baseSummary(), last_feed_minutes_ago: 300 };
    expect(kindsOf(s, chicagoAt(12))).toContain("long_gap");
  });

  it("long_gap is suppressed at night even past 4h", () => {
    const s = { ...baseSummary(), last_feed_minutes_ago: 300 };
    expect(kindsOf(s, chicagoAt(3))).not.toContain("long_gap");
  });

  it("long_gap does not fire at exactly 4h, or when no feed yet", () => {
    expect(kindsOf({ ...baseSummary(), last_feed_minutes_ago: 240 }, chicagoAt(12))).not.toContain("long_gap");
    expect(kindsOf({ ...baseSummary(), last_feed_minutes_ago: null }, chicagoAt(12))).not.toContain("long_gap");
  });

  it("long_diaper_gap fires in daytime past 6h since last diaper", () => {
    const now = chicagoAt(14);
    const sevenHoursAgo = new Date(now.getTime() - 7 * 60 * 60_000).toISOString();
    const s = { ...baseSummary(), diapers: { ...baseSummary().diapers, last_at: sevenHoursAgo } };
    expect(computeInsights(s, baby, now).map((i) => i.kind)).toContain("long_diaper_gap");
  });

  it("long_diaper_gap does not fire at exactly 6h", () => {
    const now = chicagoAt(14);
    const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60_000).toISOString();
    const s = { ...baseSummary(), diapers: { ...baseSummary().diapers, last_at: sixHoursAgo } };
    expect(computeInsights(s, baby, now).map((i) => i.kind)).not.toContain("long_diaper_gap");
  });
});

describe("tone & ordering invariants (CLAUDE.md §11.3)", () => {
  const BANNED = /\b(alert|warning|error|wrong|problem|bad|concerning)\b/i;

  it("no insight text ever contains a banned word", () => {
    const now = chicagoAt(21);
    const everythingFires: DaySummary = {
      feeds: { total_oz: 5, nursing_oz: 1, pumped_oz: 0, formula_oz: 10, wasted_oz: 0, count: 2, last_at: null },
      diapers: { pee_count: 1, poop_count: 0, last_at: new Date(now.getTime() - 8 * 3_600_000).toISOString() },
      target: { low_oz: 14, high_oz: 18, age_days: 20, weight_oz: 114 },
      last_feed_minutes_ago: 600,
    };
    const insights = computeInsights(everythingFires, baby, now);
    expect(insights.length).toBeGreaterThanOrEqual(3);
    for (const i of insights) {
      expect(i.text).not.toMatch(BANNED);
      expect(i.severity).toBe("info");
      expect(i.text.length).toBeGreaterThan(0);
    }
  });

  it("emits insights in a stable kind order", () => {
    const now = chicagoAt(21);
    const s: DaySummary = {
      feeds: { total_oz: 5, nursing_oz: 1, pumped_oz: 0, formula_oz: 10, wasted_oz: 0, count: 2, last_at: null },
      diapers: { pee_count: 1, poop_count: 0, last_at: new Date(now.getTime() - 8 * 3_600_000).toISOString() },
      target: { low_oz: 14, high_oz: 18, age_days: 20, weight_oz: 114 },
      last_feed_minutes_ago: 600,
    };
    const order = computeInsights(s, baby, now).map((i) => i.kind);
    const expected: typeof order = ["low_intake", "low_pee", "formula_share", "long_gap", "long_diaper_gap"];
    expect(order).toEqual(expected.filter((k) => order.includes(k)));
  });
});
