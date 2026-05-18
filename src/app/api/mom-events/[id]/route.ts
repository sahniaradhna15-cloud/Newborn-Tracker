/**
 * `PATCH /api/mom-events/:id` — edit one of the caller's own mom events
 * (occurred_at and/or payload; `kind` is immutable). `DELETE` removes it.
 *
 * Authorization is RLS, not an app check: the `mom_events_self` policy
 * (`user_id = current_user_id()`) makes another user's rows invisible inside
 * `withUserContext`, so a missing row is reported as 404 — that 404 doubles
 * as "not yours". A co-caregiver can never read, edit, or delete these.
 *
 * NOTE: no `writeAudit` here, unlike feeds/diapers `[id]`. The committed
 * `AuditKind` contract (src/lib/audit.ts, Phase 2) defines only `mom.created`
 * — there is intentionally no `mom.updated`/`mom.deleted`. Extending another
 * tab's committed shared-spine contract is out of this task's scope; the
 * plan's "audit row on each" is deferred to a coordinated AuditKind change.
 *
 * Both are mutations → CSRF/Origin middleware applies.
 */
import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { momEvents } from "@/lib/db/schema";
import { withAuth } from "@/lib/with-auth";
import { withUserContext } from "@/lib/with-user-context";

const Patch = z
  .object({
    occurred_at: z.iso.datetime().optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((p) => p.occurred_at !== undefined || p.payload !== undefined, {
    message: "Nothing to update",
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

  const updated = await withUserContext(ctx.user_id, async (tx) => {
    const [existing] = await tx
      .select()
      .from(momEvents)
      .where(eq(momEvents.id, id))
      .limit(1);
    if (!existing) return null;

    const [row] = await tx
      .update(momEvents)
      .set({
        ...(p.occurred_at ? { occurredAt: new Date(p.occurred_at) } : {}),
        ...(p.payload ? { payload: p.payload } : {}),
      })
      .where(eq(momEvents.id, id))
      .returning();
    return row;
  });

  if (!updated) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, event: updated });
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
  await withUserContext(ctx.user_id, (tx) =>
    tx.delete(momEvents).where(eq(momEvents.id, id)),
  );
  return new NextResponse(null, { status: 204 });
}
