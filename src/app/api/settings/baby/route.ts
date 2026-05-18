/**
 * `PATCH /api/settings/baby` (session) — update the baby's profile.
 *
 * Authority is split (Phase 3 plan §Task 3 DoD):
 *  - `name` / `birth_date` / `birth_weight_oz` are OWNER-only.
 *  - `current_weight_oz` may be set by ANY caregiver. Setting it does not
 *    write `babies.current_weight_oz` directly — it INSERTs a `weight_events`
 *    row (so the growth chart sees the reading) and then re-derives the
 *    denormalized cache through the single {@link recomputeBabyCurrentWeight}
 *    helper, exactly like POST /api/weights.
 *
 * Everything runs in one `withUserContext` transaction so the profile edit,
 * the optional weight event, the cache recompute, and the audit rows commit
 * atomically.
 *
 * Mutation → CSRF/Origin middleware applies.
 */
import { NextResponse, type NextRequest } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { toAuditJson, writeAudit } from "@/lib/audit";
import { babies, householdMembers, weightEvents } from "@/lib/db/schema";
import { round1 } from "@/lib/record-event";
import { recomputeBabyCurrentWeight } from "@/lib/weight-cache";
import { withAuth } from "@/lib/with-auth";
import { withUserContext } from "@/lib/with-user-context";

const Patch = z
  .object({
    name: z.string().min(1).max(120).optional(),
    birth_date: z.iso.date().optional(),
    birth_weight_oz: z.coerce.number().positive().max(9999.9).optional(),
    current_weight_oz: z.coerce.number().positive().max(9999.9).optional(),
  })
  .refine(
    (p) =>
      p.name !== undefined ||
      p.birth_date !== undefined ||
      p.birth_weight_oz !== undefined ||
      p.current_weight_oz !== undefined,
    { message: "Nothing to update" },
  );

export async function PATCH(req: NextRequest) {
  const ctx = await withAuth(req);
  if (!ctx) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "validation_failed", details: parsed.error.issues },
      { status: 400 },
    );
  }
  const p = parsed.data;
  const touchesOwnerOnlyFields =
    p.name !== undefined ||
    p.birth_date !== undefined ||
    p.birth_weight_oz !== undefined;

  try {
    const result = await withUserContext(ctx.user_id, async (tx) => {
      const [caller] = await tx
        .select({ role: householdMembers.role })
        .from(householdMembers)
        .where(
          and(
            eq(householdMembers.userId, ctx.user_id),
            eq(householdMembers.householdId, ctx.household_id),
          ),
        )
        .limit(1);
      if (touchesOwnerOnlyFields && caller?.role !== "owner") {
        return { error: "forbidden" as const };
      }

      const [before] = await tx
        .select()
        .from(babies)
        .where(eq(babies.householdId, ctx.household_id))
        .orderBy(asc(babies.createdAt))
        .limit(1);
      if (!before) return { error: "not_found" as const };

      const ownerFieldSet = {
        ...(p.name !== undefined ? { name: p.name } : {}),
        ...(p.birth_date !== undefined
          ? { birthDate: new Date(p.birth_date) }
          : {}),
        ...(p.birth_weight_oz !== undefined
          ? { birthWeightOz: round1(p.birth_weight_oz) }
          : {}),
      };
      if (Object.keys(ownerFieldSet).length > 0) {
        await tx
          .update(babies)
          .set(ownerFieldSet)
          .where(eq(babies.id, before.id));
      }

      if (p.current_weight_oz !== undefined) {
        const [weightRow] = await tx
          .insert(weightEvents)
          .values({
            babyId: before.id,
            loggedBy: ctx.user_id,
            occurredAt: new Date(),
            weightOz: round1(p.current_weight_oz),
            note: "Set from settings",
            source: "pwa",
          })
          .returning();
        await recomputeBabyCurrentWeight(tx, before.id);
        await writeAudit(tx, {
          actor_user_id: ctx.user_id,
          household_id: ctx.household_id,
          kind: "weight.created",
          entity_table: "weight_events",
          entity_id: weightRow.id,
          before: null,
          after: toAuditJson(weightRow),
        });
      }

      const [after] = await tx
        .select()
        .from(babies)
        .where(eq(babies.id, before.id))
        .limit(1);

      await writeAudit(tx, {
        actor_user_id: ctx.user_id,
        household_id: ctx.household_id,
        kind: "baby.updated",
        entity_table: "babies",
        entity_id: before.id,
        before: toAuditJson(before),
        after: toAuditJson(after),
      });
      return { baby: after };
    });

    if ("error" in result) {
      const status = result.error === "forbidden" ? 403 : 404;
      return NextResponse.json(
        { ok: false, error: result.error },
        { status },
      );
    }
    return NextResponse.json({ ok: true, baby: result.baby });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "baby_settings_update_failed",
        route: "/api/settings/baby",
        error: error instanceof Error ? error.message : String(error),
        user_id: ctx.user_id,
        household_id: ctx.household_id,
        fix_suggestion:
          "Owner-only for name/birth_date/birth_weight_oz; babies + weight_events RLS require the row in caller's household and withUserContext bound request.user_id.",
      }),
    );
    return NextResponse.json(
      { ok: false, error: "baby_settings_update_failed" },
      { status: 500 },
    );
  }
}
