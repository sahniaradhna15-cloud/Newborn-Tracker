/**
 * `POST /api/diapers` (session) — the PWA DiaperForm / QuickLogBar endpoint.
 * Maps the flat body into the canonical {@link InboundEvent} and calls
 * {@link recordEvent} (single write path). Returns the inserted row + `say`.
 *
 * `GET /api/diapers` — today's diapers for the active baby.
 *
 * Mutations pass through the CSRF/Origin middleware.
 */
import { NextResponse, type NextRequest } from "next/server";
import { desc, gte } from "drizzle-orm";

import { diaperEvents } from "@/lib/db/schema";
import { phase1DayStart, recordEvent } from "@/lib/record-event";
import { InboundEvent } from "@/lib/voice-parser";
import { withAuth } from "@/lib/with-auth";
import { withUserContext } from "@/lib/with-user-context";
import { eq } from "drizzle-orm";

const FAIL_SAY = "Sorry, that didn't work.";

export async function POST(req: NextRequest) {
  const ctx = await withAuth(req);
  if (!ctx) {
    return NextResponse.json(
      { ok: false, error: "unauthorized", say: FAIL_SAY },
      { status: 401 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json", say: FAIL_SAY },
      { status: 400 },
    );
  }

  const parsed = InboundEvent.safeParse({
    client_uuid: body.client_uuid,
    source: "pwa",
    occurred_at: body.occurred_at,
    note: body.note || undefined,
    event: {
      type: "diaper",
      pee: body.pee === true,
      poop: body.poop === true,
    },
  });
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
    const [row] = await withUserContext(ctx.user_id, (tx) =>
      tx
        .select()
        .from(diaperEvents)
        .where(eq(diaperEvents.id, result.event_id))
        .limit(1),
    );
    return NextResponse.json({
      ok: true,
      status: result.status,
      event_id: result.event_id,
      say: result.say,
      diaper: row ?? null,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "record_event_failed",
        route: "/api/diapers",
        error: error instanceof Error ? error.message : String(error),
        user_id: ctx.user_id,
        fix_suggestion:
          "Check diaper_events_presence_chk (pee OR poop) and that withUserContext bound request.user_id.",
      }),
    );
    return NextResponse.json(
      { ok: false, error: "record_failed", say: FAIL_SAY },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  const ctx = await withAuth(req);
  if (!ctx) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const dayStart = phase1DayStart(new Date());
  const rows = await withUserContext(ctx.user_id, (tx) =>
    tx
      .select()
      .from(diaperEvents)
      .where(gte(diaperEvents.occurredAt, dayStart))
      .orderBy(desc(diaperEvents.occurredAt)),
  );
  return NextResponse.json({ ok: true, diapers: rows });
}
