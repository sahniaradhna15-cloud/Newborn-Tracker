/**
 * `POST /api/recovery/redeem` — redeem a recovery code from a NO-SESSION
 * device (a lost/replaced phone, before anyone else could send an
 * access link). No auth; the unguessable ~80-bit code IS the
 * credential. Rate-limited 5/IP/hour, with a 24h soft block once the
 * hourly cap is tripped (CLAUDE.md §13). Writes go through the
 * `adminDb` service-role conduit (no session → no RLS context;
 * admin.ts is the only such conduit — this does NOT add a third
 * SUPABASE_SERVICE_ROLE_KEY file, CLAUDE.md §3/§8).
 *
 * On success, in one tx: mark the code used, revoke ALL the owner's
 * prior sessions (a recovery is a clean device takeover), mint a new
 * session, AUTO-ROTATE (insert a fresh code — TECHNICAL_SPEC §4.5.2),
 * audit. The freshly rotated raw code is returned exactly once.
 *
 * Errors are deliberately uniform ("invalid_code") so an attacker
 * cannot distinguish wrong vs. used vs. rotated.
 */
import { createHash, randomBytes } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { toAuditJson, writeAudit } from "@/lib/audit";
import { withAdmin } from "@/lib/db/admin";
import { recoveryCodes, sessions } from "@/lib/db/schema";
import { consume } from "@/lib/rate-limit";
import {
  generateRecoveryCode,
  hashRecoveryCode,
  setSessionCookie,
} from "@/lib/session";

const ONE_YEAR_SECONDS = 31_536_000;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const Body = z.object({ code: z.string().trim().min(1).max(64) });

// Primary gate: 5 attempts per IP per hour (CLAUDE.md §13). The 24h
// soft block is a SECONDARY, higher threshold so a legitimate user who
// hits the hourly cap a couple of times across a day is not punished
// for 24h, but sustained abuse (20 in a day) is hard-blocked for 24h.
const HOURLY_LIMIT = 5;
const HOUR_SECONDS = 60 * 60;
const SOFT_BLOCK_LIMIT = 20;
const SOFT_BLOCK_SECONDS = 24 * 60 * 60;
const EXAMPLE_FORMAT = "Example format: K3HM-7TPN-Q9XR-4FBC";

export async function POST(req: NextRequest) {
  const clientIp =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: "validation_failed",
        message: `Enter your recovery code. ${EXAMPLE_FORMAT}`,
      },
      { status: 400 },
    );
  }

  try {
    const outcome = await withAdmin(async (tx) => {
      // Secondary 24h soft block first: once 20 attempts accumulate in
      // a day from one IP, every further attempt is denied for 24h.
      const softOk = await consume(
        tx,
        `recovery_redeem_softblock:${clientIp}`,
        SOFT_BLOCK_LIMIT,
        SOFT_BLOCK_SECONDS,
      );
      if (!softOk) return { error: "rate_limited" as const };

      // Primary gate: 5 / IP / hour.
      const hourlyOk = await consume(
        tx,
        `recovery_redeem:${clientIp}`,
        HOURLY_LIMIT,
        HOUR_SECONDS,
      );
      if (!hourlyOk) return { error: "rate_limited" as const };

      const [code] = await tx
        .select()
        .from(recoveryCodes)
        .where(eq(recoveryCodes.codeHash, hashRecoveryCode(parsed.data.code)))
        .limit(1);
      if (!code || code.usedAt !== null || code.rotatedAt !== null) {
        return { error: "invalid_code" as const };
      }

      await tx
        .update(recoveryCodes)
        .set({ usedAt: new Date(), usedFromIp: clientIp })
        .where(eq(recoveryCodes.id, code.id));

      // Session revoke + mint MUST run on this tx (not the separate
      // session.ts db client) so a later rollback cannot leave the user
      // with revoked sessions but a still-valid old code. `sessions`
      // has no RLS, so the service-role tx writes it freely.
      await tx
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(
          and(eq(sessions.userId, code.userId), isNull(sessions.revokedAt)),
        );
      const sessionToken = randomBytes(32).toString("base64url");
      await tx.insert(sessions).values({
        userId: code.userId,
        tokenHash: sha256(sessionToken),
        deviceLabel: "Recovery device",
        expiresAt: new Date(Date.now() + ONE_YEAR_SECONDS * 1000),
      });

      const newRawCode = generateRecoveryCode();
      const [rotated] = await tx
        .insert(recoveryCodes)
        .values({
          userId: code.userId,
          householdId: code.householdId,
          codeHash: hashRecoveryCode(newRawCode),
        })
        .returning({ id: recoveryCodes.id });

      await writeAudit(tx, {
        actor_user_id: code.userId,
        household_id: code.householdId,
        kind: "recovery_code.redeemed",
        entity_table: "recovery_codes",
        entity_id: code.id,
        before: null,
        after: toAuditJson({
          redeemed_code_id: code.id,
          rotated_to_id: rotated.id,
        }),
        ip: clientIp,
      });

      return { userId: code.userId, newRawCode, sessionToken };
    });

    if ("error" in outcome) {
      if (outcome.error === "rate_limited") {
        return NextResponse.json(
          {
            ok: false,
            error: "rate_limited",
            message:
              "Too many attempts. Please wait before trying again, or ask a household member to send you an access link.",
          },
          { status: 429 },
        );
      }
      return NextResponse.json(
        {
          ok: false,
          error: "invalid_code",
          message: `That code didn't work. ${EXAMPLE_FORMAT}`,
        },
        { status: 400 },
      );
    }

    // The session row is already committed inside the tx above; only
    // the cookie (a response-side concern) remains.
    await setSessionCookie(outcome.sessionToken);

    return NextResponse.json({
      ok: true,
      new_recovery_code: outcome.newRawCode,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "recovery_redeem_failed",
        route: "/api/recovery/redeem",
        error: error instanceof Error ? error.message : String(error),
        fix_suggestion:
          "adminDb (service_role) is the no-session conduit; the old code must be set used_at AND a new code inserted in the SAME tx (recovery_codes_active_user_idx UNIQUE). Check rate_limits table exists (0002 migration applied).",
      }),
    );
    return NextResponse.json(
      { ok: false, error: "recovery_redeem_failed" },
      { status: 500 },
    );
  }
}
