import { eq } from "drizzle-orm";

import { babies } from "@/lib/db/schema";
import { withUserContext } from "@/lib/with-user-context";

/**
 * The active baby's id for a household, or `null` if none exists yet
 * (pre-onboarding). RLS-bound: runs inside `withUserContext` so the
 * `babies` SELECT is scoped to the caller. Phase 1 is single-baby, so the
 * first row is "the" baby. Shared by `(app)/layout.tsx` and the dashboard
 * (`/`) — both mount `RealtimeProvider` and need this one id.
 */
export async function resolveActiveBabyId(userId: string, householdId: string): Promise<string | null> {
  return withUserContext(userId, async (tx) => {
    const [row] = await tx
      .select({ id: babies.id })
      .from(babies)
      .where(eq(babies.householdId, householdId))
      .limit(1);
    return row?.id ?? null;
  });
}
