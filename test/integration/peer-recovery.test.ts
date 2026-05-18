/**
 * P0 — Risk R10: peer-recovery asymmetric-authority on accept.
 *
 * CLAUDE.md §11.5 (the single highest-risk line in the project):
 *
 *   shouldRevokePriorSessions =
 *     issuer.role === "owner" || issuer.user_id === target.user_id
 *
 * issuer  = the user who CREATED the invite (`created_by`)
 * target  = the user the invite is FOR (`target_user_id`)
 *
 * This suite reproduces EXACTLY the accept handler's decision against a
 * real Postgres (via the Task 1 harness) and asserts the session
 * outcome:
 *
 *  - caregiver issues link to OWNER  → ADDITIVE: owner's prior session
 *    survives, the new one is also valid (no hostile lockout).
 *  - owner issues link to caregiver  → REVOKING: caregiver's priors are
 *    dead, only the new session works.
 *  - self-issued link                → REVOKING: own priors dead.
 *  - caregiver targets a user OUTSIDE their household → RLS blocks the
 *    INSERT (`invites_peer_recovery_insert`).
 *  - caregiver attempts a target_user_id IS NULL (new-caregiver) invite
 *    → RLS blocks it (`invites_owner_new_caregiver_insert`).
 *
 * The accept handler itself sets a cookie (a Next server API unavailable
 * under Vitest node), so we test the load-bearing security core — the
 * §11.5 expression + revoke/mint — directly against the DB, which is
 * precisely what the handler does inside `withAdmin`.
 */
