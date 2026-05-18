/**
 * `POST /api/access-links` (session, ANY member) — mint a peer-recovery
 * link for a co-member ("Mom lost her phone, Dad gets her back in",
 * Decision #1 / TECHNICAL_SPEC §4.5.1, Risk R10).
 *
 * Authority layers:
 *   1. DB: `invites_peer_recovery_insert` RLS only permits a
 *      `target_user_id IS NOT NULL` INSERT when BOTH the household and
 *      the target user are in the caller's household.
 *   2. DB: `invites_active_target_idx` UNIQUE(target_user_id) WHERE
 *      not-yet-accepted enforces "at most one outstanding link per
 *      target" — we surface its unique violation as a friendly 409
 *      rather than re-checking in app code (the DB is the source of
 *      truth, per the plan's Reconciliation Notes).
 *
 * The session-revocation ASYMMETRY (additive vs. revoking) is decided
 * at ACCEPT time, not here — see /api/invites/[token]/accept and
 * CLAUDE.md §11.5. This route only mints the link.
 *
 * 24h expiry (shorter than a new-caregiver invite — it is a recovery
 * action, not an open enrollment).
 */
import { createHash, randomBytes } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { toAuditJson, writeAudit } from "@/lib/audit";
import { householdMembers, invites } from "@/lib/db/schema";
import { withAuth } from "@/lib/with-auth";
import { withUserContext } from "@/lib/with-user-context";

const Body = z.object({ for_user_id: z.uuid() });

const ACCESS_LINK_TTL_MS = 24 * 60 * 60 * 1000;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

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
  const forUserId = parsed.data.for_user_id;

  const rawToken = randomBytes(32).toString("base64url");

  try {
    const result = await withUserContext(ctx.user_id, async (tx) => {
      // The target must be a member of the caller's household. RLS would
      // also reject the insert, but this gives a clean 403 + message.
      const [targetMembership] = await tx
        .select({ displayName: householdMembers.displayName })
        .from(householdMembers)
        .where(
          and(
            eq(householdMembers.userId, forUserId),
            eq(householdMembers.householdId, ctx.household_id),
          ),
        )
        .limit(1);
      if (!targetMembership) {
        return { error: "not_a_member" as const };
      }

      const expiresAt = new Date(Date.now() + ACCESS_LINK_TTL_MS);
      const [row] = await tx
        .insert(invites)
        .values({
          householdId: ctx.household_id,
          tokenHash: sha256(rawToken),
          role: "caregiver",
          displayName: targetMembership.displayName,
          targetUserId: forUserId,
          expiresAt,
          createdBy: ctx.user_id,
        })
        .returning({ id: invites.id, expiresAt: invites.expiresAt });

      await writeAudit(tx, {
        actor_user_id: ctx.user_id,
        household_id: ctx.household_id,
        kind: "access_link.issued",
        entity_table: "invites",
        entity_id: row.id,
        before: null,
        after: toAuditJson({
          invite_id: row.id,
          target_user_id: forUserId,
          expires_at: row.expiresAt,
        }),
      });
      return { invite: row };
    });

    if ("error" in result) {
      return NextResponse.json(
        { ok: false, error: "target_not_in_household" },
        { status: 403 },
      );
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
    return NextResponse.json({
      ok: true,
      url: `${appUrl}/i/${rawToken}`,
      expires_at: result.invite.expiresAt,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        {
          ok: false,
          error: "outstanding_link_exists",
          message:
            "There is already an unused recovery link for that person. It must be used or expire before sending another.",
        },
        { status: 409 },
      );
    }
    console.error(
      JSON.stringify({
        event: "access_link_mint_failed",
        route: "/api/access-links",
        error: error instanceof Error ? error.message : String(error),
        user_id: ctx.user_id,
        household_id: ctx.household_id,
        fix_suggestion:
          "Check invites_peer_recovery_insert RLS (target must be a co-member) and the invites_active_target_idx unique index; withUserContext must bind request.user_id.",
      }),
    );
    return NextResponse.json(
      { ok: false, error: "access_link_mint_failed" },
      { status: 500 },
    );
  }
}
