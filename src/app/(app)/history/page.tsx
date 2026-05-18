/**
 * `/history` — the last 7 logical days. Server component (CLAUDE.md §3):
 * the 7-day rollup comes from the SHARED {@link getRangeSummary} (same
 * per-day reducer as TodayCard — no drift), and the editable per-event
 * rows + "logged by / edited by" attribution are read RLS-bound here,
 * then handed to the `EventList` client island.
 *
 * Attribution: `logged_by` → `household_members.display_name`;
 * "edited by" is the actor of the most recent `feed.updated` /
 * `diaper.updated` audit row for that entity (CLAUDE.md §11.4). No PII
 * leaves the server beyond the display names the household already shares.
 */
import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { redirect } from "next/navigation";

import { EventList, type EventDayGroup, type EventRow } from "@/components/EventList";
import { getRangeSummary } from "@/lib/day-summary";
import {
  babies,
  diaperEvents,
  eventAudit,
  feedEvents,
  households,
  householdMembers,
} from "@/lib/db/schema";
import { getDayWindow } from "@/lib/day-window";
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
  const from = new Date(now.getTime() - (HISTORY_DAYS - 1) * 24 * 60 * 60 * 1000);

  const range = await getRangeSummary(auth.user_id, auth.household_id, from, now);
  if (!range) redirect("/onboarding");

  const timeZone = range.baby.timeZone;

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

    const firstWindow = getDayWindow(from, household.timezone, household.dayStartHour);
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

  // Group events into the same logical-day windows as the rollup.
  const groups: EventDayGroup[] = range.days.map((day) => {
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
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-8">
      <h1 className="mb-1 text-2xl text-foreground">Last 7 days</h1>
      <p className="mb-6 text-sm text-stone-600 dark:text-stone-400">
        Per-day totals and every entry. Tap Edit to correct a feed or diaper.
      </p>

      <section className="mb-8 space-y-2">
        {range.days.map((day) => {
          const within =
            day.feeds.total_oz >= day.target.low_oz && day.feeds.total_oz <= day.target.high_oz;
          return (
            <div
              key={day.day_start}
              className="flex items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-950"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-foreground">{dayLabel(day.day_start, timeZone)}</p>
                <p className="text-xs text-stone-500">
                  {day.feeds.total_oz} oz · {day.diapers.pee_count} wet · {day.diapers.poop_count} dirty
                </p>
              </div>
              <span
                className={
                  within
                    ? "shrink-0 rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-600 dark:bg-stone-900 dark:text-stone-400"
                    : "shrink-0 rounded-full bg-amber-50 px-2.5 py-1 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                }
              >
                target {day.target.low_oz}–{day.target.high_oz}
              </span>
            </div>
          );
        })}
      </section>

      <EventList groups={groups} timeZone={timeZone} />

      <p className="mt-8 border-t border-stone-200 pt-3 text-xs text-stone-500 dark:border-stone-800">
        Not medical advice. Call your pediatrician if you&apos;re worried.
      </p>
    </main>
  );
}
