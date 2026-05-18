/**
 * The "is baby getting enough today?" rollup — the single source of truth
 * shared by `GET /api/summary` (HTTP) and the dashboard page (direct server
 * call), so the two can never drift. RLS-bound via `withUserContext`;
 * read-only (no `recordEvent`). Uses the DST-safe `getDayWindow` and the
 * tested `dailyTargetRange`.
 *
 * Phase 2 Task 4: `getRangeSummary` (history + pediatrician PDF) is a
 * sibling here that reuses the EXACT same per-day reducer `getDaySummary`
 * uses (`reduceDay`) over a DST-safe walk of logical-day windows — there
 * is no second feed/diaper total derivation anywhere in the codebase.
 */
import { and, eq, gte, lt } from "drizzle-orm";

import { babies, diaperEvents, feedEvents, households } from "./db/schema";
import { dayNumberSinceBirth, getDayWindow } from "./day-window";
import type { BabyContext, DaySummary } from "./insights";
import { dailyTargetRange } from "./targets";
import { withUserContext } from "./with-user-context";

export type DaySummaryPayload = DaySummary & { day_start: string; day_end: string };

type FeedRow = typeof feedEvents.$inferSelect;
type DiaperRow = typeof diaperEvents.$inferSelect;
type HouseholdRow = typeof households.$inferSelect;
type BabyRow = typeof babies.$inferSelect;

function toNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function roundOz(value: number): number {
  return Math.round(value * 10) / 10;
}

function laterOf(current: Date | null, candidate: Date): Date {
  return current === null || candidate.getTime() > current.getTime() ? candidate : current;
}

/**
 * The single per-day reducer. Both `getDaySummary` (today) and
 * `getRangeSummary` (history/PDF) call this with the rows already
 * windowed to one logical day, so feed/diaper totals can never drift
 * between the two call sites (CLAUDE.md §3 — one rollup definition).
 *
 * @param feedRows    feed_events rows for this logical day only
 * @param diaperRows  diaper_events rows for this logical day only
 * @param window      the logical-day [start, end) UTC interval
 * @param baby        baby row (birth date + weights, oz)
 * @param household   household row (timezone + day-start hour)
 * @param now         reference instant for age + "minutes ago" math
 */
function reduceDay(
  feedRows: FeedRow[],
  diaperRows: DiaperRow[],
  window: { start: Date; end: Date },
  baby: BabyRow,
  household: HouseholdRow,
  now: Date,
): DaySummaryPayload {
  let nursingOz = 0;
  let pumpedOz = 0;
  let formulaOz = 0;
  let wastedOz = 0;
  let lastFeedAt: Date | null = null;
  for (const feed of feedRows) {
    const oz = toNumber(feed.estimatedOz);
    if (feed.kind === "nursing") {
      nursingOz += oz;
    } else if (feed.kind === "pumped") {
      pumpedOz += oz;
    } else if (feed.kind === "formula") {
      formulaOz += oz;
    }
    wastedOz += toNumber(feed.wastedOz);
    lastFeedAt = laterOf(lastFeedAt, feed.occurredAt);
  }
  const totalOz = nursingOz + pumpedOz + formulaOz;

  let peeCount = 0;
  let poopCount = 0;
  let lastDiaperAt: Date | null = null;
  for (const diaper of diaperRows) {
    if (diaper.pee) {
      peeCount += 1;
    }
    if (diaper.poop) {
      poopCount += 1;
    }
    lastDiaperAt = laterOf(lastDiaperAt, diaper.occurredAt);
  }

  // Age is the day-of-life of the day being summarized, not "today": pick
  // an instant inside the window so historical rows get their own age band.
  const referenceInstant = window.end.getTime() <= now.getTime() ? window.start : now;
  const ageDays = dayNumberSinceBirth(referenceInstant, baby.birthDate, household.timezone, household.dayStartHour);
  const currentWeightOz = baby.currentWeightOz === null ? null : toNumber(baby.currentWeightOz);
  const birthWeightOz = baby.birthWeightOz === null ? (currentWeightOz ?? 0) : toNumber(baby.birthWeightOz);
  const band = dailyTargetRange({ ageDays, currentWeightOz, birthWeightOz });

  return {
    day_start: window.start.toISOString(),
    day_end: window.end.toISOString(),
    feeds: {
      total_oz: roundOz(totalOz),
      nursing_oz: roundOz(nursingOz),
      pumped_oz: roundOz(pumpedOz),
      formula_oz: roundOz(formulaOz),
      wasted_oz: roundOz(wastedOz),
      count: feedRows.length,
      last_at: lastFeedAt === null ? null : lastFeedAt.toISOString(),
    },
    diapers: {
      pee_count: peeCount,
      poop_count: poopCount,
      last_at: lastDiaperAt === null ? null : lastDiaperAt.toISOString(),
    },
    target: { low_oz: band.lowOz, high_oz: band.highOz, age_days: ageDays, weight_oz: currentWeightOz },
    last_feed_minutes_ago: lastFeedAt === null ? null : Math.round((now.getTime() - lastFeedAt.getTime()) / 60_000),
  };
}

/**
 * Today's rollup for the active baby. RLS-bound; returns null when the
 * household has no baby (caller redirects to onboarding).
 *
 * @param userId       caller's user id (binds the RLS GUC)
 * @param householdId  caller's household
 * @param now          evaluation instant (UTC)
 */
