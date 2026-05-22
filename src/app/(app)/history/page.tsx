/**
 * `/history` — the intake trend graph plus the editable last-7-days log.
 * Server component (CLAUDE.md §3): every per-day total comes from the SHARED
 * {@link getRangeSummary} (same reducer as TodayCard — no drift), so the
 * `IntakeTrendChart` bars and the dashboard donut can never disagree.
 *
 * Two ranges are read here:
 *  - the TREND (start of last month → now) feeds the chart's Week / This-month
 *    / Last-month views;
 *  - the last 7 logical days feed the editable {@link EventList} with per-event
 *    "logged by / edited by" attribution.
 *
 * Attribution: `logged_by` → `household_members.display_name`; "edited by" is
 * the actor of the most recent `feed.updated` / `diaper.updated` audit row for
 * that entity (CLAUDE.md §11.4). No PII leaves the server beyond the display
 * names the household already shares.
 */
import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { EventList, type EventDayGroup, type EventRow } from "@/components/EventList";
import { IntakeByAge, type IntakeByAgeRow } from "@/components/IntakeByAge";
import { IntakeTrendChart } from "@/components/IntakeTrendChart";
import { getRangeSummary } from "@/lib/day-summary";
import { intakeRangeForWeek } from "@/lib/targets";
import {
  babies,
  diaperEvents,
  eventAudit,
  feedEvents,
  households,
  householdMembers,
} from "@/lib/db/schema";
import { firstInstantOfMonthsBack, getDayWindow } from "@/lib/day-window";
import { getSessionAuthContext } from "@/lib/with-auth";
import { withUserContext } from "@/lib/with-user-context";

const HISTORY_DAYS = 7;

function toNum(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function dayLabel(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone,
  }).format(new Date(iso));
}

