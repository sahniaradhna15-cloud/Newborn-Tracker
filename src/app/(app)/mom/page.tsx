/**
 * `/mom` — the postpartum mom tab (Phase 3 Task 4). Per-page auth like
 * /log/feed (the (app) group has no shared layout). Privacy is enforced by
 * the `mom_events_self` RLS policy: this server read runs inside
 * `withUserContext(caller)`, so it can ONLY return the caller's own rows —
 * Dad opening /mom sees Dad's (empty) tab, never Mom's medication. The
 * footer restates this in plain language because the user explicitly wanted
 * the reassurance visible, not just enforced.
 */
import { and, desc, eq, gte } from "drizzle-orm";
import { redirect } from "next/navigation";

import { MomEventList, type MomEventRow } from "@/components/MomEventList";
import { MomQuickLog } from "@/components/MomQuickLog";
import { householdMembers, momEvents } from "@/lib/db/schema";
import { getSessionAuthContext } from "@/lib/with-auth";
import { withUserContext } from "@/lib/with-user-context";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export default async function MomPage() {
  const auth = await getSessionAuthContext();
  if (!auth) redirect("/onboarding");

  const now = new Date();
  const since = new Date(now.getTime() - THIRTY_DAYS_MS);

  const { displayName, rows } = await withUserContext(auth.user_id, async (tx) => {
    const [member] = await tx
      .select({ displayName: householdMembers.displayName })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.userId, auth.user_id),
          eq(householdMembers.householdId, auth.household_id),
        ),
      )
      .limit(1);
    const events = await tx
      .select()
      .from(momEvents)
      .where(gte(momEvents.occurredAt, since))
      .orderBy(desc(momEvents.occurredAt));
    return { displayName: member?.displayName ?? null, rows: events };
  });

  const events: MomEventRow[] = rows.map((row) => ({
    id: row.id,
    kind: row.kind as MomEventRow["kind"],
    payload: (row.payload as Record<string, unknown> | null) ?? null,
    occurred_at: row.occurredAt.toISOString(),
  }));

  const heading = displayName ? `${displayName}'s notes` : "Your notes";

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-6">
      <header>
        <p className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-foreground/55">
          Postpartum
        </p>
        <h1 className="mt-1 text-2xl text-foreground">{heading}</h1>
      </header>

      <MomQuickLog />
      <MomEventList events={events} />

      <footer className="mt-2 space-y-1 px-1 pb-4 text-xs text-foreground/55">
        <p>Only you can see this tab — your partner does not see your entries.</p>
        <p>Not medical advice. Call your provider if you&apos;re worried.</p>
      </footer>
    </main>
  );
}
