/**
 * `POST /api/invites/[token]/accept` — accept an invite. No caller
 * session (the device opening the link has none yet), so the writes go
 * through the `adminDb` service-role conduit (CLAUDE.md §3/§8 — this
 * does NOT add a third SUPABASE_SERVICE_ROLE_KEY file; admin.ts is the
 * conduit). CSRF: X-Requested-With is exempted for this path in
 * middleware; same-origin Origin still required.
 *
 * Two shapes:
 *   - target_user_id IS NULL  → NEW caregiver. Create the user + a
 *     `household_members(role=caregiver)` row, mint a session.
 *   - target_user_id IS NOT NULL → PEER-RECOVERY re-link of an existing
 *     user. Here the single load-bearing security invariant applies:
 *
 *       CLAUDE.md §11.5 — asymmetric authority:
 *         shouldRevokePriorSessions =
 *           issuer.role === "owner" || issuer.user_id === target.user_id
 *
 *     issuer  = the user who CREATED the invite (`created_by`)
 *     target  = the user the invite is FOR (`target_user_id`)
 *
 *     true  → owner-issued or self-issued: revoke the target's prior
 *             sessions, then mint the new one (a clean device swap).
 *     false → a caregiver issued an ADDITIVE link to another member:
 *             mint only, DO NOT revoke (prevents hostile lockout,
 *             Risk R10). Verified by test/integration/peer-recovery.ts.
 */
import { createHash, randomBytes } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { and, eq, gt, isNull } from "drizzle-orm";

import { toAuditJson, writeAudit } from "@/lib/audit";
import { withAdmin } from "@/lib/db/admin";
import { householdMembers, invites, sessions, users } from "@/lib/db/schema";
import { setSessionCookie } from "@/lib/session";

const ONE_YEAR_SECONDS = 31_536_000;

type Ctx = { params: Promise<{ token: string }> };

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const { token } = await params;
  if (!token || token.length < 16) {
    return NextResponse.json({ ok: false, error: "invalid_invite" }, { status: 400 });
  }

  const clientIp =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  try {
    const outcome = await withAdmin(async (tx) => {
      const [invite] = await tx
        .select()
        .from(invites)
        .where(
          and(
            eq(invites.tokenHash, sha256(token)),
            isNull(invites.acceptedAt),
            gt(invites.expiresAt, new Date()),
          ),
        )
        .limit(1);
      if (!invite) return { error: "invalid_invite" as const };

      let sessionUserId: string;
      let revokedPrior = false;

      if (invite.targetUserId === null) {
        // ---- New caregiver -----------------------------------------
        const [newUser] = await tx
          .insert(users)
          .values({ displayName: invite.displayName ?? "Caregiver" })
          .returning({ id: users.id });
        await tx.insert(householdMembers).values({
          householdId: invite.householdId,
          userId: newUser.id,
          role: invite.role,
          displayName: invite.displayName,
        });
        sessionUserId = newUser.id;
      } else {
        // ---- Peer-recovery re-link of an existing user -------------
        const targetUserId = invite.targetUserId;

        const [issuer] = await tx
          .select({ role: householdMembers.role })
          .from(householdMembers)
          .where(
            and(
              eq(householdMembers.userId, invite.createdBy),
              eq(householdMembers.householdId, invite.householdId),
            ),
          )
          .limit(1);

        // CLAUDE.md §11.5 — THE single load-bearing expression.
        const shouldRevokePriorSessions =
          issuer?.role === "owner" || invite.createdBy === targetUserId;

        if (shouldRevokePriorSessions) {
          // Revoke on THIS tx (not the separate session.ts db client)
          // so a later rollback cannot leave the target locked out
          // while the invite stays unaccepted. `sessions` has no RLS.
          await tx
            .update(sessions)
            .set({ revokedAt: new Date() })
            .where(
              and(
                eq(sessions.userId, targetUserId),
                isNull(sessions.revokedAt),
              ),
            );
          revokedPrior = true;
        }
        sessionUserId = targetUserId;
      }

      const [accepted] = await tx
        .update(invites)
        .set({ acceptedAt: new Date(), acceptedBy: sessionUserId })
        .where(eq(invites.id, invite.id))
        .returning({ id: invites.id });

      // Mint the new session row inside the tx; the cookie (response
      // side) is set after commit.
      const sessionToken = randomBytes(32).toString("base64url");
      await tx.insert(sessions).values({
        userId: sessionUserId,
        tokenHash: sha256(sessionToken),
        deviceLabel: "Invite-accept device",
        expiresAt: new Date(Date.now() + ONE_YEAR_SECONDS * 1000),
      });

      await writeAudit(tx, {
        actor_user_id: sessionUserId,
        household_id: invite.householdId,
        kind: "access_link.redeemed",
        entity_table: "invites",
        entity_id: accepted.id,
        before: null,
        after: toAuditJson({
          invite_id: accepted.id,
          new_caregiver: invite.targetUserId === null,
          revoked_prior: revokedPrior,
        }),
        ip: clientIp,
      });

      return { sessionUserId, sessionToken };
    });

    if ("error" in outcome) {
      // One generic message — never leak which of invalid/expired/used.
      return NextResponse.json(
        {
          ok: false,
          error: "invalid_invite",
          message: "This link is invalid, expired, or already used.",
        },
        { status: 400 },
      );
    }

    // The session row was committed inside the tx; set the cookie now.
    await setSessionCookie(outcome.sessionToken);

    return NextResponse.json({ ok: true, redirect: "/" });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "invite_accept_failed",
        route: "/api/invites/[token]/accept",
        error: error instanceof Error ? error.message : String(error),
        fix_suggestion:
          "Check the invite is unaccepted+unexpired; adminDb (service_role) is the no-session write conduit; household_members insert must satisfy the role CHECK.",
      }),
    );
    return NextResponse.json(
      { ok: false, error: "invite_accept_failed" },
      { status: 500 },
    );
  }
}
