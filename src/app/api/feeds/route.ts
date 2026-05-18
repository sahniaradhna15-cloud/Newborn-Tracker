/**
 * `POST /api/feeds` (session) — the PWA FeedForm endpoint. Maps the flat form
 * body into the canonical {@link InboundEvent} and calls {@link recordEvent}
 * (the single write path — no direct feed_events INSERT here). Returns the
 * inserted row plus `say`.
 *
 * `GET /api/feeds` — today's feeds for the active baby (shape ready for the
 * Phase 2 EventList).
 *
 * Mutations pass through the CSRF/Origin middleware (Origin must match
 * NEXT_PUBLIC_APP_URL and X-Requested-With: fetch).
 */
import { NextResponse, type NextRequest } from "next/server";
import { desc, eq, gte } from "drizzle-orm";

import { feedEvents } from "@/lib/db/schema";
import { currentDayStart, recordEvent } from "@/lib/record-event";
import { InboundEvent } from "@/lib/voice-parser";
import { withAuth } from "@/lib/with-auth";
import { withUserContext } from "@/lib/with-user-context";

const FAIL_SAY = "Sorry, that didn't work.";

function num(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

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

  const kind = body.kind;
  const event =
    kind === "nursing"
      ? { type: "feed", kind, side: body.side, duration_min: num(body.duration_min) }
      : {
          type: "feed",
          kind,
          volume_oz: num(body.volume_oz),
          ...(num(body.wasted_oz) !== undefined
            ? { wasted_oz: num(body.wasted_oz) }
            : {}),
        };

  const parsed = InboundEvent.safeParse({
    client_uuid: body.client_uuid,
    source: "pwa",
    occurred_at: body.occurred_at,
    note: body.note || undefined,
    event,
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
        .from(feedEvents)
        .where(eq(feedEvents.id, result.event_id))
        .limit(1),
    );
    return NextResponse.json({
      ok: true,
      status: result.status,
      event_id: result.event_id,
      say: result.say,
      feed: row ?? null,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "record_event_failed",
        route: "/api/feeds",
        error: error instanceof Error ? error.message : String(error),
        user_id: ctx.user_id,
        fix_suggestion:
          "Check feed_events variant CHECK (nursing needs side+duration; bottle needs volume) and that withUserContext bound request.user_id.",
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
  const dayStart = currentDayStart(new Date());
  const rows = await withUserContext(ctx.user_id, (tx) =>
    tx
      .select()
      .from(feedEvents)
      .where(gte(feedEvents.occurredAt, dayStart))
      .orderBy(desc(feedEvents.occurredAt)),
  );
  return NextResponse.json({ ok: true, feeds: rows });
}
