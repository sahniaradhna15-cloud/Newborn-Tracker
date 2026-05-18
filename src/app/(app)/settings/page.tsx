/**
 * `/settings` — settings index. Session-gated (same pattern as the
 * dashboard / log pages: each (app) page enforces its own session;
 * there is no shared (app) layout until Phase 2 Task 4).
 */
import Link from "next/link";
import { redirect } from "next/navigation";

import { getSessionAuthContext } from "@/lib/with-auth";

const SECTIONS = [
  {
    href: "/settings/caregivers",
    title: "Caregivers",
    blurb: "Invite a partner, send an access link, transfer ownership.",
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

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-6 py-10">
      <h1 className="mb-6 text-2xl text-foreground">Settings</h1>
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
