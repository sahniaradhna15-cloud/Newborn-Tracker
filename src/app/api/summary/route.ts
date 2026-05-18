/**
 * `GET /api/summary` (session) — the "is baby getting enough today?" rollup
 * for the active baby's logical day.
 *
 * Read-only: it SELECTs feed_events/diaper_events inside `withUserContext`
 * (RLS-bound) and never calls `recordEvent`. It uses the real DST-safe
 * `getDayWindow` + `dailyTargetRange` (Task 4), not record-event.ts's
 * `phase1*` stubs — those get swapped to these helpers at integration.
 *
 * Response is the canonical summary the dashboard, InsightBanner, and the
 * Phase 2 history view all consume; shape matches `DaySummary` in insights.ts.
 */
import { NextResponse, type NextRequest } from "next/server";
import { and, eq, gte, lt } from "drizzle-orm";

import { babies, diaperEvents, feedEvents, households } from "@/lib/db/schema";
import { dayNumberSinceBirth, getDayWindow } from "@/lib/day-window";
import { dailyTargetRange } from "@/lib/targets";
import { withAuth } from "@/lib/with-auth";
import { withUserContext } from "@/lib/with-user-context";

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

export async function GET(req: NextRequest) {
  const ctx = await withAuth(req);
  if (!ctx) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();

    const data = await withUserContext(ctx.user_id, async (tx) => {
      const [household] = await tx.select().from(households).where(eq(households.id, ctx.household_id)).limit(1);
      const [baby] = await tx.select().from(babies).where(eq(babies.householdId, ctx.household_id)).limit(1);
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
      return NextResponse.json({ ok: false, error: "no_active_baby" }, { status: 404 });
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

    const summary = {
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
      last_feed_minutes_ago:
        lastFeedAt === null ? null : Math.round((now.getTime() - lastFeedAt.getTime()) / 60_000),
    };

    console.info(
      JSON.stringify({
        event: "summary",
        route: "/api/summary",
        method: "GET",
        status: "ok",
        user_id: ctx.user_id,
        household_id: ctx.household_id,
        feed_rows: data.feedRows.length,
        diaper_rows: data.diaperRows.length,
      }),
    );
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "summary_failed",
        route: "/api/summary",
        method: "GET",
        error: error instanceof Error ? error.message : String(error),
        user_id: ctx.user_id,
        fix_suggestion:
          "Confirm withUserContext bound request.user_id (RLS denies all rows otherwise), the household has a babies row, and households.timezone/day_start_hour are valid for getDayWindow.",
      }),
    );
    return NextResponse.json({ ok: false, error: "summary_failed" }, { status: 500 });
  }
}
