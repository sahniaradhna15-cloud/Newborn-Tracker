/**
 * `POST /api/mom-events` (session) — the postpartum mom tab endpoint. Maps a
 * flat, per-kind body into the canonical {@link InboundEvent} and calls
 * {@link recordEvent} (the single write path — `recordEvent` already inserts
 * the row, writes the `mom.created` audit row, enqueues the outbox event, and
 * builds `say`). No direct `mom_events` INSERT here.
 *
 * `GET /api/mom-events` — the caller's own mom events, last 30 days. The
 * `mom_events_self` RLS policy (`user_id = current_user_id()`, FOR ALL)
 * means a plain SELECT inside `withUserContext` can ONLY ever return the
 * caller's rows — a co-caregiver cannot read them. Privacy is enforced by
 * Postgres, not by a WHERE clause here.
 *
 * Mutations pass through the CSRF/Origin middleware.
 */
import { NextResponse, type NextRequest } from "next/server";
import { desc, gte } from "drizzle-orm";
import { z } from "zod";

import { momEvents } from "@/lib/db/schema";
import { recordEvent } from "@/lib/record-event";
import { InboundEvent } from "@/lib/voice-parser";
import { withAuth } from "@/lib/with-auth";
import { withUserContext } from "@/lib/with-user-context";

const FAIL_SAY = "Sorry, that didn't work.";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const MedicationPayload = z.object({
  name: z.string().min(1).max(120),
  dose_mg: z.coerce.number().positive().max(100000).optional(),
  note: z.string().max(500).optional(),
});
const MoodPayload = z.object({
  score: z.coerce.number().int().min(1).max(5),
  note: z.string().max(500).optional(),
});
const NotePayload = z.object({ text: z.string().min(1).max(2000) });
const PumpOnlyPayload = z.object({
  duration_min: z.coerce.number().int().positive().max(180),
  volume_oz: z.coerce.number().nonnegative().max(40).optional(),
  side: z.enum(["left", "right", "both"]).optional(),
});

const Base = { client_uuid: z.uuid(), occurred_at: z.iso.datetime() };
const MomPostBody = z.discriminatedUnion("kind", [
  z.object({ ...Base, kind: z.literal("medication"), payload: MedicationPayload }),
  z.object({ ...Base, kind: z.literal("mood"), payload: MoodPayload }),
  z.object({ ...Base, kind: z.literal("note"), payload: NotePayload }),
  z.object({ ...Base, kind: z.literal("pump_only"), payload: PumpOnlyPayload }),
]);

export async function POST(req: NextRequest) {
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

  const parsed = MomPostBody.safeParse(body);
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

  const inbound = InboundEvent.safeParse({
    client_uuid: parsed.data.client_uuid,
    source: "pwa",
    occurred_at: parsed.data.occurred_at,
    event: {
      type: "mom",
      kind: parsed.data.kind,
      payload: parsed.data.payload,
    },
  });
  if (!inbound.success) {
    return NextResponse.json(
      {
        ok: false,
        error: "validation_failed",
        details: inbound.error.issues,
        say: FAIL_SAY,
      },
      { status: 400 },
    );
  }

  try {
    const result = await recordEvent(ctx, inbound.data);
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
        route: "/api/mom-events",
        error: error instanceof Error ? error.message : String(error),
        user_id: ctx.user_id,
        fix_suggestion:
          "Check mom_events_kind_chk (medication|mood|note|pump_only), mom_events_self RLS WITH CHECK (user_id must equal request.user_id), and that withUserContext bound request.user_id.",
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
  const since = new Date(Date.now() - THIRTY_DAYS_MS);
  const rows = await withUserContext(ctx.user_id, (tx) =>
    tx
      .select()
      .from(momEvents)
      .where(gte(momEvents.occurredAt, since))
      .orderBy(desc(momEvents.occurredAt)),
  );
  return NextResponse.json({ ok: true, events: rows });
}
