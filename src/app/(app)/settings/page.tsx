/**
 * `/settings` — full settings page (Phase 3 Task 3; replaces the Phase 2
 * caregivers-index placeholder). Server component: resolves the session,
 * reads the household + baby + the caller's role inside `withUserContext`,
 * renders the Household/Baby editor island, and keeps the Caregivers /
 * Voice / Recovery sub-pages as link cards.
 *
 * Session-gated like the other (app) pages — there is no shared (app) layout.
 */
import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { babies, households, householdMembers } from "@/lib/db/schema";
import { getSessionAuthContext } from "@/lib/with-auth";
import { withUserContext } from "@/lib/with-user-context";

import { SettingsForms } from "./SettingsForms";

const SECTIONS = [
  {
    href: "/settings/caregivers",
    title: "Caregivers",
    blurb: "Invite a partner, send an access link, transfer ownership.",
  },
  {
    href: "/settings/voice",
    title: "Siri voice",
    blurb: "Generate a bearer token and install the Shortcuts.",
  },
  {
    href: "/settings/recovery",
    title: "Recovery code",
    blurb: "Your way back in if you lose your phone. Rotate it here.",
  },
];

export default async function SettingsPage() {
  const auth = await getSessionAuthContext();
  if (!auth) redirect("/onboarding");

  const data = await withUserContext(auth.user_id, async (tx) => {
    const [household] = await tx
      .select({
        name: households.name,
        dayStartHour: households.dayStartHour,
        timezone: households.timezone,
      })
      .from(households)
      .where(eq(households.id, auth.household_id))
      .limit(1);

    const [baby] = await tx
      .select({
        name: babies.name,
        birthDate: babies.birthDate,
        birthWeightOz: babies.birthWeightOz,
        currentWeightOz: babies.currentWeightOz,
      })
      .from(babies)
      .where(eq(babies.householdId, auth.household_id))
      .orderBy(asc(babies.createdAt))
      .limit(1);

    const [member] = await tx
      .select({ role: householdMembers.role })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.userId, auth.user_id),
          eq(householdMembers.householdId, auth.household_id),
        ),
      )
      .limit(1);

    return { household, baby, isOwner: member?.role === "owner" };
  });

  return (
    <main className="mx-auto w-full max-w-md flex-1 space-y-6 px-6 py-10">
      <h1 className="text-2xl text-foreground">Settings</h1>

      {data.household && data.baby ? (
        <SettingsForms
          isOwner={data.isOwner}
          household={data.household}
          baby={{
            name: data.baby.name,
            birthDate: data.baby.birthDate.toISOString().slice(0, 10),
            birthWeightOz:
              data.baby.birthWeightOz != null
                ? Number(data.baby.birthWeightOz)
                : null,
            currentWeightOz:
              data.baby.currentWeightOz != null
                ? Number(data.baby.currentWeightOz)
                : null,
          }}
        />
      ) : null}

      <div className="space-y-3">
        {SECTIONS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="block rounded-xl border border-stone-200 bg-white p-4 transition-colors hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-950 dark:hover:bg-stone-900"
          >
            <p className="text-base text-foreground">{s.title}</p>
            <p className="mt-0.5 text-sm text-stone-600 dark:text-stone-400">
              {s.blurb}
            </p>
          </Link>
        ))}
      </div>
    </main>
  );
}
