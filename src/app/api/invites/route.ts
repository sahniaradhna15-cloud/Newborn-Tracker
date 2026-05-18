/**
 * `POST /api/invites` (session, OWNER only) — mint a new-caregiver
 * invite link.
 *
 * Authority is enforced in TWO layers (defense in depth):
 *   1. App: we re-read the caller's `household_members.role` and 403 if
 *      not `owner`.
 *   2. DB: the `invites_owner_new_caregiver_insert` RLS policy only
 *      permits a `target_user_id IS NULL` INSERT when the caller is an
 *      owner of the target household (migrations/0000_*.sql §invites).
 *
 * The raw token is 32 random bytes base64url, shown to the user exactly
 * once (only its sha256 is stored — CLAUDE.md §13). 7-day expiry.
 */
import { createHash, randomBytes } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { householdMembers, invites } from "@/lib/db/schema";
import { withAuth } from "@/lib/with-auth";
import { withUserContext } from "@/lib/with-user-context";

const Body = z.object({
  display_name: z.string().trim().min(1).max(60),
  role: z.enum(["owner", "caregiver"]).optional(),
});

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
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

  const rawToken = randomBytes(32).toString("base64url");

  try {
    const result = await withUserContext(ctx.user_id, async (tx) => {
      const [membership] = await tx
        .select({ role: householdMembers.role })
        .from(householdMembers)
        .where(
          and(
            eq(householdMembers.userId, ctx.user_id),
            eq(householdMembers.householdId, ctx.household_id),
          ),
        )
        .limit(1);
      if (membership?.role !== "owner") {
        return { error: "forbidden" as const };
      }

      const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
      const [row] = await tx
        .insert(invites)
        .values({
          householdId: ctx.household_id,
          tokenHash: sha256(rawToken),
          role: parsed.data.role ?? "caregiver",
          displayName: parsed.data.display_name,
          targetUserId: null,
          expiresAt,
          createdBy: ctx.user_id,
        })
        .returning({ id: invites.id, expiresAt: invites.expiresAt });
      return { invite: row };
    });

    if ("error" in result) {
      return NextResponse.json(
        { ok: false, error: "forbidden_owner_only" },
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
    console.error(
      JSON.stringify({
        event: "invite_mint_failed",
        route: "/api/invites",
        error: error instanceof Error ? error.message : String(error),
        user_id: ctx.user_id,
        household_id: ctx.household_id,
        fix_suggestion:
          "Check withUserContext bound request.user_id and that invites_owner_new_caregiver_insert RLS allows a target_user_id IS NULL insert for an owner; caller must be household owner.",
      }),
    );
    return NextResponse.json(
      { ok: false, error: "invite_mint_failed" },
      { status: 500 },
    );
  }
}
