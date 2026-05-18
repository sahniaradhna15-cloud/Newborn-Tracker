/**
 * `POST /api/events` — the canonical channel (Siri, Watch, future adapters).
 * Phase 1: bearer auth is stubbed in `withAuth`, so this is effectively
 * session-only for now; Phase 2 Task 2 wires the bearer path with no change
 * to this handler. CSRF-exempt in middleware (bearer, not cookie).
 *
 * Every response carries `say` (TECHNICAL_SPEC §5.4) so a failed Shortcut can
 * still speak something useful.
 */
import { NextResponse, type NextRequest } from "next/server";

import { recordEvent } from "@/lib/record-event";
import { InboundEvent } from "@/lib/voice-parser";
import { withAuth } from "@/lib/with-auth";

const FAIL_SAY = "Sorry, that didn't work.";

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const ctx = await withAuth(req);
  if (!ctx) {
    return NextResponse.json(
      { ok: false, error: "unauthorized", say: FAIL_SAY },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json", say: FAIL_SAY },
      { status: 400 },
    );
  }

  const parsed = InboundEvent.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: "validation_failed",
        details: parsed.error.issues,
        say: FAIL_SAY,
      },
      { status: 400 },
    );
  }

  try {
    const result = await recordEvent(ctx, parsed.data);
    console.info(
      JSON.stringify({
        event: "record_event",
        status: result.status,
        route: "/api/events",
        method: "POST",
        user_id: ctx.user_id,
        household_id: ctx.household_id,
        source: ctx.source,
        duration_ms: Date.now() - startedAt,
      }),
    );
    return NextResponse.json({
      ok: true,
      status: result.status,
      event_id: result.event_id,
      say: result.say,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "record_event_failed",
        route: "/api/events",
        error: error instanceof Error ? error.message : String(error),
        user_id: ctx.user_id,
        household_id: ctx.household_id,
        fix_suggestion:
          "Confirm withUserContext bound request.user_id (RLS) and the household has a baby row; check feed_events variant CHECK if a feed insert failed.",
      }),
    );
    return NextResponse.json(
      { ok: false, error: "record_failed", say: FAIL_SAY },
      { status: 500 },
    );
  }
}
