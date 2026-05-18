/**
 * `GET /api/summary` (session) — the "is baby getting enough today?" rollup.
 * Thin HTTP wrapper over the shared {@link getDaySummary}; the dashboard
 * page calls the same function directly (server-side) so the two never drift.
 */
import { NextResponse, type NextRequest } from "next/server";

import { getDaySummary } from "@/lib/day-summary";
import { withAuth } from "@/lib/with-auth";

export async function GET(req: NextRequest) {
  const ctx = await withAuth(req);
  if (!ctx) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
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
