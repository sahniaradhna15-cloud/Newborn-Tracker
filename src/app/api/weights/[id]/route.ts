/**
 * `PATCH /api/weights/:id` — edit a weight reading (occurred_at / weight_oz
 * / note). `DELETE /api/weights/:id` removes it.
 *
 * Authorization is RLS, not an app check: `weight_events` is household-scoped,
 * so inside `withUserContext` a row from another household is invisible and a
 * miss is reported as 404. After any change the denormalized
 * `babies.current_weight_oz` cache is re-derived via the single
 * {@link recomputeBabyCurrentWeight} helper — deleting the newest reading
 * correctly rolls the cache back to the prior one. Each mutation writes an
 * audit row (CLAUDE.md §11.4).
 *
 * Both are mutations → CSRF/Origin middleware applies.
 */
import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { toAuditJson, writeAudit } from "@/lib/audit";
import { weightEvents } from "@/lib/db/schema";
import { round1 } from "@/lib/record-event";
import { recomputeBabyCurrentWeight } from "@/lib/weight-cache";
import { withAuth } from "@/lib/with-auth";
import { withUserContext } from "@/lib/with-user-context";

const Patch = z
  .object({
    occurred_at: z.iso.datetime().optional(),
    weight_oz: z.coerce.number().positive().max(9999.9).optional(),
    note: z.string().max(500).nullable().optional(),
  })
  .refine(
    (p) =>
      p.occurred_at !== undefined ||
      p.weight_oz !== undefined ||
      p.note !== undefined,
    { message: "Nothing to update" },
  );

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const ctx = await withAuth(req);
  if (!ctx) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ ok: false, error: "bad_id" }, { status: 400 });
  }
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "validation_failed", details: parsed.error.issues },
      { status: 400 },
    );
  }
  const p = parsed.data;

  try {
    const result = await withUserContext(ctx.user_id, async (tx) => {
      const [existing] = await tx
        .select()
        .from(weightEvents)
        .where(eq(weightEvents.id, id))
        .limit(1);
      if (!existing) return { notFound: true as const };

      const [row] = await tx
        .update(weightEvents)
        .set({
          ...(p.occurred_at ? { occurredAt: new Date(p.occurred_at) } : {}),
          ...(p.weight_oz !== undefined
            ? { weightOz: round1(p.weight_oz) }
            : {}),
          ...(p.note !== undefined ? { note: p.note } : {}),
        })
        .where(eq(weightEvents.id, id))
        .returning();

      await recomputeBabyCurrentWeight(tx, row.babyId);
      await writeAudit(tx, {
        actor_user_id: ctx.user_id,
        household_id: ctx.household_id,
        kind: "weight.updated",
        entity_table: "weight_events",
        entity_id: row.id,
        before: toAuditJson(existing),
        after: toAuditJson(row),
      });
      return { row };
    });

    if ("notFound" in result) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, weight: result.row });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "weight_update_failed",
        route: "/api/weights/[id]",
        error: error instanceof Error ? error.message : String(error),
        user_id: ctx.user_id,
        fix_suggestion:
          "Check weight_events RLS scope and that withUserContext bound request.user_id; weight_oz must fit numeric(5,1).",
      }),
    );
    return NextResponse.json(
      { ok: false, error: "weight_update_failed" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const ctx = await withAuth(req);
  if (!ctx) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ ok: false, error: "bad_id" }, { status: 400 });
  }

  try {
    const result = await withUserContext(ctx.user_id, async (tx) => {
      const [existing] = await tx
        .select()
        .from(weightEvents)
        .where(eq(weightEvents.id, id))
        .limit(1);
      if (!existing) return { notFound: true as const };

      await tx.delete(weightEvents).where(eq(weightEvents.id, id));
      await recomputeBabyCurrentWeight(tx, existing.babyId);
      await writeAudit(tx, {
        actor_user_id: ctx.user_id,
        household_id: ctx.household_id,
        kind: "weight.deleted",
        entity_table: "weight_events",
        entity_id: existing.id,
        before: toAuditJson(existing),
        after: null,
      });
      return { deleted: true as const };
    });

    if ("notFound" in result) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "weight_delete_failed",
        route: "/api/weights/[id]",
        error: error instanceof Error ? error.message : String(error),
        user_id: ctx.user_id,
        fix_suggestion:
          "Check weight_events RLS scope and that withUserContext bound request.user_id.",
      }),
    );
    return NextResponse.json(
      { ok: false, error: "weight_delete_failed" },
      { status: 500 },
    );
  }
}
