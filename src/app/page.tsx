import { redirect } from "next/navigation";

import { InsightBanner } from "@/components/InsightBanner";
import { QuickLogBar } from "@/components/QuickLogBar";
import { TodayCard } from "@/components/TodayCard";
import { getDaySummary } from "@/lib/day-summary";
import { computeInsights } from "@/lib/insights";
import { getSessionAuthContext } from "@/lib/with-auth";

/**
 * Dashboard. Server Component: the summary is fetched server-side via the
 * shared `getDaySummary` (no client round-trip, no HTTP self-call), then
 * TodayCard / InsightBanner / QuickLogBar are rendered from it. Realtime
 * refresh lands in Phase 2.
 */
export default async function Home() {
  const auth = await getSessionAuthContext();
  if (!auth) redirect("/onboarding");

  const now = new Date();
  const data = await getDaySummary(auth.user_id, auth.household_id, now);
  if (!data) redirect("/onboarding");

  const insights = computeInsights(data.summary, data.baby, now);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-6">
      <TodayCard summary={data.summary} />
      <InsightBanner insights={insights} />
      <QuickLogBar />
    </main>
  );
}
