/**
 * P0 — Risk R1: cross-household Row Level Security isolation.
 *
 * This is the single most security-sensitive test in the project. It
 * proves, against a REAL Postgres connected as the non-owner
 * `app_runtime` role, that:
 *
 *  1. A user in household A cannot SELECT household B's feed / diaper /
 *     weight / baby rows (and vice-versa).
 *  2. With NO `request.user_id` GUC bound at all, every household table
 *     returns zero rows (policy denies by default — fail closed).
 *  3. `mom_events_self`: a co-member of the same household still cannot
 *     read another member's `mom_events`; the author sees only their own.
 *  4. Write-isolation corollary: a row inserted by A is invisible to B.
 *
 * If any assertion here fails it is a Phase 1 RLS regression and Phase 2
 * feature work is BLOCKED until it is fixed (CLAUDE.md §12/§13). The
 * harness's `assertAppDbIsRlsEnforced()` guarantees we are not
 * false-passing on an owner/superuser connection.
 */
import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  appDb,
  asUser,
  seedTwoHouseholds,
  type TwoHouseholds,
} from "./_harness";
import {
  babies,
  diaperEvents,
  feedEvents,
  momEvents,
  weightEvents,
} from "../../src/lib/db/schema";

describe("RLS cross-household isolation (P0 R1)", () => {
  let seeded: TwoHouseholds;

  beforeEach(async () => {
    seeded = await seedTwoHouseholds();
  });

  it("owner A sees only household A's feed/diaper/weight/baby rows", async () => {
    const asA = await asUser(seeded.hA.ownerId, async (tx) => ({
      feeds: await tx.select().from(feedEvents),
      diapers: await tx.select().from(diaperEvents),
      weights: await tx.select().from(weightEvents),
      babies: await tx.select().from(babies),
    }));

    expect(asA.feeds).toHaveLength(1);
    expect(asA.feeds[0].babyId).toBe(seeded.hA.babyId);
    expect(asA.diapers).toHaveLength(1);
    expect(asA.diapers[0].babyId).toBe(seeded.hA.babyId);
    expect(asA.weights).toHaveLength(1);
    expect(asA.weights[0].babyId).toBe(seeded.hA.babyId);
    expect(asA.babies).toHaveLength(1);
    expect(asA.babies[0].id).toBe(seeded.hA.babyId);

    // Not one row of B leaked through.
    for (const f of asA.feeds) expect(f.babyId).not.toBe(seeded.hB.babyId);
    for (const b of asA.babies) expect(b.id).not.toBe(seeded.hB.babyId);
  });

  it("owner B symmetrically sees only household B's rows", async () => {
    const asB = await asUser(seeded.hB.ownerId, async (tx) => ({
      feeds: await tx.select().from(feedEvents),
      babies: await tx.select().from(babies),
    }));

    expect(asB.feeds).toHaveLength(1);
    expect(asB.feeds[0].babyId).toBe(seeded.hB.babyId);
    expect(asB.babies).toHaveLength(1);
    expect(asB.babies[0].id).toBe(seeded.hB.babyId);
  });

  it("explicitly cannot read the OTHER household's rows by id", async () => {
    const crossRead = await asUser(seeded.hA.ownerId, async (tx) => ({
      bFeeds: await tx
        .select()
        .from(feedEvents)
        .where(eq(feedEvents.babyId, seeded.hB.babyId)),
      bBaby: await tx
        .select()
        .from(babies)
        .where(eq(babies.id, seeded.hB.babyId)),
      bDiapers: await tx
        .select()
        .from(diaperEvents)
        .where(eq(diaperEvents.babyId, seeded.hB.babyId)),
      bWeights: await tx
        .select()
        .from(weightEvents)
        .where(eq(weightEvents.babyId, seeded.hB.babyId)),
    }));

    expect(crossRead.bFeeds).toHaveLength(0);
    expect(crossRead.bBaby).toHaveLength(0);
    expect(crossRead.bDiapers).toHaveLength(0);
    expect(crossRead.bWeights).toHaveLength(0);
  });

  it("with NO request.user_id GUC, every household table returns zero rows", async () => {
    // Raw appDb, deliberately WITHOUT asUser/withUserContext → the GUC is
    // unset → current_user_households() is empty → policies deny all.
    const noCtx = await appDb.transaction(async (tx) => ({
      feeds: await tx.select({ c: sql<number>`count(*)::int` }).from(feedEvents),
      diapers: await tx
        .select({ c: sql<number>`count(*)::int` })
        .from(diaperEvents),
      weights: await tx
        .select({ c: sql<number>`count(*)::int` })
        .from(weightEvents),
      babies: await tx.select({ c: sql<number>`count(*)::int` }).from(babies),
      momEvents: await tx
        .select({ c: sql<number>`count(*)::int` })
        .from(momEvents),
    }));

    expect(noCtx.feeds[0].c).toBe(0);
    expect(noCtx.diapers[0].c).toBe(0);
    expect(noCtx.weights[0].c).toBe(0);
    expect(noCtx.babies[0].c).toBe(0);
    expect(noCtx.momEvents[0].c).toBe(0);
  });

  it("mom_events_self: a same-household co-member cannot read the owner's mom_events", async () => {
    // Owner A logs a private medication note.
    await asUser(seeded.hA.ownerId, async (tx) => {
      await tx.insert(momEvents).values({
        userId: seeded.hA.ownerId,
        householdId: seeded.hA.householdId,
        occurredAt: new Date(),
        kind: "medication",
        payload: { drug: "redacted" },
        source: "pwa",
      });
    });

    // The caregiver IS a member of household A, but mom_events is self-only.
    const caregiverView = await asUser(seeded.caregiverInHA, async (tx) =>
      tx.select().from(momEvents),
    );
    expect(caregiverView).toHaveLength(0);

    // The author sees exactly their own row.
    const ownerView = await asUser(seeded.hA.ownerId, async (tx) =>
      tx.select().from(momEvents),
    );
    expect(ownerView).toHaveLength(1);
    expect(ownerView[0].userId).toBe(seeded.hA.ownerId);
  });

  it("mom_events WITH CHECK: a member cannot forge a mom_events row for another user", async () => {
    await expect(
      asUser(seeded.caregiverInHA, async (tx) => {
        await tx.insert(momEvents).values({
          userId: seeded.hA.ownerId, // forging for someone else
          householdId: seeded.hA.householdId,
          occurredAt: new Date(),
          kind: "mood",
          payload: { mood: "forged" },
          source: "pwa",
        });
      }),
    ).rejects.toThrow();
  });

  it("write-isolation corollary: a row A inserts is invisible to B", async () => {
    const insertedId = await asUser(seeded.hA.ownerId, async (tx) => {
      const [row] = await tx
        .insert(diaperEvents)
        .values({
          babyId: seeded.hA.babyId,
          loggedBy: seeded.hA.ownerId,
          occurredAt: new Date(),
          pee: true,
          poop: true,
          source: "pwa",
        })
        .returning({ id: diaperEvents.id });
      return row.id;
    });

    const bView = await asUser(seeded.hB.ownerId, async (tx) =>
      tx
        .select()
        .from(diaperEvents)
        .where(eq(diaperEvents.id, insertedId)),
    );
    expect(bView).toHaveLength(0);

    // Sanity: A can still see its own write.
    const aView = await asUser(seeded.hA.ownerId, async (tx) =>
      tx
        .select()
        .from(diaperEvents)
        .where(
          and(
            eq(diaperEvents.id, insertedId),
            eq(diaperEvents.babyId, seeded.hA.babyId),
          ),
        ),
    );
    expect(aView).toHaveLength(1);
  });

  it("a member cannot INSERT a feed for the OTHER household's baby (WITH CHECK)", async () => {
    await expect(
      asUser(seeded.hA.ownerId, async (tx) => {
        await tx.insert(feedEvents).values({
          babyId: seeded.hB.babyId, // cross-household target
          loggedBy: seeded.hA.ownerId,
          occurredAt: new Date(),
          kind: "formula",
          volumeOz: "2.0",
          estimatedOz: "2.0",
          source: "pwa",
        });
      }),
    ).rejects.toThrow();
  });
});
