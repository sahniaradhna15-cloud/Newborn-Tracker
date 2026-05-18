/**
 * Route-group layout for the auth-required `(app)` pages (`/log/*`,
 * `/mom`, `/settings/*`, `/history`, `/export/*`). Phase 1 left this
 * group with no shared layout; Phase 2 Task 4 introduces it as the mount
 * point for `RealtimeProvider` (and, in Phase 3, the install prompt /
 * offline banner — see Integration Notes).
 *
 * Server component (CLAUDE.md §3): it resolves the session + active baby
 * server-side and passes only the two opaque IDs to the client provider.
 *
 * Auth note: this layout deliberately does NOT redirect. Every `(app)`
 * page already enforces its own session and redirects to `/onboarding`
 * when unauthenticated (the established Phase 1/2 convention). Re-doing
 * that here would double-handle auth and could fight a page that wants a
 * different destination. When there is no session or no baby we simply
 * render `{children}` WITHOUT the realtime socket — the child page does
 * the redirect — so `/log/*`, `/settings/*`, and `/mom` keep working
 * exactly as before.
 */
import { eq } from "drizzle-orm";

import { RealtimeProvider } from "@/components/RealtimeProvider";
import { babies } from "@/lib/db/schema";
import { getSessionAuthContext } from "@/lib/with-auth";
import { withUserContext } from "@/lib/with-user-context";

async function resolveActiveBabyId(userId: string, householdId: string): Promise<string | null> {
  return withUserContext(userId, async (tx) => {
    const [row] = await tx
      .select({ id: babies.id })
      .from(babies)
      .where(eq(babies.householdId, householdId))
      .limit(1);
    return row?.id ?? null;
  });
}

export default async function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const auth = await getSessionAuthContext();
  if (!auth) {
    return <>{children}</>;
  }

  const babyId = await resolveActiveBabyId(auth.user_id, auth.household_id);
  if (!babyId) {
    return <>{children}</>;
  }

  return (
    <RealtimeProvider householdId={auth.household_id} babyId={babyId}>
      {children}
    </RealtimeProvider>
  );
}
