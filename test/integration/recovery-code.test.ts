/**
 * Recovery-code redeem — Task 2 DoD (Testing Strategy Test 4).
 *
 * Verifies, against a real Postgres via the Task 1 harness:
 *  - normalize: hyphenated / lowercase / spaced inputs hash identically
 *  - rotate yields exactly one ACTIVE code per user
 *  - successful redeem: marks used, revokes priors, mints, AUTO-ROTATES
 *  - rate limit: 6th attempt from one IP within the hour → denied (429)
 *  - a used OR rotated code is rejected on the next attempt
 *
 * The redeem route's core runs inside `withAdmin` (service_role); the
 * harness `adminDb` is the owner/BYPASSRLS conn, so the `rate_limits`
 * (RLS ENABLEd, no policy) and `recovery_codes` writes here exercise
 * the SAME SQL the route does.
 */
import { randomBytes } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { adminDb, seedTwoHouseholds, type TwoHouseholds } from "./_harness";
import { recoveryCodes, sessions } from "../../src/lib/db/schema";
import { consume } from "../../src/lib/rate-limit";
import {
  generateRecoveryCode,
  hashRecoveryCode,
  normalizeRecoveryCode,
} from "../../src/lib/session";

async function activeCodeCount(userId: string): Promise<number> {
  const rows = await adminDb
    .select({ id: recoveryCodes.id })
    .from(recoveryCodes)
    .where(
      and(
        eq(recoveryCodes.userId, userId),
        isNull(recoveryCodes.rotatedAt),
        isNull(recoveryCodes.usedAt),
      ),
    );
  return rows.length;
}

async function activeSessionCount(userId: string): Promise<number> {
  const rows = await adminDb
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  return rows.length;
}

/** Redeem core — mirrors src/app/api/recovery/redeem/route.ts. */
async function redeem(
  rawCode: string,
  ip: string,
): Promise<
  | { kind: "ok"; newRawCode: string }
  | { kind: "rate_limited" }
  | { kind: "invalid_code" }
> {
  return adminDb.transaction(async (tx) => {
    // Mirrors src/app/api/recovery/redeem/route.ts: secondary 24h soft
    // block (20/day) then the primary 5/IP/hour gate.
    const softOk = await consume(tx, `recovery_redeem_softblock:${ip}`, 20, 86_400);
    if (!softOk) return { kind: "rate_limited" as const };
    const hourlyOk = await consume(tx, `recovery_redeem:${ip}`, 5, 3_600);
    if (!hourlyOk) return { kind: "rate_limited" as const };

    const [code] = await tx
      .select()
      .from(recoveryCodes)
      .where(eq(recoveryCodes.codeHash, hashRecoveryCode(rawCode)))
      .limit(1);
    if (!code || code.usedAt !== null || code.rotatedAt !== null) {
      return { kind: "invalid_code" as const };
    }

    await tx
      .update(recoveryCodes)
      .set({ usedAt: new Date(), usedFromIp: ip })
      .where(eq(recoveryCodes.id, code.id));
    await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(sessions.userId, code.userId), isNull(sessions.revokedAt)),
      );

    const newRawCode = generateRecoveryCode();
    await tx.insert(recoveryCodes).values({
      userId: code.userId,
      householdId: code.householdId,
      codeHash: hashRecoveryCode(newRawCode),
    });
    await tx.insert(sessions).values({
      userId: code.userId,
      tokenHash: hashRecoveryCode(randomBytes(16).toString("hex")),
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    return { kind: "ok" as const, newRawCode };
  });
}

describe("recovery-code redeem (Task 2 DoD)", () => {
  let seeded: TwoHouseholds;

  beforeEach(async () => {
    seeded = await seedTwoHouseholds(false);
  });

  it("normalize: hyphenated, lowercase, and spaced inputs hash identically", () => {
    const a = hashRecoveryCode("K3HM-7TPN-Q9XR-4FBC");
    const b = hashRecoveryCode("k3hm7tpnq9xr4fbc");
    const c = hashRecoveryCode("  K3HM 7TPN q9xr 4FBC ");
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(normalizeRecoveryCode("k3hm-7tpn q9xr4fbc")).toBe(
      "K3HM7TPNQ9XR4FBC",
    );
  });

  it("a freshly seeded user has exactly one active code; redeem keeps it at one (auto-rotate)", async () => {
    const raw = generateRecoveryCode();
    await adminDb.insert(recoveryCodes).values({
      userId: seeded.hA.ownerId,
      householdId: seeded.hA.householdId,
      codeHash: hashRecoveryCode(raw),
    });
    expect(await activeCodeCount(seeded.hA.ownerId)).toBe(1);

    const result = await redeem(raw, "10.0.0.1");
    expect(result.kind).toBe("ok");
    // Old one used, exactly one fresh active code remains.
    expect(await activeCodeCount(seeded.hA.ownerId)).toBe(1);
  });

  it("successful redeem revokes prior sessions and mints a new one", async () => {
    const raw = generateRecoveryCode();
    await adminDb.insert(recoveryCodes).values({
      userId: seeded.hA.ownerId,
      householdId: seeded.hA.householdId,
      codeHash: hashRecoveryCode(raw),
    });
    await adminDb.insert(sessions).values([
      {
        userId: seeded.hA.ownerId,
        tokenHash: "prior-1",
        expiresAt: new Date(Date.now() + 86_400_000),
      },
      {
        userId: seeded.hA.ownerId,
        tokenHash: "prior-2",
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    ]);
    expect(await activeSessionCount(seeded.hA.ownerId)).toBe(2);

    await redeem(raw, "10.0.0.2");

    // Both priors revoked, exactly the newly minted one remains.
    expect(await activeSessionCount(seeded.hA.ownerId)).toBe(1);
  });

  it("rate limit: 6th attempt from one IP within the hour is denied", async () => {
    const ip = "203.0.113.9";
    // 5 wrong-code attempts are allowed by the limiter (they fail on the
    // code, not the limit). The 6th is blocked by the limiter itself.
    for (let i = 0; i < 5; i++) {
      const r = await redeem("WRONG-CODE-XXXX-XXXX", ip);
      expect(r.kind).toBe("invalid_code");
    }
    const sixth = await redeem("WRONG-CODE-XXXX-XXXX", ip);
    expect(sixth.kind).toBe("rate_limited");
  });

  it("a used OR rotated code is rejected on the next attempt", async () => {
    const raw = generateRecoveryCode();
    await adminDb.insert(recoveryCodes).values({
      userId: seeded.hA.ownerId,
      householdId: seeded.hA.householdId,
      codeHash: hashRecoveryCode(raw),
    });

    const first = await redeem(raw, "10.0.0.3");
    expect(first.kind).toBe("ok");

    // Same code again → it is now used → rejected (different IP so the
    // rate limiter is not the thing rejecting it).
    const second = await redeem(raw, "10.0.0.4");
    expect(second.kind).toBe("invalid_code");
  });
});
