/**
 * `POST /api/weights` (session or bearer) — log a weight reading.
 *
 * Weights are NOT part of the canonical {@link InboundEvent} union, so they
 * do not flow through `recordEvent` (which only handles feed/diaper/mom).
 * Per the Phase 3 plan this route INSERTs into `weight_events` directly,
 * inside `withUserContext` so RLS scopes it to the caller's household, then
 * re-derives the denormalized `babies.current_weight_oz` cache via the
 * single {@link recomputeBabyCurrentWeight} helper and writes an audit row.
 *
 * Any caregiver may log a weight (no owner gate — plan §Task 3 DoD).
 *
 * Idempotency: a `client_uuid` (sent by the offline queue / WeightLogForm)
 * is deduped against `weight_events.client_uuid` so a replayed POST returns
 * the original row with `status: "duplicate"` instead of inserting twice —
 * the same contract `recordEvent` gives feeds/diapers, so `drainQueue` can
 * safely ack it.
 *
 * Mutations pass through the CSRF/Origin middleware.
 */
import { NextResponse, type NextRequest } from "next/server";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { toAuditJson, writeAudit } from "@/lib/audit";
import { babies, weightEvents } from "@/lib/db/schema";
import { round1 } from "@/lib/record-event";
import { recomputeBabyCurrentWeight } from "@/lib/weight-cache";
import { withAuth } from "@/lib/with-auth";
import { withUserContext } from "@/lib/with-user-context";

const FAIL_SAY = "Sorry, that didn't work.";

const PostBody = z.object({
  client_uuid: z.uuid().optional(),
  occurred_at: z.iso.datetime(),
  // numeric(5,1): 0.1 .. 9999.9 oz. Realistic newborn range is well inside.
  weight_oz: z.coerce.number().positive().max(9999.9),
  note: z.string().max(500).optional(),
});

function ouncesToSay(oz: number): string {
  const pounds = Math.floor(oz / 16);
  const remainder = Math.round((oz - pounds * 16) * 10) / 10;
  return `Logged weight: ${pounds} lb ${remainder} oz.`;
}

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

  const parsed = PostBody.safeParse(body);
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
  const input = parsed.data;

  try {
    const result = await withUserContext(ctx.user_id, async (tx) => {
      const [baby] = await tx
        .select({ id: babies.id })
        .from(babies)
        .where(eq(babies.householdId, ctx.household_id))
        .orderBy(asc(babies.createdAt))
        .limit(1);
      if (!baby) return { error: "no_baby" as const };

      if (input.client_uuid) {
        const [existing] = await tx
          .select()
          .from(weightEvents)
          .where(eq(weightEvents.clientUuid, input.client_uuid))
          .limit(1);
        if (existing) {
          return { status: "duplicate" as const, row: existing };
        }
      }

      const [row] = await tx
        .insert(weightEvents)
        .values({
          babyId: baby.id,
          loggedBy: ctx.user_id,
          occurredAt: new Date(input.occurred_at),
          weightOz: round1(input.weight_oz),
          note: input.note ?? null,
          source: "pwa",
          clientUuid: input.client_uuid ?? null,
        })
        .returning();

      await recomputeBabyCurrentWeight(tx, baby.id);
      await writeAudit(tx, {
        actor_user_id: ctx.user_id,
        household_id: ctx.household_id,
        kind: "weight.created",
        entity_table: "weight_events",
        entity_id: row.id,
        before: null,
        after: toAuditJson(row),
      });
      return { status: "accepted" as const, row };
    });

    if ("error" in result) {
      return NextResponse.json(
        { ok: false, error: result.error, say: FAIL_SAY },
        { status: 422 },
      );
    }

    return NextResponse.json({
      ok: true,
      status: result.status,
      event_id: result.row.id,
      weight: result.row,
      say: ouncesToSay(Number(result.row.weightOz)),
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "weight_create_failed",
        route: "/api/weights",
        error: error instanceof Error ? error.message : String(error),
        user_id: ctx.user_id,
        household_id: ctx.household_id,
        fix_suggestion:
          "Check weight_events RLS (baby must be in caller's household) and that withUserContext bound request.user_id; weight_oz must fit numeric(5,1).",
      }),
    );
    return NextResponse.json(
      { ok: false, error: "weight_create_failed", say: FAIL_SAY },
      { status: 500 },
    );
  }
}