import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { adminDb, seedTwoHouseholds, type TwoHouseholds } from "./_harness";
import { householdMembers, invites, sessions } from "../../src/lib/db/schema";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Mints a session row directly (mirrors session.ts; sessions has no RLS). */
async function mint(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await adminDb.insert(sessions).values({
    userId,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  return token;
}

async function activeSessionCount(userId: string): Promise<number> {
  const rows = await adminDb
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  return rows.length;
}

async function seedPeerInvite(opts: {
  householdId: string;
  createdBy: string;
  targetUserId: string;
}): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  await adminDb.insert(invites).values({
    householdId: opts.householdId,
    tokenHash: sha256(raw),
    role: "caregiver",
    targetUserId: opts.targetUserId,
    expiresAt: new Date(Date.now() + 86_400_000),
    createdBy: opts.createdBy,
  });
  return raw;
}

/**
 * The accept handler's core, replicated verbatim (the §11.5 expression
 * is byte-identical to src/app/api/invites/[token]/accept/route.ts and
 * CLAUDE.md §11.5). Returns whether prior sessions were revoked.
 */
async function acceptPeerRecovery(rawToken: string): Promise<boolean> {
  return adminDb.transaction(async (tx) => {
    const [invite] = await tx
      .select()
      .from(invites)
      .where(
        and(
          eq(invites.tokenHash, sha256(rawToken)),
          isNull(invites.acceptedAt),
          gt(invites.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!invite || invite.targetUserId === null) {
      throw new Error("not a valid peer-recovery invite");
    }
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
      await tx
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(
          and(eq(sessions.userId, targetUserId), isNull(sessions.revokedAt)),
        );
    }
    await tx.insert(sessions).values({
      userId: targetUserId,
      tokenHash: sha256(randomBytes(32).toString("base64url")),
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await tx
      .update(invites)
      .set({ acceptedAt: new Date(), acceptedBy: targetUserId })
      .where(eq(invites.id, invite.id));

    return shouldRevokePriorSessions;
  });
}

describe("peer-recovery asymmetric authority (P0 R10, CLAUDE.md §11.5)", () => {
  let seeded: TwoHouseholds;

  beforeEach(async () => {
    seeded = await seedTwoHouseholds(false);
  });

  it("caregiver issues link to OWNER → ADDITIVE (owner's prior session survives)", async () => {
    await mint(seeded.hA.ownerId); // owner's existing device
    expect(await activeSessionCount(seeded.hA.ownerId)).toBe(1);

    const raw = await seedPeerInvite({
      householdId: seeded.hA.householdId,
      createdBy: seeded.caregiverInHA, // a caregiver issues it
      targetUserId: seeded.hA.ownerId, // for the owner
    });
    const revoked = await acceptPeerRecovery(raw);

    expect(revoked).toBe(false);
    // Prior session + the new one both live → additive, no lockout.
    expect(await activeSessionCount(seeded.hA.ownerId)).toBe(2);
  });

  it("owner issues link to caregiver → REVOKING (caregiver priors dead)", async () => {
    await mint(seeded.caregiverInHA);
    await mint(seeded.caregiverInHA);
    expect(await activeSessionCount(seeded.caregiverInHA)).toBe(2);

    const raw = await seedPeerInvite({
      householdId: seeded.hA.householdId,
      createdBy: seeded.hA.ownerId, // the owner issues it
      targetUserId: seeded.caregiverInHA,
    });
    const revoked = await acceptPeerRecovery(raw);

    expect(revoked).toBe(true);
    // Both priors revoked, only the freshly minted one remains.
    expect(await activeSessionCount(seeded.caregiverInHA)).toBe(1);
  });

  it("self-issued link → REVOKING (own priors dead)", async () => {
    await mint(seeded.caregiverInHA);
    expect(await activeSessionCount(seeded.caregiverInHA)).toBe(1);

    const raw = await seedPeerInvite({
      householdId: seeded.hA.householdId,
      createdBy: seeded.caregiverInHA, // issuer == target
      targetUserId: seeded.caregiverInHA,
    });
    const revoked = await acceptPeerRecovery(raw);

    expect(revoked).toBe(true);
    expect(await activeSessionCount(seeded.caregiverInHA)).toBe(1);
  });

  it("caregiver cannot mint a peer-recovery link for a user OUTSIDE their household (RLS)", async () => {
    // Bind the caregiver's RLS context on the app_runtime connection and
    // attempt the same INSERT the /api/access-links route would do.
    const { asUser } = await import("./_harness");
    await expect(
      asUser(seeded.caregiverInHA, async (tx) => {
        await tx.insert(invites).values({
          householdId: seeded.hA.householdId,
          tokenHash: sha256(randomBytes(32).toString("base64url")),
          role: "caregiver",
          targetUserId: seeded.hB.ownerId, // a user in the OTHER household
          expiresAt: new Date(Date.now() + 86_400_000),
          createdBy: seeded.caregiverInHA,
        });
      }),
    ).rejects.toThrow();
  });

  it("caregiver cannot mint a new-caregiver (target_user_id IS NULL) invite (RLS owner-only)", async () => {
    const { asUser } = await import("./_harness");
    await expect(
      asUser(seeded.caregiverInHA, async (tx) => {
        await tx.insert(invites).values({
          householdId: seeded.hA.householdId,
          tokenHash: sha256(randomBytes(32).toString("base64url")),
          role: "caregiver",
          targetUserId: null, // new-caregiver invite — owner-only
          expiresAt: new Date(Date.now() + 86_400_000),
          createdBy: seeded.caregiverInHA,
        });
      }),
    ).rejects.toThrow();
  });

  it("owner CAN mint a new-caregiver invite (RLS owner path allows it)", async () => {
    const { asUser } = await import("./_harness");
    const inserted = await asUser(seeded.hA.ownerId, async (tx) => {
      const [row] = await tx
        .insert(invites)
        .values({
          householdId: seeded.hA.householdId,
          tokenHash: sha256(randomBytes(32).toString("base64url")),
          role: "caregiver",
          targetUserId: null,
          expiresAt: new Date(Date.now() + 86_400_000),
          createdBy: seeded.hA.ownerId,
        })
        .returning({ id: invites.id });
      return row;
    });
    expect(inserted.id).toBeTruthy();
  });
});
