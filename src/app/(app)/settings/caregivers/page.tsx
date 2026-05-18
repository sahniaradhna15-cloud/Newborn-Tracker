/**
 * `/settings/caregivers` — server-rendered roster + interactive client
 * controls. Session-gated. The caller's role decides which controls
 * render (owner: invite / revoke / transfer; any member: send access
 * link to another member).
 */
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { householdMembers, users } from "@/lib/db/schema";
import { getSessionAuthContext } from "@/lib/with-auth";
import { withUserContext } from "@/lib/with-user-context";

import { CaregiversPanel, type RosterMember } from "./CaregiversPanel";

export default async function CaregiversSettingsPage() {
  const auth = await getSessionAuthContext();
  if (!auth) redirect("/onboarding");

  const { roster, callerRole } = await withUserContext(
    auth.user_id,
    async (tx) => {
      const rows = await tx
        .select({
          userId: householdMembers.userId,
          role: householdMembers.role,
          displayName: householdMembers.displayName,
          fallbackName: users.displayName,
        })
        .from(householdMembers)
        .innerJoin(users, eq(users.id, householdMembers.userId))
        .where(eq(householdMembers.householdId, auth.household_id));

      const members: RosterMember[] = rows.map((r) => ({
        user_id: r.userId,
        role: r.role === "owner" ? "owner" : "caregiver",
        display_name: r.displayName ?? r.fallbackName,
        is_self: r.userId === auth.user_id,
      }));
      const self = members.find((m) => m.is_self);
      return { roster: members, callerRole: self?.role ?? "caregiver" };
    },
  );

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-6 py-10">
      <h1 className="mb-1 text-2xl text-foreground">Caregivers</h1>
      <p className="mb-6 text-sm text-stone-600 dark:text-stone-400">
        Everyone here logs into the same baby. No shared passwords.
      </p>
      <CaregiversPanel roster={roster} callerRole={callerRole} />
    </main>
  );
}
