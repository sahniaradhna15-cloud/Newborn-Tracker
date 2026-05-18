/**
 * `POST /api/voice` (bearer) — the LEGACY adapter into the canonical
 * write path (TECHNICAL_SPEC §5.3, CLAUDE.md §5.4).
 *
 * A Shortcut that cannot generate a client-side UUID v4 (no first-class
 * "Generate UUID" action in iOS Shortcuts) posts this flatter shape
 * instead of the full `InboundEvent`. We translate it into a canonical
 * `InboundEvent`, GENERATE a `client_uuid` server-side when absent
 * (the documented tradeoff: a flaky-network retry without a stable
 * `client_uuid` is no longer idempotent — acceptable for low-frequency
 * manual Shortcuts; see shortcuts/README.md "client_uuid step"), then
 * hand off to the ONE write path, `recordEvent`. No INSERTs here.
 *
 * Bearer-authed (api_tokens) → CSRF-exempt in middleware. Every
 * response carries `say` so a failed Shortcut can still speak.
 */
import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { recordEvent } from "@/lib/record-event";
import { InboundEvent } from "@/lib/voice-parser";
import { withAuth } from "@/lib/with-auth";

const FAIL_SAY = "Sorry, that didn't work.";

/**
 * The flat legacy wire shape. Intentionally permissive on the numeric
 * fields (Shortcuts sometimes send numbers as strings); the canonical
 * `InboundEvent` schema does the strict final validation after we lift
 * this into the discriminated `event` union.
 */
const LegacyBody = z.object({
  action: z.enum(["feed", "diaper"]),
  kind: z.enum(["nursing", "pumped", "formula"]).optional(),
  side: z.enum(["left", "right", "both"]).optional(),
  duration_min: z.coerce.number().optional(),
  volume_oz: z.coerce.number().optional(),
  wasted_oz: z.coerce.number().optional(),
  pee: z.boolean().optional(),
  poop: z.boolean().optional(),
  client_uuid: z.uuid().optional(),
  occurred_at: z.iso.datetime().optional(),
  note: z.string().max(500).optional(),
});
type LegacyBody = z.infer<typeof LegacyBody>;

/** Lift the flat legacy body into the canonical discriminated `event`. */
function toInboundEventObject(body: LegacyBody): Record<string, unknown> {
  if (body.action === "diaper") {
    return {
      type: "diaper",
      pee: body.pee ?? false,
      poop: body.poop ?? false,
    };
  }
  if (body.kind === "nursing") {
    return {
      type: "feed",
      kind: "nursing",
      side: body.side,
      duration_min: body.duration_min,
    };
  }
  // pumped | formula bottle feed
  return {
    type: "feed",
    kind: body.kind,
    volume_oz: body.volume_oz,
    ...(body.wasted_oz != null ? { wasted_oz: body.wasted_oz } : {}),
  };
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const ctx = await withAuth(req);
  if (!ctx) {
    return NextResponse.json(
      { ok: false, error: "unauthorized", say: FAIL_SAY },
      { status: 401 },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json", say: FAIL_SAY },
      { status: 400 },
    );
  }

  const legacy = LegacyBody.safeParse(raw);
  if (!legacy.success) {
    return NextResponse.json(
      {
        ok: false,
        error: "validation_failed",
        details: legacy.error.issues,
        say: FAIL_SAY,
      },
      { status: 400 },
    );
  }

  const candidate = {
    client_uuid: legacy.data.client_uuid ?? randomUUID(),
    source: "siri_shortcut" as const,
    occurred_at: legacy.data.occurred_at ?? new Date().toISOString(),
    event: toInboundEventObject(legacy.data),
    ...(legacy.data.note ? { note: legacy.data.note } : {}),
  };

  const parsed = InboundEvent.safeParse(candidate);
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
        route: "/api/voice",
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
        route: "/api/voice",
        error: error instanceof Error ? error.message : String(error),
        user_id: ctx.user_id,
        household_id: ctx.household_id,
        fix_suggestion:
          "Confirm withUserContext bound request.user_id (RLS) and the household has a baby row; a string number in volume_oz/duration_min is coerced here but the canonical schema still bounds it.",
      }),
    );
    return NextResponse.json(
      { ok: false, error: "record_failed", say: FAIL_SAY },
      { status: 500 },
    );
  }
}
