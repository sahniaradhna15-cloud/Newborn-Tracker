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
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-md motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-500">
        <DiaperForm />
      </div>
    </main>
  );
}
