/**
 * `PATCH /api/diapers/:id` — partial edit. NOTE: `diaper_events` has no
 * `locked_at` column (and no merge-window in Phase 1, since it also lacks
 * `corroborating_sources`), so unlike feeds there is nothing to lock — the
 * merge-skip concern simply does not apply to diapers. We still guard the
 * `pee OR poop` invariant (diaper_events_presence_chk) with a clean 400
 * instead of letting the DB CHECK throw a 500.
 *
 * `DELETE /api/diapers/:id` — hard delete. RLS confines both to the
 * caller's household. Both write an `event_audit` row (PATCH:
 * before/after; DELETE: before/null) in the SAME tx as the mutation
 * (CLAUDE.md §11.4, Phase 2 Task 2). Both are mutations → CSRF/Origin
 * middleware applies.
 */
import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { toAuditJson, writeAudit } from "@/lib/audit";
import { diaperEvents } from "@/lib/db/schema";
import { withAuth } from "@/lib/with-auth";
import { withUserContext } from "@/lib/with-user-context";

const Patch = z.object({
  occurred_at: z.iso.datetime().optional(),
  pee: z.boolean().optional(),
  poop: z.boolean().optional(),
  note: z.string().max(500).nullable().optional(),
});

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

  const result = await withUserContext(ctx.user_id, async (tx) => {
    const [existing] = await tx
      .select()
      .from(diaperEvents)
      .where(eq(diaperEvents.id, id))
      .limit(1);
    if (!existing) return { error: "not_found" as const };

    const nextPee = p.pee ?? existing.pee;
    const nextPoop = p.poop ?? existing.poop;
    if (!nextPee && !nextPoop) return { error: "empty_diaper" as const };

    const [row] = await tx
      .update(diaperEvents)
      .set({
        ...(p.occurred_at ? { occurredAt: new Date(p.occurred_at) } : {}),
        ...(p.pee !== undefined ? { pee: p.pee } : {}),
        ...(p.poop !== undefined ? { poop: p.poop } : {}),
        ...(p.note !== undefined ? { note: p.note } : {}),
      })
      .where(eq(diaperEvents.id, id))
      .returning();

    await writeAudit(tx, {
      actor_user_id: ctx.user_id,
      household_id: ctx.household_id,
      kind: "diaper.updated",
      entity_table: "diaper_events",
      entity_id: row.id,
      before: toAuditJson(existing),
      after: toAuditJson(row),
    });
    return { row };
  });

  if ("error" in result) {
    if (result.error === "not_found")
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    return NextResponse.json(
      { ok: false, error: "diaper_must_be_pee_or_poop" },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true, diaper: result.row });
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
  const deleted = await withUserContext(ctx.user_id, async (tx) => {
    const [existing] = await tx
      .select()
      .from(diaperEvents)
      .where(eq(diaperEvents.id, id))
      .limit(1);
    if (!existing) return false;

    await tx.delete(diaperEvents).where(eq(diaperEvents.id, id));
    await writeAudit(tx, {
      actor_user_id: ctx.user_id,
      household_id: ctx.household_id,
      kind: "diaper.deleted",
      entity_table: "diaper_events",
      entity_id: id,
      before: toAuditJson(existing),
      after: null,
    });
    return true;
  });

  if (!deleted) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  return new NextResponse(null, { status: 204 });
}
