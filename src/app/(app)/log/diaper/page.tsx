/**
 * `/log/diaper` — auth-required host for the DiaperForm. See /log/feed for
 * why auth is enforced per-page.
 */
import { redirect } from "next/navigation";

import { DiaperForm } from "@/components/DiaperForm";
import { getSessionAuthContext } from "@/lib/with-auth";

export default async function LogDiaperPage() {
  const auth = await getSessionAuthContext();
  if (!auth) redirect("/onboarding");

  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-stone-50 px-6 py-10 dark:bg-stone-950">
      <DiaperForm />
    </main>
  );
}
