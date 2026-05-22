import { describe, it, expect } from "vitest";
import { formatInTimeZone } from "date-fns-tz";
import { getDayWindow, dayNumberSinceBirth, firstInstantOfMonthsBack } from "./day-window";

const CHICAGO = "America/Chicago";
const HOUR_MS = 3_600_000;

/**
 * P0 — Risk R2 (TECHNICAL_SPEC §13, CLAUDE.md §12). A DST bug here corrupts
 * every total/target/insight on the dashboard. The 04:00 window boundaries
 * are outside the 01:00–03:00 transition ranges, so they resolve to a single
 * unambiguous instant; the window *length* legitimately flexes to 23h/25h.
 */
describe("getDayWindow — DST fixtures (P0)", () => {
  it("fall-back 2026-11-01: the logical day spanning the repeated hour is 25h", () => {
    // 2026-11-01T05:30:00Z == 00:30 CDT on Nov 1 — inside [Oct31 04:00, Nov1 04:00).
    const now = new Date("2026-11-01T05:30:00Z");
    const { start, end } = getDayWindow(now, CHICAGO, 4);

    expect(start.toISOString()).toBe("2026-10-31T09:00:00.000Z"); // Oct 31 04:00 CDT (UTC-5)
    expect(end.toISOString()).toBe("2026-11-01T10:00:00.000Z"); // Nov 1 04:00 CST (UTC-6)
    expect(end.getTime() - start.getTime()).toBe(25 * HOUR_MS);
    expect(now.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(now.getTime()).toBeLessThan(end.getTime());
  });

  it("fall-back: 03:30 local (after the repeat, before rollover) still maps to the 25h day", () => {
    // 03:30 CST == 09:30Z; hour 3 < 4 ⇒ previous logical day.
    const { start, end } = getDayWindow(new Date("2026-11-01T09:30:00Z"), CHICAGO, 4);
    expect(start.toISOString()).toBe("2026-10-31T09:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(25 * HOUR_MS);
  });

  it("spring-forward 2027-03-14: the logical day spanning the skipped hour is 23h", () => {
    // NOTE: CLAUDE.md §12, phase-1 plan, and TECHNICAL_SPEC §13 all say
    // "2027-03-08". That is wrong: America/Chicago spring-forward is the
    // second Sunday of March = 2027-03-14 (Mar 1 2027 is a Monday). On
    // 2027-03-08 there is no transition, so that fixture would assert a
    // normal 24h day and test nothing. Using the real tzdata date here.
    // 2027-03-14T06:30:00Z == 00:30 CST on Mar 14 — inside [Mar13 04:00, Mar14 04:00).
    const now = new Date("2027-03-14T06:30:00Z");
    const { start, end } = getDayWindow(now, CHICAGO, 4);

    expect(start.toISOString()).toBe("2027-03-13T10:00:00.000Z"); // Mar 13 04:00 CST (UTC-6)
    expect(end.toISOString()).toBe("2027-03-14T09:00:00.000Z"); // Mar 14 04:00 CDT (UTC-5)
    expect(end.getTime() - start.getTime()).toBe(23 * HOUR_MS);
    expect(now.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(now.getTime()).toBeLessThan(end.getTime());
  });
});

describe("getDayWindow — 4am rollover", () => {
  it("03:59 local belongs to the PREVIOUS day; 04:00 starts the new day", () => {
    const before = getDayWindow(new Date("2026-06-15T08:59:00Z"), CHICAGO, 4); // 03:59 CDT Jun 15
    const after = getDayWindow(new Date("2026-06-15T09:00:00Z"), CHICAGO, 4); // 04:00 CDT Jun 15

    expect(formatInTimeZone(before.start, CHICAGO, "yyyy-MM-dd HH:mm")).toBe("2026-06-14 04:00");
    expect(formatInTimeZone(after.start, CHICAGO, "yyyy-MM-dd HH:mm")).toBe("2026-06-15 04:00");
    expect(before.end.getTime() - before.start.getTime()).toBe(24 * HOUR_MS); // regular day
  });

  it("an event at 03:30 local counts toward the previous day", () => {
    const { start, end } = getDayWindow(new Date("2026-06-15T08:30:00Z"), CHICAGO, 4); // 03:30 CDT
    expect(formatInTimeZone(start, CHICAGO, "yyyy-MM-dd HH:mm")).toBe("2026-06-14 04:00");
    expect(formatInTimeZone(end, CHICAGO, "yyyy-MM-dd HH:mm")).toBe("2026-06-15 04:00");
  });

  it("respects a non-default dayStartHour", () => {
    // 05:30 CDT Jun 15 with dayStartHour=6 ⇒ still previous day (5:30 < 6).
    const { start } = getDayWindow(new Date("2026-06-15T10:30:00Z"), CHICAGO, 6);
    expect(formatInTimeZone(start, CHICAGO, "yyyy-MM-dd HH:mm")).toBe("2026-06-14 06:00");
  });
});

describe("dayNumberSinceBirth — Anay (DOB 2026-04-23, America/Chicago)", () => {
  // Birth at 14:00 local on 2026-04-23 (CDT) == 19:00Z.
  const dob = new Date("2026-04-23T19:00:00Z");

  it("birth day is day 1", () => {
    expect(dayNumberSinceBirth(new Date("2026-04-23T19:00:00Z"), dob, CHICAGO, 4)).toBe(1);
    expect(dayNumberSinceBirth(new Date("2026-04-24T01:00:00Z"), dob, CHICAGO, 4)).toBe(1); // 20:00 local, same logical day
  });

  it("counts logical days, not raw 24h blocks", () => {
    // 2026-05-12 10:00 CDT ⇒ 19 days after Apr 23 ⇒ day 20.
    expect(dayNumberSinceBirth(new Date("2026-05-12T15:00:00Z"), dob, CHICAGO, 4)).toBe(20);
  });

  it("the 4am rollover advances day-of-life", () => {
    const justBefore = dayNumberSinceBirth(new Date("2026-05-13T08:30:00Z"), dob, CHICAGO, 4); // 03:30 CDT May 13
    const justAfter = dayNumberSinceBirth(new Date("2026-05-13T09:30:00Z"), dob, CHICAGO, 4); // 04:30 CDT May 13
    expect(justBefore).toBe(20); // still logical-day May 12
    expect(justAfter).toBe(21); // logical-day May 13
  });

  it("is stable across a fall-back DST day (internal consistency)", () => {
    const noon = dayNumberSinceBirth(new Date("2026-10-31T17:00:00Z"), dob, CHICAGO, 4); // Oct 31 noon CDT
    const insideRepeat = dayNumberSinceBirth(new Date("2026-11-01T05:30:00Z"), dob, CHICAGO, 4); // logical-day Oct 31
    const afterRollover = dayNumberSinceBirth(new Date("2026-11-01T10:30:00Z"), dob, CHICAGO, 4); // 04:30 CST Nov 1
    expect(insideRepeat).toBe(noon);
    expect(afterRollover).toBe(noon + 1);
  });
});

describe("firstInstantOfMonthsBack — trend-range seed (America/Chicago)", () => {
  it("monthsBack=0 returns noon on the 1st of the current month", () => {
    const seed = firstInstantOfMonthsBack(new Date("2026-05-22T15:00:00Z"), CHICAGO, 0);
    expect(formatInTimeZone(seed, CHICAGO, "yyyy-MM-dd HH:mm")).toBe("2026-05-01 12:00");
    // Noon on the 1st must sit inside that day's 04:00→04:00 logical window.
    const window = getDayWindow(seed, CHICAGO, 4);
    expect(formatInTimeZone(window.start, CHICAGO, "yyyy-MM-dd HH:mm")).toBe("2026-05-01 04:00");
  });

  it("monthsBack=1 returns the 1st of last month", () => {
    const seed = firstInstantOfMonthsBack(new Date("2026-05-22T15:00:00Z"), CHICAGO, 1);
    expect(formatInTimeZone(seed, CHICAGO, "yyyy-MM-dd HH:mm")).toBe("2026-04-01 12:00");
  });

  it("rolls the year over when stepping back across January", () => {
    const seed = firstInstantOfMonthsBack(new Date("2026-01-09T15:00:00Z"), CHICAGO, 1);
    expect(formatInTimeZone(seed, CHICAGO, "yyyy-MM-dd HH:mm")).toBe("2025-12-01 12:00");
  });

  it("reads the civil month in the zone, not UTC (late-night edge)", () => {
    // 2026-06-01T02:00:00Z == 2026-05-31 21:00 CDT — still May in Chicago.
    const seed = firstInstantOfMonthsBack(new Date("2026-06-01T02:00:00Z"), CHICAGO, 0);
    expect(formatInTimeZone(seed, CHICAGO, "yyyy-MM-dd HH:mm")).toBe("2026-05-01 12:00");
  });
});
