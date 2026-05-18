/**
 * `/log/feed` — auth-required host for the FeedForm. Thin: the (app) route
 * group has no shared layout in Task 3's file boundary, so each page enforces
 * the session itself (same pattern as the dashboard).
 */
import { redirect } from "next/navigation";

import { FeedForm } from "@/components/FeedForm";
import { getSessionAuthContext } from "@/lib/with-auth";

export default async function LogFeedPage() {
  const auth = await getSessionAuthContext();
  if (!auth) redirect("/onboarding");

  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-stone-50 px-6 py-10 dark:bg-stone-950">
      <FeedForm />
    </main>
  );
}
