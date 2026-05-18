import { redirect } from "next/navigation";

import { InsightBanner } from "@/components/InsightBanner";
import { LogConsole } from "@/components/LogConsole";
import { TodayCard } from "@/components/TodayCard";
import { getDaySummary } from "@/lib/day-summary";
import { computeInsights } from "@/lib/insights";
import { getSessionAuthContext } from "@/lib/with-auth";

/**
 * The whole app on one page. Server Component: the summary is fetched
 * server-side via the shared `getDaySummary` (no client round-trip), then a
 * two-column bento puts the at-a-glance TodayCard + insights beside the
 * always-present LogConsole — no route-hopping to log. The forms call
 * router.refresh() so this server component re-renders in place. Realtime
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
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 lg:py-10">
      <header className="mb-6 flex items-end justify-between gap-4 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-500">
        <div>
          <p className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-foreground/55">
            Newborn Tracker
          </p>
          <p className="mt-1 font-heading text-2xl leading-tight text-foreground sm:text-3xl">
            {dateLabel}
          </p>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-12 lg:items-start">
        <div className="flex flex-col gap-4 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-500 motion-safe:delay-100 lg:col-span-7">
          <TodayCard summary={data.summary} />
          <InsightBanner insights={insights} />
        </div>
        <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-500 motion-safe:delay-200 lg:col-span-5">
          <LogConsole />
        </div>
      </div>
    </main>
  );
}
