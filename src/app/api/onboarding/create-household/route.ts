/**
 * First-visit onboarding: create the household, owner, baby, and the
 * owner's session — all before any session/RLS context can exist, so
 * this is the ONE place (besides src/lib/db/admin.ts) that uses the
 * RLS-bypassing service-role connection (CLAUDE.md §13).
 *
 * Returns the raw recovery code exactly once; it is never stored in
 * plaintext. The client shows it on a "save this" card.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { withAdmin } from "@/lib/db/admin";
import { babies, households, householdMembers, recoveryCodes, users } from "@/lib/db/schema";
import {
  generateRecoveryCode,
  hashRecoveryCode,
  mintSession,
  setSessionCookie,
} from "@/lib/session";

const Body = z.object({
  household_name: z.string().trim().min(1).max(100),
  owner_display_name: z.string().trim().min(1).max(60),
  baby_name: z.string().trim().min(1).max(100),
  baby_dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"),
  baby_birth_weight_oz: z.coerce.number().positive().max(400),
});

export async function POST(req: Request) {
  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: "validation_failed",
        details: err instanceof z.ZodError ? err.issues : undefined,
        say: "Sorry, that didn't work.",
      },
      { status: 400 },
    );
  }

  const rawRecoveryCode = generateRecoveryCode();

  const { userId } = await withAdmin(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ displayName: parsed.owner_display_name })
      .returning({ id: users.id });

    const [household] = await tx
      .insert(households)
      .values({ name: parsed.household_name })
      .returning({ id: households.id });

    await tx.insert(householdMembers).values({
      householdId: household.id,
      userId: user.id,
      role: "owner",
      displayName: parsed.owner_display_name,
    });

    await tx.insert(babies).values({
      householdId: household.id,
      name: parsed.baby_name,
      birthDate: new Date(`${parsed.baby_dob}T00:00:00Z`),
      birthWeightOz: parsed.baby_birth_weight_oz.toFixed(1),
    });

    await tx.insert(recoveryCodes).values({
      userId: user.id,
      householdId: household.id,
      codeHash: hashRecoveryCode(rawRecoveryCode),
    });

    return { userId: user.id };
  });

  const { token } = await mintSession(userId, "Onboarding device");
  await setSessionCookie(token);

  return NextResponse.json({ ok: true, recovery_code: rawRecoveryCode });
}
