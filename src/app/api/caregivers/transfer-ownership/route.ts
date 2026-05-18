/**
 * `POST /api/caregivers/transfer-ownership` (session, OWNER only) — in
 * ONE transaction, demote the caller (owner → caregiver) and promote
 * the target co-member (caregiver → owner). After this the caller can
 * no longer invite/revoke; the new owner can.
 *
 * Both UPDATEs and the audit row commit atomically — a half-applied
 * swap (two owners, or zero) must never be observable.
 */
import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { toAuditJson, writeAudit } from "@/lib/audit";
import { householdMembers } from "@/lib/db/schema";
import { withAuth } from "@/lib/with-auth";
import { withUserContext } from "@/lib/with-user-context";

const Body = z.object({ to_user_id: z.uuid() });

export async function POST(req: NextRequest) {
  const ctx = await withAuth(req);
  if (!ctx) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "validation_failed", details: parsed.error.issues },
      { status: 400 },
    );
  }
  const toUserId = parsed.data.to_user_id;
  if (toUserId === ctx.user_id) {
    return NextResponse.json(
      { ok: false, error: "already_owner" },
      { status: 400 },
    );
  }

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

      const [target] = await tx
        .select({ userId: householdMembers.userId })
        .from(householdMembers)
        .where(
          and(
            eq(householdMembers.userId, toUserId),
            eq(householdMembers.householdId, ctx.household_id),
          ),
        )
        .limit(1);
      if (!target) return { error: "not_a_member" as const };

      await tx
        .update(householdMembers)
        .set({ role: "caregiver" })
        .where(
          and(
            eq(householdMembers.userId, ctx.user_id),
            eq(householdMembers.householdId, ctx.household_id),
          ),
        );
      await tx
        .update(householdMembers)
        .set({ role: "owner" })
        .where(
          and(
            eq(householdMembers.userId, toUserId),
            eq(householdMembers.householdId, ctx.household_id),
          ),
        );

      await writeAudit(tx, {
        actor_user_id: ctx.user_id,
        household_id: ctx.household_id,
        kind: "ownership.transferred",
        entity_table: "household_members",
        entity_id: toUserId,
        before: toAuditJson({ owner_user_id: ctx.user_id }),
        after: toAuditJson({ owner_user_id: toUserId }),
      });
      return { ok: true as const };
    });

    if ("error" in result) {
      const status = result.error === "forbidden" ? 403 : 404;
      return NextResponse.json({ ok: false, error: result.error }, { status });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "ownership_transfer_failed",
        route: "/api/caregivers/transfer-ownership",
        error: error instanceof Error ? error.message : String(error),
        user_id: ctx.user_id,
        household_id: ctx.household_id,
        fix_suggestion:
          "Caller must currently be owner; target must be a co-member; both role UPDATEs run in one withUserContext tx (household_members_member RLS).",
      }),
    );
    return NextResponse.json(
      { ok: false, error: "ownership_transfer_failed" },
      { status: 500 },
    );
  }
}