export async function getDaySummary(
  userId: string,
  householdId: string,
  now: Date,
): Promise<{ summary: DaySummaryPayload; baby: BabyContext } | null> {
  const data = await withUserContext(userId, async (tx) => {
    const [household] = await tx.select().from(households).where(eq(households.id, householdId)).limit(1);
    const [baby] = await tx.select().from(babies).where(eq(babies.householdId, householdId)).limit(1);
    if (!household || !baby) {
      return null;
    }

    const { start, end } = getDayWindow(now, household.timezone, household.dayStartHour);

    const feedRows = await tx
      .select()
      .from(feedEvents)
      .where(and(eq(feedEvents.babyId, baby.id), gte(feedEvents.occurredAt, start), lt(feedEvents.occurredAt, end)));
    const diaperRows = await tx
      .select()
      .from(diaperEvents)
      .where(
        and(eq(diaperEvents.babyId, baby.id), gte(diaperEvents.occurredAt, start), lt(diaperEvents.occurredAt, end)),
      );

    return { household, baby, start, end, feedRows, diaperRows };
  });

  if (!data) {
    return null;
  }

  const summary = reduceDay(
    data.feedRows,
    data.diaperRows,
    { start: data.start, end: data.end },
    data.baby,
    data.household,
    now,
  );
  return { summary, baby: { timeZone: data.household.timezone } };
}

/**
 * One {@link DaySummaryPayload} per logical day in `[from, to]`, newest
 * first — the data behind `/history` and the pediatrician PDF.
 *
 * Walks the DST-safe logical-day windows from `from` to `to` (each via
 * `getDayWindow`, so a 23h spring-forward / 25h fall-back day is one
 * entry, never two), reads all feed/diaper rows for the span in ONE
 * RLS-bound transaction, then runs the SAME {@link reduceDay} reducer
 * per window that `getDaySummary` uses — no re-derivation, no drift.
 *
 * @param userId       caller's user id (binds the RLS GUC)
 * @param householdId  caller's household
 * @param from         any instant inside the OLDEST day to include
 * @param to           any instant inside the NEWEST day to include
 * @returns one entry per logical day, newest-first; `[]` if no baby
 */
export async function getRangeSummary(
  userId: string,
  householdId: string,
  from: Date,
  to: Date,
): Promise<{ days: DaySummaryPayload[]; baby: BabyContext } | null> {
  const data = await withUserContext(userId, async (tx) => {
    const [household] = await tx.select().from(households).where(eq(households.id, householdId)).limit(1);
    const [baby] = await tx.select().from(babies).where(eq(babies.householdId, householdId)).limit(1);
    if (!household || !baby) {
      return null;
    }

    const firstWindow = getDayWindow(from, household.timezone, household.dayStartHour);
    const lastWindow = getDayWindow(to, household.timezone, household.dayStartHour);
    const spanStart = firstWindow.start.getTime() <= lastWindow.start.getTime() ? firstWindow.start : lastWindow.start;
    const spanEnd = firstWindow.end.getTime() >= lastWindow.end.getTime() ? firstWindow.end : lastWindow.end;

    const feedRows = await tx
      .select()
      .from(feedEvents)
      .where(
        and(eq(feedEvents.babyId, baby.id), gte(feedEvents.occurredAt, spanStart), lt(feedEvents.occurredAt, spanEnd)),
      );
    const diaperRows = await tx
      .select()
      .from(diaperEvents)
      .where(
        and(
          eq(diaperEvents.babyId, baby.id),
          gte(diaperEvents.occurredAt, spanStart),
          lt(diaperEvents.occurredAt, spanEnd),
        ),
      );

    return { household, baby, feedRows, diaperRows };
  });

  if (!data) {
    return null;
  }

  const now = new Date();
  const days: DaySummaryPayload[] = [];

  // Walk logical-day windows oldest→newest using getDayWindow on a probe
  // instant stepped by ~24h then re-snapped to the window — DST-safe (a
  // probe inside a 23h/25h day still resolves to that day's [start, end)).
  let cursor = getDayWindow(from, data.household.timezone, data.household.dayStartHour).start;
  const lastStart = getDayWindow(to, data.household.timezone, data.household.dayStartHour).start.getTime();

  while (cursor.getTime() <= lastStart) {
    const window = getDayWindow(cursor, data.household.timezone, data.household.dayStartHour);
    const dayFeedRows = data.feedRows.filter(
      (r) => r.occurredAt >= window.start && r.occurredAt < window.end,
    );
    const dayDiaperRows = data.diaperRows.filter(
      (r) => r.occurredAt >= window.start && r.occurredAt < window.end,
    );
    days.push(reduceDay(dayFeedRows, dayDiaperRows, window, data.baby, data.household, now));

    // Step into the next logical day: window.end IS the next day's start,
    // but probe slightly past it so a fresh getDayWindow lands squarely
    // inside the next day regardless of that day's DST length.
    cursor = getDayWindow(new Date(window.end.getTime() + 60 * 60 * 1000), data.household.timezone, data.household.dayStartHour).start;
  }

  days.reverse();
  return { days, baby: { timeZone: data.household.timezone } };
}
