/**
 * `PATCH /api/feeds/:id` — partial edit. Sets `locked_at = now()` so the
 * recordEvent merge-window skips this row forever after a manual correction
 * (CLAUDE.md §3 rule 1). `estimated_oz` is recomputed from the merged values
 * via the shared {@link estimateFeedOz} so totals stay consistent.
 *
 * `DELETE /api/feeds/:id` — hard delete (Phase 1; `event_audit` is wired in
 * Phase 2 Task 1). RLS confines both to the caller's household.
 *
 * Both are mutations → subject to the CSRF/Origin middleware.
 */
import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { feedEvents } from "@/lib/db/schema";
import { estimateFeedOz, round1 } from "@/lib/record-event";
import { withAuth } from "@/lib/with-auth";
import { withUserContext } from "@/lib/with-user-context";

const Patch = z.object({
  occurred_at: z.iso.datetime().optional(),
  side: z.enum(["left", "right", "both"]).optional(),
  duration_min: z.coerce.number().int().positive().max(180).optional(),
  volume_oz: z.coerce.number().positive().max(20).optional(),
  wasted_oz: z.coerce.number().nonnegative().max(20).optional(),
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

  const updated = await withUserContext(ctx.user_id, async (tx) => {
    const [existing] = await tx
      .select()
      .from(feedEvents)
      .where(eq(feedEvents.id, id))
      .limit(1);
    if (!existing) return null;

    const kind = existing.kind as "nursing" | "pumped" | "formula";
    const durationMin = p.duration_min ?? existing.durationMin ?? null;
    const volumeOz =
      p.volume_oz ?? (existing.volumeOz != null ? Number(existing.volumeOz) : null);
    const wastedOz =
      p.wasted_oz ?? (existing.wastedOz != null ? Number(existing.wastedOz) : null);

    const estimatedOz = estimateFeedOz({
      kind,
      duration_min: durationMin,
      volume_oz: volumeOz,
      wasted_oz: wastedOz,
    });

    const [row] = await tx
      .update(feedEvents)
      .set({
        ...(p.occurred_at ? { occurredAt: new Date(p.occurred_at) } : {}),
        ...(p.side ? { side: p.side } : {}),
        ...(p.duration_min != null ? { durationMin: p.duration_min } : {}),
        ...(p.volume_oz != null ? { volumeOz: round1(p.volume_oz) } : {}),
        ...(p.wasted_oz != null ? { wastedOz: round1(p.wasted_oz) } : {}),
        ...(p.note !== undefined ? { note: p.note } : {}),
        estimatedOz: round1(estimatedOz),
        lockedAt: new Date(),
      })
      .where(eq(feedEvents.id, id))
      .returning();
    return row;
  });

  if (!updated) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, feed: updated });
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
    tx.delete(feedEvents).where(eq(feedEvents.id, id)),
  );
  return new NextResponse(null, { status: 204 });
}
