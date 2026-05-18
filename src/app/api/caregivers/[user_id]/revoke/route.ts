/**
 * `POST /api/caregivers/[user_id]/revoke` (session, OWNER only) —
 * revoke ALL of a member's sessions (e.g. a caregiver who should no
 * longer have access). Self-revoke is rejected (an owner locking
 * themselves out is never intended; recovery is a separate flow).
 *
 * Authority: re-read the caller's role inside RLS and 403 unless
 * `owner`. The target must be a co-member of the same household.
 */
import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { toAuditJson, writeAudit } from "@/lib/audit";
import { householdMembers } from "@/lib/db/schema";
import { revokeAllUserSessions } from "@/lib/session";
import { withAuth } from "@/lib/with-auth";
import { withUserContext } from "@/lib/with-user-context";

type Ctx = { params: Promise<{ user_id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  const ctx = await withAuth(req);
  if (!ctx) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { user_id: targetUserId } = await params;
  if (!z.uuid().safeParse(targetUserId).success) {
    return NextResponse.json({ ok: false, error: "bad_id" }, { status: 400 });
  }
  if (targetUserId === ctx.user_id) {
    return NextResponse.json(
      { ok: false, error: "cannot_revoke_self" },
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
            eq(householdMembers.userId, targetUserId),
            eq(householdMembers.householdId, ctx.household_id),
          ),
        )
        .limit(1);
      if (!target) return { error: "not_a_member" as const };

      await writeAudit(tx, {
        actor_user_id: ctx.user_id,
        household_id: ctx.household_id,
        kind: "caregiver.revoked",
        entity_table: "household_members",
        entity_id: targetUserId,
        before: toAuditJson({ revoked_user_id: targetUserId }),
        after: null,
      });
      return { ok: true as const };
    });

    if ("error" in result) {
      const status = result.error === "forbidden" ? 403 : 404;
      return NextResponse.json({ ok: false, error: result.error }, { status });
    }

    // Session revocation is on the (RLS-free) `sessions` table; do it
    // after the audited authority check has committed.
    await revokeAllUserSessions(targetUserId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "caregiver_revoke_failed",
        route: "/api/caregivers/[user_id]/revoke",
        error: error instanceof Error ? error.message : String(error),
        user_id: ctx.user_id,
        household_id: ctx.household_id,
        fix_suggestion:
          "Caller must be household owner; target must be a co-member; withUserContext must bind request.user_id.",
      }),
    );
    return NextResponse.json(
      { ok: false, error: "caregiver_revoke_failed" },
      { status: 500 },
    );
  }
}
