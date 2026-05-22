import Link from "next/link";
import { redirect } from "next/navigation";

import { InsightBanner } from "@/components/InsightBanner";
import { IntakeTrendMini } from "@/components/IntakeTrendMini";
import { LogConsole } from "@/components/LogConsole";
import { RealtimeProvider } from "@/components/RealtimeProvider";
import { TodayCard } from "@/components/TodayCard";
import { resolveActiveBabyId } from "@/lib/active-baby";
import { getDaySummary, getRangeSummary } from "@/lib/day-summary";
import { computeInsights } from "@/lib/insights";
import { getSessionAuthContext } from "@/lib/with-auth";

const TREND_MINI_DAYS = 7;

/**
 * The whole app on one page. Server Component: the summary is fetched
 * server-side via the shared `getDaySummary` (no client round-trip), then a
 * two-column bento puts the at-a-glance TodayCard + insights beside the
 * always-present LogConsole — no route-hopping to log. The forms call
 * router.refresh() so this server component re-renders in place.
 *
 * The dashboard lives at `/`, OUTSIDE the `(app)` route group, so
 * `(app)/layout.tsx`'s `RealtimeProvider` never wrapped it — the main
 * screen did not auto-sync across devices. We mount the provider here
 * directly (same shared `resolveActiveBabyId` the group layout uses) so a
 * feed logged on one phone refreshes the other's dashboard in ~2s. The
 * provider renders children immediately and does all socket work in a
 * post-hydration effect, so first paint is never blocked.
 */
export default async function Home() {
  const auth = await getSessionAuthContext();
  if (!auth) redirect("/onboarding");

  const now = new Date();
  const data = await getDaySummary(auth.user_id, auth.household_id, now);
  if (!data) redirect("/onboarding");

  const babyId = await resolveActiveBabyId(auth.user_id, auth.household_id);
  const insights = computeInsights(data.summary, data.baby, now);

  const trendFrom = new Date(now.getTime() - (TREND_MINI_DAYS - 1) * 24 * 60 * 60 * 1000);
  const trend = await getRangeSummary(auth.user_id, auth.household_id, trendFrom, now);

  const dateLabel = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: data.baby.timeZone,
  }).format(now);

  const content = (
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
        <nav className="flex shrink-0 items-center gap-4 text-sm">
          <Link href="/history" className="text-foreground/70 transition-colors hover:text-foreground">
            Trends
          </Link>
          <Link href="/growth" className="text-foreground/70 transition-colors hover:text-foreground">
            Growth
          </Link>
        </nav>
      </header>

      <div className="grid gap-4 lg:grid-cols-12 lg:items-start">
        <div className="flex flex-col gap-4 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-500 motion-safe:delay-100 lg:col-span-7">
          <TodayCard summary={data.summary} />
          <InsightBanner insights={insights} />
          {trend ? <IntakeTrendMini days={trend.days} timeZone={data.baby.timeZone} /> : null}
        </div>
        <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-500 motion-safe:delay-200 lg:col-span-5">
          <LogConsole />
        </div>
      </div>
    </main>
  );

  if (!babyId) return content;
  return (
    <RealtimeProvider householdId={auth.household_id} babyId={babyId}>
      {content}
    </RealtimeProvider>
  );
}
