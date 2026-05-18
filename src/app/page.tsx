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

  const dateLabel = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: data.baby.timeZone,
  }).format(now);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-6">
      <header className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-500">
        <p className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-foreground/55">Today</p>
        <p className="mt-1 text-sm text-foreground/70">{dateLabel}</p>
      </header>
      <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-500 motion-safe:delay-100">
        <TodayCard summary={data.summary} />
      </div>
      <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-500 motion-safe:delay-200">
        <InsightBanner insights={insights} />
      </div>
      <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-500 motion-safe:delay-300">
        <QuickLogBar />
      </div>
    </main>
  );
}
