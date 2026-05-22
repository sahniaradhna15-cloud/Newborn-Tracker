/**
 * 4am-rollover day math — the spine of every number on the dashboard.
 *
 * A "day" for this product is NOT midnight→midnight. It runs from
 * `dayStartHour` local (default 4am, America/Chicago) to `dayStartHour`
 * local the next calendar day, so a 2am feed counts toward the night that
 * is still in progress, not the day that hasn't started.
 *
 * Risk R2 (TECHNICAL_SPEC §13): a DST bug here corrupts every total,
 * target, and insight. The window boundaries (04:00 local) sit outside the
 * DST transition ranges (01:00–03:00 local), so they always resolve to an
 * unambiguous instant — but the window *duration* legitimately becomes 23h
 * (spring-forward) or 25h (fall-back), and that is exactly what the P0
 * fixtures in day-window.test.ts assert.
 *
 * date-fns-tz v3 note: this uses `fromZonedTime` / `formatInTimeZone`. Older
 * docs reference v2's `zonedTimeToUtc` / `utcToZonedTime` — superseded names,
 * same as the Next 15→16 situation.
 */

import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export const DAY_START_HOUR_DEFAULT = 4;

export type DayWindow = { start: Date; end: Date };

function pad2(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

/** A naive "yyyy-MM-ddTHH:00:00" wall-clock string `fromZonedTime` can parse. */
function wallClockStringAtHour(year: number, month1: number, day: number, hour: number): string {
  return `${year}-${pad2(month1)}-${pad2(day)}T${pad2(hour)}:00:00`;
}

/**
 * Read the wall-clock civil fields of `instant` in `timeZone`, independent of
 * the machine's local timezone. `formatInTimeZone` is the only fully
 * system-tz-agnostic way to do this with date-fns-tz.
 */
function civilFieldsInZone(instant: Date, timeZone: string): { year: number; month1: number; day: number; hour: number } {
  const stamp = formatInTimeZone(instant, timeZone, "yyyy-MM-dd-HH");
  const [year, month1, day, hour] = stamp.split("-").map(Number);
  return { year, month1, day, hour };
}

/** Shift a civil (Y, 1-based M, D) date by `deltaDays`, with correct month/year rollover and no DST involvement. */
function shiftCivilDate(
  year: number,
  month1: number,
  day: number,
  deltaDays: number,
): { year: number; month1: number; day: number } {
  const scratch = new Date(Date.UTC(year, month1 - 1, day));
  scratch.setUTCDate(scratch.getUTCDate() + deltaDays);
  return { year: scratch.getUTCFullYear(), month1: scratch.getUTCMonth() + 1, day: scratch.getUTCDate() };
}

/**
 * The [start, end) UTC interval for the logical day containing `now`.
 *
 * @param now           Any instant (UTC `Date`).
 * @param timeZone      IANA zone, e.g. "America/Chicago".
 * @param dayStartHour  Local hour the day rolls over (0–23; product default 4).
 * @returns `start`/`end` as real UTC `Date`s. `end - start` is 24h normally,
 *          23h on a spring-forward day, 25h on a fall-back day — by design.
 */
export function getDayWindow(now: Date, timeZone: string, dayStartHour: number = DAY_START_HOUR_DEFAULT): DayWindow {
  const { year, month1, day, hour } = civilFieldsInZone(now, timeZone);

  // Before the rollover hour, we are still inside *yesterday's* logical day.
  const startCivil = hour < dayStartHour ? shiftCivilDate(year, month1, day, -1) : { year, month1, day };
  const endCivil = shiftCivilDate(startCivil.year, startCivil.month1, startCivil.day, 1);

  return {
    start: fromZonedTime(wallClockStringAtHour(startCivil.year, startCivil.month1, startCivil.day, dayStartHour), timeZone),
    end: fromZonedTime(wallClockStringAtHour(endCivil.year, endCivil.month1, endCivil.day, dayStartHour), timeZone),
  };
}

/**
 * An instant that is guaranteed to fall inside the FIRST calendar day of the
 * month `monthsBack` months before `now`'s month, in `timeZone`. Used to seed
 * a {@link getRangeSummary} walk for the "this month" / "last month" intake
 * trend views.
 *
 * Returns noon (12:00) local on the 1st, deliberately well clear of both the
 * 04:00 day-start boundary and the 01:00–03:00 DST transition window, so the
 * result always lands squarely inside that day's logical window regardless of
 * the configured day-start hour or any DST flip that month.
 *
 * @param now         Any instant (UTC `Date`); only its civil month in `timeZone` is read.
 * @param timeZone    IANA zone, e.g. "America/Chicago".
 * @param monthsBack  0 = the 1st of the current month, 1 = the 1st of last month, etc.
 * @returns A real UTC `Date` inside the target month's first logical day.
 */
export function firstInstantOfMonthsBack(now: Date, timeZone: string, monthsBack: number): Date {
  const { year, month1 } = civilFieldsInZone(now, timeZone);

  // Shift the 1-based month back, rolling the year over as needed.
  let targetYear = year;
  let targetMonth = month1 - monthsBack;
  while (targetMonth <= 0) {
    targetMonth += 12;
    targetYear -= 1;
  }

  return fromZonedTime(wallClockStringAtHour(targetYear, targetMonth, 1, 12), timeZone);
}

/**
 * Day-of-life for the logical day containing `now`. Birth day = **1**
 * (1-based, matching the plan's "Day 1 / Day 7" language and `targets.ts`).
 *
 * Counted in logical days (4am-rollover), so an event at 03:30 belongs to
 * the previous day-of-life — consistent with {@link getDayWindow}.
 */
export function dayNumberSinceBirth(
  now: Date,
  dateOfBirth: Date,
  timeZone: string,
  dayStartHour: number = DAY_START_HOUR_DEFAULT,
): number {
  const nowStart = getDayWindow(now, timeZone, dayStartHour).start;
  const birthStart = getDayWindow(dateOfBirth, timeZone, dayStartHour).start;

  // Diff the two window-start *civil dates* (not raw ms) so DST-length days
  // never skew the count.
  const a = civilFieldsInZone(nowStart, timeZone);
  const b = civilFieldsInZone(birthStart, timeZone);
  const aUtc = Date.UTC(a.year, a.month1 - 1, a.day);
  const bUtc = Date.UTC(b.year, b.month1 - 1, b.day);
  const wholeDaysBetween = Math.round((aUtc - bUtc) / 86_400_000);

  return wholeDaysBetween + 1;
}
