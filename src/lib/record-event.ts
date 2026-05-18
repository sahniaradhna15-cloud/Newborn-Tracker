/**
 * `recordEvent` — THE single write path (TECHNICAL_SPEC §5.2, CLAUDE.md §3).
 *
 * Every channel (PWA forms, Siri, Watch, future adapters) lifts its input into
 * an {@link InboundEvent} and calls this one function. Route handlers must NOT
 * INSERT into `feed_events` / `diaper_events` / `mom_events` directly.
 *
 * Invariants:
 * - Idempotent on `(source, client_uuid)`: a replay is a no-op that returns the
 *   original `event_id` with `status: 'duplicate'`. Safe to retry forever.
 * - The domain row and its `event_outbox` notification commit in ONE
 *   transaction (no lost/phantom events).
 * - The `say` readout is computed in a SEPARATE read transaction AFTER commit —
 *   the write path never blocks on the rollup query.
 *
 * Task 4 wired (2026-05-18): nursing `estimated_oz` uses the age-banded
 * `targets.estimateNursingOz`; the `say` target band uses
 * `targets.dailyTargetRange`; "today" uses the DST-tested
 * `day-window.getDayWindow`. America/Chicago + 4am remain module
 * constants here (per-household timezone becomes dynamic with the
 * Phase 3 settings page).
 */
import { and, asc, eq, gte, isNull, lte, ne } from "drizzle-orm";
import { toZonedTime } from "date-fns-tz";

import { writeAudit, toAuditJson } from "./audit";
import { db } from "./db/client";
import { dayNumberSinceBirth, getDayWindow } from "./day-window";
import { babies, diaperEvents, feedEvents, inboundEvents, momEvents } from "./db/schema";
import { enqueue } from "./outbox";
import { dailyTargetRange, estimateNursingOz } from "./targets";
import type { AuthContext } from "./with-auth";
import { withUserContext } from "./with-user-context";
import type { InboundEvent } from "./voice-parser";

type TransactionCallbackFn = Parameters<typeof db.transaction>[0];
type Tx = Parameters<TransactionCallbackFn>[0];

export type { AuthContext } from "./with-auth";

export type RecordResult =
  | { status: "accepted"; event_id: string; say: string }
  | { status: "duplicate"; event_id: string; say: string }
  | { status: "merged"; event_id: string; say: string };

type ResultingTable = "feed_events" | "diaper_events" | "mom_events";

const TZ = "America/Chicago";
const DAY_START_HOUR = 4;
const FEED_MERGE_WINDOW_MS = 5 * 60 * 1000;

