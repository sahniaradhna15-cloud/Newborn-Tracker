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
 * Phase-1 stubs (finalized in Task 4 — grep `TODO Task 4`):
 * - nursing `estimated_oz` uses a flat 0.15 oz/min instead of the
 *   age-banded `targets.ts` rate.
 * - the `say` target band is a placeholder, not `dailyTargetRange`.
 * - "today" uses a simple 4am-Chicago day start, not the DST-tested
 *   `getDayWindow`.
 */
import { and, asc, eq, gte, isNull, lte, ne } from "drizzle-orm";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

import { db } from "./db/client";
import { babies, diaperEvents, feedEvents, inboundEvents, momEvents } from "./db/schema";
import { enqueue } from "./outbox";
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
const NURSING_OZ_PER_MIN_STUB = 0.15; // TODO Task 4: targets.nursingRateOzPerMin(ageDays)
const FEED_MERGE_WINDOW_MS = 5 * 60 * 1000;

export function round1(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

/**
 * Phase-1 `estimated_oz`: nursing = minutes × flat rate; bottle = volume − wasted
 * (wasted is tracked but excluded from intake totals). Single source of truth so
 * the insert path and the PATCH recompute cannot drift.
 * TODO Task 4: nursing rate becomes age-banded via targets.nursingRateOzPerMin.
 */
export function estimateFeedOz(input: {
  kind: "nursing" | "pumped" | "formula";
  duration_min?: number | null;
  volume_oz?: number | null;
  wasted_oz?: number | null;
}): number {
  if (input.kind === "nursing")
    return (input.duration_min ?? 0) * NURSING_OZ_PER_MIN_STUB;
  return Math.max(0, (input.volume_oz ?? 0) - (input.wasted_oz ?? 0));
}

/** TODO Task 4: replace with targets.dailyTargetRange(...). Placeholder band. */
function phase1TargetStub(): { low: number; high: number } {
  return { low: 14, high: 18 };
}

/**
 * TODO Task 4: replace with day-window.getDayWindow (DST-tested).
 * Exported so the feeds/diapers GET routes share one "today" definition
 * until Task 4 centralizes it.
 */
export function phase1DayStart(now: Date): Date {
  const wall = toZonedTime(now, TZ);
  const start = new Date(wall);
  start.setHours(DAY_START_HOUR, 0, 0, 0);
  if (wall.getHours() < DAY_START_HOUR) start.setDate(start.getDate() - 1);
  return fromZonedTime(start, TZ);
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

    // 2. Resolve baby (default = household's first baby).
    let babyId = inbound.baby_id;
    if (!babyId) {
      const [baby] = await tx
        .select({ id: babies.id })
        .from(babies)
        .where(eq(babies.householdId, ctx.household_id))
        .orderBy(asc(babies.createdAt))
        .limit(1);
      if (!baby) throw new Error("no_baby_for_household");
      babyId = baby.id;
    }

    const event = inbound.event;

    if (event.type === "feed") {
      // 3. estimated_oz (shared helper — see estimateFeedOz).
      const estimatedOz = estimateFeedOz(
        event.kind === "nursing"
          ? { kind: "nursing", duration_min: event.duration_min }
          : {
              kind: event.kind,
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
        .returning({ id: feedEvents.id });

      await finalize(tx, inboundId, row.id, "feed_events");
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
        .returning({ id: diaperEvents.id });

      await finalize(tx, inboundId, row.id, "diaper_events");
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
      .returning({ id: momEvents.id });

    await finalize(tx, inboundId, row.id, "mom_events");
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
  const dayStart = phase1DayStart(now);
  const event = inbound.event;

  return withUserContext(ctx.user_id, async (tx) => {
    if (event.type === "mom") return `Logged ${event.kind}.`;

    const [baby] = await tx
      .select({ id: babies.id })
      .from(babies)
      .where(eq(babies.householdId, ctx.household_id))
      .orderBy(asc(babies.createdAt))
      .limit(1);
    const babyId = inbound.baby_id ?? baby?.id;
    if (!babyId) return "Logged.";

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
    const { low, high } = phase1TargetStub();
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
