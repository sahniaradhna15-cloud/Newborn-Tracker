/**
 * `/settings/recovery` — recovery-code status + rotate. Session-gated.
 * The raw code is NEVER shown here (it is hashed at rest, CLAUDE.md
 * §13); we only report whether an active one exists. Rotating mints a
 * fresh code and shows it once via the "save this" card.
 */
import { and, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";

import { recoveryCodes } from "@/lib/db/schema";
import { getSessionAuthContext } from "@/lib/with-auth";
import { withUserContext } from "@/lib/with-user-context";

import { RotateRecoveryCode } from "./RotateRecoveryCode";

export default async function RecoverySettingsPage() {
  const auth = await getSessionAuthContext();
  if (!auth) redirect("/onboarding");

  const hasActiveCode = await withUserContext(auth.user_id, async (tx) => {
    const [row] = await tx
      .select({ id: recoveryCodes.id })
      .from(recoveryCodes)
      .where(
        and(
          eq(recoveryCodes.userId, auth.user_id),
          isNull(recoveryCodes.rotatedAt),
          isNull(recoveryCodes.usedAt),
        ),
      )
      .limit(1);
    return Boolean(row);
  });

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-6 py-10">
      <h1 className="mb-1 text-2xl text-foreground">Recovery code</h1>
      <p className="mb-6 text-sm text-stone-600 dark:text-stone-400">
        If you lose your phone and no one can send you an access link, this
        code is your only way back in. We can&apos;t show an existing code
        again — if you didn&apos;t save it, rotate to get a fresh one.
      </p>
      <div className="space-y-4 rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950">
        <p className="text-sm text-foreground">
          {hasActiveCode
            ? "An active recovery code exists for your account."
            : "You don't have an active recovery code. Rotate to create one."}
        </p>
        <RotateRecoveryCode />
      </div>
    </main>
  );
}