export function round1(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

/**
 * `estimated_oz`: nursing = age-banded `estimateNursingOz`; bottle =
 * volume − wasted (wasted is tracked but excluded from intake totals).
 * Single source of truth so the insert path and the PATCH recompute
 * cannot drift. `ageDays` is the day-of-life at the feed's instant
 * (ignored for bottle feeds).
 */
export function estimateFeedOz(input: {
  kind: "nursing" | "pumped" | "formula";
  ageDays: number;
  duration_min?: number | null;
  volume_oz?: number | null;
  wasted_oz?: number | null;
}): number {
  if (input.kind === "nursing")
    return estimateNursingOz(input.duration_min ?? 0, input.ageDays);
  return Math.max(0, (input.volume_oz ?? 0) - (input.wasted_oz ?? 0));
}

/** Day-of-life (birth day = 1) at `at`, under the module's Chicago/4am policy. */
export function babyAgeDays(birthDate: Date, at: Date): number {
  return dayNumberSinceBirth(at, birthDate, TZ, DAY_START_HOUR);
}

/**
 * Start of the current logical day — DST-safe; delegates to the P0-tested
 * `getDayWindow`. Exported so the feeds/diapers GET routes share one
 * "today" definition.
 */
export function currentDayStart(now: Date): Date {
  return getDayWindow(now, TZ, DAY_START_HOUR).start;
}

function isAfter8pmChicago(now: Date): boolean {
  return toZonedTime(now, TZ).getHours() >= 20;
}

/**
 * Records one inbound event. See file header for invariants. Side effects:
 * inserts an `inbound_events` ledger row, the domain row, and an
 * `event_outbox` row — all in one RLS-bound transaction.
 */
export async function recordEvent(
  ctx: AuthContext,
  inbound: InboundEvent,
): Promise<RecordResult> {
  const occurredAt = new Date(inbound.occurred_at);

  const written = await withUserContext(ctx.user_id, async (tx) => {
    // 1. Idempotency ledger. ON CONFLICT (source, client_uuid) DO NOTHING.
    const ledger = await tx
      .insert(inboundEvents)
      .values({
        source: ctx.source,
        clientUuid: inbound.client_uuid,
        sourceEventId: inbound.source_event_id ?? null,
        householdId: ctx.household_id,
        userId: ctx.user_id,
        raw: inbound as unknown as Record<string, unknown>,
        status: "accepted",
      })
      .onConflictDoNothing({
        target: [inboundEvents.source, inboundEvents.clientUuid],
      })
      .returning({ id: inboundEvents.id });

    if (ledger.length === 0) {
      const [existing] = await tx
        .select({
          resultingEventId: inboundEvents.resultingEventId,
          status: inboundEvents.status,
        })
        .from(inboundEvents)
        .where(
          and(
            eq(inboundEvents.source, ctx.source),
            eq(inboundEvents.clientUuid, inbound.client_uuid),
          ),
        )
        .limit(1);
      return {
        kind: "duplicate" as const,
        eventId: existing?.resultingEventId ?? "",
      };
    }
    const inboundId = ledger[0].id;

    // 2. Resolve the baby (default = household's first baby) + its birth
    //    date for the age-banded nursing estimate.
    const [babyRow] = await tx
      .select({ id: babies.id, birthDate: babies.birthDate })
      .from(babies)
      .where(
        inbound.baby_id
          ? eq(babies.id, inbound.baby_id)
          : eq(babies.householdId, ctx.household_id),
      )
      .orderBy(asc(babies.createdAt))
      .limit(1);
    if (!babyRow) throw new Error("no_baby_for_household");
    const babyId = babyRow.id;
    const feedAgeDays = babyAgeDays(babyRow.birthDate, occurredAt);

    const event = inbound.event;

    if (event.type === "feed") {
      // 3. estimated_oz (shared helper — see estimateFeedOz).
      const estimatedOz = estimateFeedOz(
        event.kind === "nursing"
          ? { kind: "nursing", ageDays: feedAgeDays, duration_min: event.duration_min }
          : {
              kind: event.kind,
              ageDays: feedAgeDays,
              volume_oz: event.volume_oz,
              wasted_oz: event.wasted_oz,
            },
      );

      // 4. Merge-window — cross-source only. In Phase 1 every source is 'pwa',
      //    so this never fires: two manual feeds minutes apart are real
      //    cluster feeds and must NOT be collapsed. The path is correct for
      //    Phase 2 multi-source dedupe (Siri + smart bottle).
      const [mergeable] = await tx
        .select({
          id: feedEvents.id,
          corroboratingSources: feedEvents.corroboratingSources,
        })
        .from(feedEvents)
        .where(
          and(
            eq(feedEvents.babyId, babyId),
            eq(feedEvents.kind, event.kind),
            gte(feedEvents.occurredAt, new Date(occurredAt.getTime() - FEED_MERGE_WINDOW_MS)),
            lte(feedEvents.occurredAt, new Date(occurredAt.getTime() + FEED_MERGE_WINDOW_MS)),
            isNull(feedEvents.lockedAt),
            ne(feedEvents.source, ctx.source),
          ),
        )
        .limit(1);

      if (mergeable) {
        const prior = Array.isArray(mergeable.corroboratingSources)
          ? (mergeable.corroboratingSources as string[])
          : [];
        await tx
          .update(feedEvents)
          .set({ corroboratingSources: [...prior, ctx.source] })
          .where(eq(feedEvents.id, mergeable.id));
        await tx
          .update(inboundEvents)
          .set({
            resultingEventId: mergeable.id,
            resultingTable: "feed_events",
            status: "merged",
          })
          .where(eq(inboundEvents.id, inboundId));
        return { kind: "merged" as const, eventId: mergeable.id };
      }

      const [row] = await tx
        .insert(feedEvents)
        .values({
          babyId,
          loggedBy: ctx.user_id,
          occurredAt,
          kind: event.kind,
          side: event.kind === "nursing" ? event.side : null,
          durationMin: event.kind === "nursing" ? event.duration_min : null,
          volumeOz: event.kind === "nursing" ? null : round1(event.volume_oz),
          wastedOz:
            event.kind === "nursing"
              ? null
              : event.wasted_oz != null
                ? round1(event.wasted_oz)
                : null,
          estimatedOz: round1(estimatedOz),
          note: inbound.note ?? null,
          source: ctx.source,
          clientUuid: inbound.client_uuid,
        })
        .returning();

      await finalize(tx, inboundId, row.id, "feed_events");
      await writeAudit(tx, {
        actor_user_id: ctx.user_id,
        household_id: ctx.household_id,
        kind: "feed.created",
        entity_table: "feed_events",
        entity_id: row.id,
        before: null,
        after: toAuditJson(row),
      });
      await enqueue(tx, "event.feed.recorded", {
        event_id: row.id,
        baby_id: babyId,
        household_id: ctx.household_id,
        kind: event.kind,
        occurred_at: inbound.occurred_at,
      });
      return { kind: "accepted" as const, eventId: row.id };
    }

    if (event.type === "diaper") {
      // diaper_events has no corroborating_sources/locked_at columns, so the
      // 2-min cross-source merge is a no-op in Phase 1 (would need a schema
      // change to support; out of Task 3 scope).
      const [row] = await tx
        .insert(diaperEvents)
        .values({
          babyId,
          loggedBy: ctx.user_id,
          occurredAt,
          pee: event.pee,
          poop: event.poop,
          note: inbound.note ?? null,
          source: ctx.source,
          clientUuid: inbound.client_uuid,
        })
        .returning();

      await finalize(tx, inboundId, row.id, "diaper_events");
      await writeAudit(tx, {
        actor_user_id: ctx.user_id,
        household_id: ctx.household_id,
        kind: "diaper.created",
        entity_table: "diaper_events",
        entity_id: row.id,
        before: null,
        after: toAuditJson(row),
      });
      await enqueue(tx, "event.diaper.recorded", {
        event_id: row.id,
        baby_id: babyId,
        household_id: ctx.household_id,
        occurred_at: inbound.occurred_at,
      });
      return { kind: "accepted" as const, eventId: row.id };
    }

    // mom
    const [row] = await tx
      .insert(momEvents)
      .values({
        userId: ctx.user_id,
        householdId: ctx.household_id,
        occurredAt,
        kind: event.kind,
        payload: event.payload,
        source: ctx.source,
        clientUuid: inbound.client_uuid,
      })
      .returning();

    await finalize(tx, inboundId, row.id, "mom_events");
    await writeAudit(tx, {
      actor_user_id: ctx.user_id,
      household_id: ctx.household_id,
      kind: "mom.created",
      entity_table: "mom_events",
      entity_id: row.id,
      before: null,
      after: toAuditJson(row),
    });
    await enqueue(tx, "event.mom.recorded", {
      event_id: row.id,
      household_id: ctx.household_id,
      kind: event.kind,
      occurred_at: inbound.occurred_at,
    });
    return { kind: "accepted" as const, eventId: row.id };
  });

  const say = await buildSay(ctx, inbound, written.eventId);
  return { status: written.kind, event_id: written.eventId, say };
}

async function finalize(
  tx: Tx,
  inboundId: string,
  eventId: string,
  table: ResultingTable,
): Promise<void> {
  await tx
    .update(inboundEvents)
    .set({ resultingEventId: eventId, resultingTable: table, status: "accepted" })
    .where(eq(inboundEvents.id, inboundId));
}

/**
 * The Siri-readable readout. Computed AFTER the write commits, in its own
 * read transaction (TECHNICAL_SPEC §5.2 — the write path never blocks on the
 * rollup). `say` is always present so a failed Shortcut can still speak.
 */
async function buildSay(
  ctx: AuthContext,
  inbound: InboundEvent,
  eventId: string,
): Promise<string> {
  const now = new Date();
  const dayStart = currentDayStart(now);
  const event = inbound.event;

  return withUserContext(ctx.user_id, async (tx) => {
    if (event.type === "mom") return `Logged ${event.kind}.`;

    const [baby] = await tx
      .select({
        id: babies.id,
        birthDate: babies.birthDate,
        birthWeightOz: babies.birthWeightOz,
        currentWeightOz: babies.currentWeightOz,
      })
      .from(babies)
      .where(eq(babies.householdId, ctx.household_id))
      .orderBy(asc(babies.createdAt))
      .limit(1);
    const babyId = inbound.baby_id ?? baby?.id;
    if (!babyId || !baby) return "Logged.";

    if (event.type === "diaper") {
      const rows = await tx
        .select({ pee: diaperEvents.pee, poop: diaperEvents.poop })
        .from(diaperEvents)
        .where(
          and(
            eq(diaperEvents.babyId, babyId),
            gte(diaperEvents.occurredAt, dayStart),
          ),
        );
      const peeCount = rows.filter((r) => r.pee).length;
      const poopCount = rows.filter((r) => r.poop).length;
      if (event.pee && event.poop)
        return `Logged. ${peeCount} wet and ${poopCount} dirty diapers today.`;
      if (event.pee) return `Logged. ${peeCount} wet diapers today.`;
      return `Logged. ${poopCount} dirty diapers today.`;
    }

    // feed
    const rows = await tx
      .select({ estimatedOz: feedEvents.estimatedOz })
      .from(feedEvents)
      .where(
        and(eq(feedEvents.babyId, babyId), gte(feedEvents.occurredAt, dayStart)),
      );
    const todayOz =
      Math.round(
        rows.reduce((sum, r) => sum + Number(r.estimatedOz), 0) * 10,
      ) / 10;
    const currentWeightOz =
      baby.currentWeightOz === null ? null : Number(baby.currentWeightOz);
    const birthWeightOz =
      baby.birthWeightOz === null ? (currentWeightOz ?? 0) : Number(baby.birthWeightOz);
    const { lowOz: low, highOz: high } = dailyTargetRange({
      ageDays: babyAgeDays(baby.birthDate, now),
      currentWeightOz,
      birthWeightOz,
    });
    void eventId;

    let say =
      event.kind === "nursing"
        ? `Logged. ${todayOz} ounces today, target ${low} to ${high}.`
        : `Logged ${event.volume_oz} ounces. ${todayOz} total, target ${low} to ${high}.`;
    if (todayOz < low && isAfter8pmChicago(now))
      say += " Heads up — you're below today's range.";
    return say;
  });
}