export default async function HistoryPage() {
  const auth = await getSessionAuthContext();
  if (!auth) redirect("/onboarding");

  const now = new Date();
  const historyFrom = new Date(now.getTime() - (HISTORY_DAYS - 1) * 24 * 60 * 60 * 1000);

  // Read the household (for its timezone), baby, and the editable last-7-days
  // detail rows in one RLS-bound transaction.
  const detail = await withUserContext(auth.user_id, async (tx) => {
    const [household] = await tx
      .select()
      .from(households)
      .where(eq(households.id, auth.household_id))
      .limit(1);
    const [baby] = await tx
      .select()
      .from(babies)
      .where(eq(babies.householdId, auth.household_id))
      .limit(1);
    if (!household || !baby) return null;

    const firstWindow = getDayWindow(historyFrom, household.timezone, household.dayStartHour);
    const lastWindow = getDayWindow(now, household.timezone, household.dayStartHour);

    const feedRows = await tx
      .select()
      .from(feedEvents)
      .where(
        and(
          eq(feedEvents.babyId, baby.id),
          gte(feedEvents.occurredAt, firstWindow.start),
          lt(feedEvents.occurredAt, lastWindow.end),
        ),
      )
      .orderBy(desc(feedEvents.occurredAt));
    const diaperRows = await tx
      .select()
      .from(diaperEvents)
      .where(
        and(
          eq(diaperEvents.babyId, baby.id),
          gte(diaperEvents.occurredAt, firstWindow.start),
          lt(diaperEvents.occurredAt, lastWindow.end),
        ),
      )
      .orderBy(desc(diaperEvents.occurredAt));

    const members = await tx
      .select({ userId: householdMembers.userId, displayName: householdMembers.displayName })
      .from(householdMembers)
      .where(eq(householdMembers.householdId, auth.household_id));

    const entityIds = [...feedRows.map((r) => r.id), ...diaperRows.map((r) => r.id)];
    const editRows = entityIds.length
      ? await tx
          .select({
            entityId: eventAudit.entityId,
            actorUserId: eventAudit.actorUserId,
            kind: eventAudit.kind,
            createdAt: eventAudit.createdAt,
          })
          .from(eventAudit)
          .where(
            and(
              eq(eventAudit.householdId, auth.household_id),
              inArray(eventAudit.kind, ["feed.updated", "diaper.updated"]),
              inArray(eventAudit.entityId, entityIds),
            ),
          )
          .orderBy(desc(eventAudit.createdAt))
      : [];

    return { household, baby, feedRows, diaperRows, members, editRows };
  });

  if (!detail) redirect("/onboarding");

  const timeZone = detail.household.timezone;

  // The trend spans the 1st of last month → now, so the chart's "This month"
  // and "Last month" tabs always have a full calendar month to draw.
  const trendFrom = firstInstantOfMonthsBack(now, timeZone, 1);
  const trend = await getRangeSummary(auth.user_id, auth.household_id, trendFrom, now);
  if (!trend) redirect("/onboarding");

  const nameByUser = new Map<string, string>();
  for (const m of detail.members) {
    nameByUser.set(m.userId, m.displayName ?? "a caregiver");
  }
  const nameFor = (userId: string | null): string =>
    userId ? (nameByUser.get(userId) ?? "a caregiver") : "a caregiver";

  // Most-recent edit per entity (editRows already desc by created_at).
  const lastEdit = new Map<string, { actorUserId: string | null; createdAt: Date }>();
  for (const row of detail.editRows) {
    if (row.entityId && !lastEdit.has(row.entityId)) {
      lastEdit.set(row.entityId, { actorUserId: row.actorUserId, createdAt: row.createdAt });
    }
  }

  const events: EventRow[] = [
    ...detail.feedRows.map((r): EventRow => {
      const edit = lastEdit.get(r.id);
      return {
        type: "feed",
        id: r.id,
        occurred_at: r.occurredAt.toISOString(),
        kind: r.kind as "nursing" | "pumped" | "formula",
        side: (r.side as "left" | "right" | "both" | null) ?? null,
        duration_min: r.durationMin ?? null,
        volume_oz: r.volumeOz === null ? null : toNum(r.volumeOz),
        estimated_oz: toNum(r.estimatedOz),
        note: r.note ?? null,
        logged_by_name: nameFor(r.loggedBy),
        edited_by_name: edit ? nameFor(edit.actorUserId) : null,
        edited_at: edit ? edit.createdAt.toISOString() : null,
      };
    }),
    ...detail.diaperRows.map((r): EventRow => {
      const edit = lastEdit.get(r.id);
      return {
        type: "diaper",
        id: r.id,
        occurred_at: r.occurredAt.toISOString(),
        pee: r.pee,
        poop: r.poop,
        note: r.note ?? null,
        logged_by_name: nameFor(r.loggedBy),
        edited_by_name: edit ? nameFor(edit.actorUserId) : null,
        edited_at: edit ? edit.createdAt.toISOString() : null,
      };
    }),
  ];

  // "By age" reference: per week of life, the age-appropriate daily band next
  // to his average intake on the days actually logged that week. The band uses
  // birth weight (age estimate), not today's weight, so the newborn weeks are
  // judged against his size *then* — not now.
  const birthWeightOz = detail.baby.birthWeightOz === null ? 109 : Number(detail.baby.birthWeightOz);
  const currentAgeDays = trend.days[0]?.target.age_days ?? 1;
  const currentWeek = Math.max(1, Math.ceil(currentAgeDays / 7));
  const lastWeekToShow = Math.max(5, currentWeek + 1); // always cover weeks 2–5, plus a peek at next week
  const byAgeRows: IntakeByAgeRow[] = [];
  for (let week = 1; week <= lastWeekToShow; week++) {
    const band = intakeRangeForWeek(week, birthWeightOz);
    const loggedDays = trend.days.filter(
      (d) => d.feeds.count > 0 && d.target.age_days >= (week - 1) * 7 + 1 && d.target.age_days <= week * 7,
    );
    const avgOz = loggedDays.length
      ? Math.round((loggedDays.reduce((sum, d) => sum + d.feeds.total_oz, 0) / loggedDays.length) * 10) / 10
      : null;
    byAgeRows.push({
      weekOfAge: week,
      ageDays: band.ageDays,
      lowOz: band.lowOz,
      highOz: band.highOz,
      avgOz,
      isCurrent: week === currentWeek,
      isUpcoming: week > currentWeek,
    });
  }

  // Group the editable events into the last 7 logical-day windows (the newest
  // 7 entries of the trend, which uses the identical windowing).
  const groups: EventDayGroup[] = trend.days.slice(0, HISTORY_DAYS).map((day) => {
    const start = new Date(day.day_start);
    const end = new Date(day.day_end);
    const dayEvents = events
      .filter((e) => {
        const t = new Date(e.occurred_at);
        return t >= start && t < end;
      })
      .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());
    return {
      day_start: day.day_start,
      label: dayLabel(day.day_start, timeZone),
      events: dayEvents,
    };
  });

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link
          href="/"
          className="inline-flex items-center text-sm text-foreground/70 transition-colors hover:text-foreground"
        >
          ← Dashboard
        </Link>
        <Link
          href="/import"
          className="inline-flex items-center text-sm text-foreground/70 transition-colors hover:text-foreground"
        >
          Import past notes →
        </Link>
      </div>
      <h1 className="mb-1 text-2xl text-foreground">History</h1>
      <p className="mb-6 text-sm text-foreground/60">How much {detail.baby.name} drank over time, vs. the healthy range for his age.</p>

      <IntakeTrendChart days={trend.days} timeZone={timeZone} />

      <h2 className="mt-10 mb-3 text-lg text-foreground">What he needs by age</h2>
      <IntakeByAge babyName={detail.baby.name} rows={byAgeRows} />

      <h2 className="mt-10 mb-1 text-lg text-foreground">Recent entries</h2>
      <p className="mb-4 text-sm text-foreground/60">The last 7 days. Tap Edit to correct a feed or diaper.</p>
      <EventList groups={groups} timeZone={timeZone} />

      <p className="mt-8 border-t border-white/10 pt-3 text-xs text-foreground/55">
        Not medical advice. Call your pediatrician if you&apos;re worried.
      </p>
    </main>
  );
}
