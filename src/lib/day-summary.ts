/**
 * The "is baby getting enough today?" rollup — the single source of truth
 * shared by `GET /api/summary` (HTTP) and the dashboard page (direct server
 * call), so the two can never drift. RLS-bound via `withUserContext`;
 * read-only (no `recordEvent`). Uses the DST-safe `getDayWindow` and the
 * tested `dailyTargetRange`.
 */
import { and, eq, gte, lt } from "drizzle-orm";

import { babies, diaperEvents, feedEvents, households } from "./db/schema";
import { dayNumberSinceBirth, getDayWindow } from "./day-window";
import type { BabyContext, DaySummary } from "./insights";
import { dailyTargetRange } from "./targets";
import { withUserContext } from "./with-user-context";

export type DaySummaryPayload = DaySummary & { day_start: string; day_end: string };

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

  let nursingOz = 0;
  let pumpedOz = 0;
  let formulaOz = 0;
  let wastedOz = 0;
  let lastFeedAt: Date | null = null;
  for (const feed of data.feedRows) {
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
  for (const diaper of data.diaperRows) {
    if (diaper.pee) {
      peeCount += 1;
    }
    if (diaper.poop) {
      poopCount += 1;
    }
    lastDiaperAt = laterOf(lastDiaperAt, diaper.occurredAt);
  }

  const ageDays = dayNumberSinceBirth(now, data.baby.birthDate, data.household.timezone, data.household.dayStartHour);
  const currentWeightOz = data.baby.currentWeightOz === null ? null : toNumber(data.baby.currentWeightOz);
  const birthWeightOz = data.baby.birthWeightOz === null ? (currentWeightOz ?? 0) : toNumber(data.baby.birthWeightOz);
  const band = dailyTargetRange({ ageDays, currentWeightOz, birthWeightOz });

  const summary: DaySummaryPayload = {
    day_start: data.start.toISOString(),
    day_end: data.end.toISOString(),
    feeds: {
      total_oz: roundOz(totalOz),
      nursing_oz: roundOz(nursingOz),
      pumped_oz: roundOz(pumpedOz),
      formula_oz: roundOz(formulaOz),
      wasted_oz: roundOz(wastedOz),
      count: data.feedRows.length,
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

  return { summary, baby: { timeZone: data.household.timezone } };
}
