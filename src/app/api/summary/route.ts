/**
 * `GET /api/summary` (session) — the "is baby getting enough today?" rollup.
 * Thin HTTP wrapper over the shared {@link getDaySummary}; the dashboard
 * page calls the same function directly (server-side) so the two never drift.
 *
 * `?days=N` (default 1). N=1 → the existing single-payload shape, byte-for-
 * byte UNCHANGED (no `days` array, no envelope) so Phase 1 callers keep
 * working. N>1 → `{ ok, days: DaySummaryPayload[] }` from the shared
 * {@link getRangeSummary} (history + pediatrician PDF), newest-first.
 */
import { NextResponse, type NextRequest } from "next/server";

import { getDaySummary, getRangeSummary } from "@/lib/day-summary";
import { withAuth } from "@/lib/with-auth";

const MAX_RANGE_DAYS = 31;

function parseDays(raw: string | null): number {
  if (raw === null) return 1;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return 1;
  return Math.min(n, MAX_RANGE_DAYS);
}

export async function GET(req: NextRequest) {
  const ctx = await withAuth(req);
  if (!ctx) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const days = parseDays(req.nextUrl.searchParams.get("days"));

  try {
    if (days > 1) {
      const now = new Date();
      const from = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
      const range = await getRangeSummary(ctx.user_id, ctx.household_id, from, now);
      if (!range) {
        return NextResponse.json({ ok: false, error: "no_active_baby" }, { status: 404 });
      }
      console.info(
        JSON.stringify({
          event: "summary_range",
          route: "/api/summary",
          method: "GET",
          status: "ok",
          days,
          user_id: ctx.user_id,
          household_id: ctx.household_id,
        }),
      );
      return NextResponse.json({ ok: true, days: range.days });
    }

    const result = await getDaySummary(ctx.user_id, ctx.household_id, new Date());
    if (!result) {
      return NextResponse.json({ ok: false, error: "no_active_baby" }, { status: 404 });
    }

    console.info(
      JSON.stringify({
        event: "summary",
        route: "/api/summary",
        method: "GET",
        status: "ok",
        user_id: ctx.user_id,
        household_id: ctx.household_id,
      }),
    );
    return NextResponse.json({ ok: true, ...result.summary });
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
