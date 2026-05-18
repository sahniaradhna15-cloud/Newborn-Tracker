/**
 * `PATCH /api/settings/household` (session, OWNER only) — update the
 * household's `day_start_hour`, `timezone`, and/or `name`.
 *
 * Owner gate mirrors `transfer-ownership`: the caller's `household_members`
 * row is read inside `withUserContext`; a non-owner gets 403. The update and
 * its audit row commit atomically.
 *
 * NOTE (integration follow-up): the values are persisted here, but the
 * day-window math (`record-event.ts` / `day-summary.ts`) still reads the
 * module constants `America/Chicago` + hour 4. Consuming the per-household
 * values in those committed shared-spine files is a coordinated follow-up
 * outside this task's file set — see the Phase 3 plan note.
 *
 * Mutation → CSRF/Origin middleware applies.
 */
import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { toAuditJson, writeAudit } from "@/lib/audit";
import { households, householdMembers } from "@/lib/db/schema";
import { withAuth } from "@/lib/with-auth";
import { withUserContext } from "@/lib/with-user-context";

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const Patch = z
  .object({
    day_start_hour: z.coerce.number().int().min(0).max(23).optional(),
    timezone: z
      .string()
      .min(1)
      .max(64)
      .refine(isValidTimeZone, { message: "Unknown IANA time zone" })
      .optional(),
    name: z.string().min(1).max(120).optional(),
  })
  .refine(
    (p) =>
      p.day_start_hour !== undefined ||
      p.timezone !== undefined ||
      p.name !== undefined,
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
      if (caller?.role !== "owner") return { error: "forbidden" as const };

      const [before] = await tx
        .select()
        .from(households)
        .where(eq(households.id, ctx.household_id))
        .limit(1);
      if (!before) return { error: "not_found" as const };

      const [after] = await tx
        .update(households)
        .set({
          ...(p.day_start_hour !== undefined
            ? { dayStartHour: p.day_start_hour }
            : {}),
          ...(p.timezone !== undefined ? { timezone: p.timezone } : {}),
          ...(p.name !== undefined ? { name: p.name } : {}),
        })
        .where(eq(households.id, ctx.household_id))
        .returning();

      await writeAudit(tx, {
        actor_user_id: ctx.user_id,
        household_id: ctx.household_id,
        kind: "household.updated",
        entity_table: "households",
        entity_id: ctx.household_id,
        before: toAuditJson(before),
        after: toAuditJson(after),
      });
      return { household: after };
    });

    if ("error" in result) {
      const status = result.error === "forbidden" ? 403 : 404;
      return NextResponse.json(
        { ok: false, error: result.error },
        { status },
      );
    }
    return NextResponse.json({ ok: true, household: result.household });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "household_settings_update_failed",
        route: "/api/settings/household",
        error: error instanceof Error ? error.message : String(error),
        user_id: ctx.user_id,
        household_id: ctx.household_id,
        fix_suggestion:
          "Caller must be owner; households RLS requires the row be in caller's household and withUserContext bound request.user_id.",
      }),
    );
    return NextResponse.json(
      { ok: false, error: "household_settings_update_failed" },
      { status: 500 },
    );
  }
}
