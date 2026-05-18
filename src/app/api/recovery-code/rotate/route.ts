/**
 * `POST /api/recovery-code/rotate` (session) — rotate the caller's
 * recovery code. In ONE transaction: mark the existing active code
 * rotated, INSERT a fresh one, audit. The raw new code is returned
 * exactly once (only its sha256 is stored — CLAUDE.md §13); the UI
 * shows it on a "save this" card and it can never be shown again.
 *
 * `recovery_codes_active_user_idx` (UNIQUE WHERE not-rotated AND
 * not-used) guarantees at most one active code per user — so we MUST
 * clear the old one in the same tx before inserting the new row.
 */
import { NextResponse, type NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";

import { toAuditJson, writeAudit } from "@/lib/audit";
import { householdMembers, recoveryCodes } from "@/lib/db/schema";
import { generateRecoveryCode, hashRecoveryCode } from "@/lib/session";
import { withAuth } from "@/lib/with-auth";
import { withUserContext } from "@/lib/with-user-context";

export async function POST(req: NextRequest) {
  const ctx = await withAuth(req);
  if (!ctx) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const rawCode = generateRecoveryCode();

  try {
    await withUserContext(ctx.user_id, async (tx) => {
      await tx
        .update(recoveryCodes)
        .set({ rotatedAt: new Date() })
        .where(
          and(
            eq(recoveryCodes.userId, ctx.user_id),
            isNull(recoveryCodes.rotatedAt),
            isNull(recoveryCodes.usedAt),
          ),
        );

      // household_id is required on recovery_codes; resolve the caller's.
      const [membership] = await tx
        .select({ householdId: householdMembers.householdId })
        .from(householdMembers)
        .where(eq(householdMembers.userId, ctx.user_id))
        .limit(1);

      const [row] = await tx
        .insert(recoveryCodes)
        .values({
          userId: ctx.user_id,
          householdId: membership?.householdId ?? ctx.household_id,
          codeHash: hashRecoveryCode(rawCode),
        })
        .returning({ id: recoveryCodes.id });

      await writeAudit(tx, {
        actor_user_id: ctx.user_id,
        household_id: ctx.household_id,
        kind: "recovery_code.rotated",
        entity_table: "recovery_codes",
        entity_id: row.id,
        before: null,
        after: toAuditJson({ recovery_code_id: row.id }),
      });
    });

    return NextResponse.json({ ok: true, code: rawCode });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "recovery_code_rotate_failed",
        route: "/api/recovery-code/rotate",
        error: error instanceof Error ? error.message : String(error),
        user_id: ctx.user_id,
        household_id: ctx.household_id,
        fix_suggestion:
          "The old active code must be set rotated_at in the SAME tx before the new INSERT or recovery_codes_active_user_idx UNIQUE fails; check recovery_codes_self RLS.",
      }),
    );
    return NextResponse.json(
      { ok: false, error: "recovery_code_rotate_failed" },
      { status: 500 },
    );
  }
}
