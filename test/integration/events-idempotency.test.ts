/**
 * `/api/events` idempotency + cross-source merge — drives `recordEvent`
 * directly (it is THE canonical write path; every channel funnels here).
 *
 * `recordEvent` runs through `withUserContext`, which binds the
 * `request.user_id` GUC on the SAME app_runtime connection the harness's
 * `appDb` uses (both read `process.env.DATABASE_URL`). Fixtures are
 * planted via the harness's owner `adminDb` against the same physical
 * database, so the seeded household is visible to `recordEvent` under RLS.
 *
 * Characterizes EXISTING Phase 1 behaviour — no app code is changed:
 *  - same (source, client_uuid) twice            → one row, 2nd duplicate
 *  - distinct uuids, SAME source, 3 min apart    → two rows (no merge)
 *  - cross-source within 5 min                   → merged, sources appended
 *  - a locked_at row is never a merge target     → new row instead
 */
import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { adminDb, asUser, seedTwoHouseholds, type TwoHouseholds } from "./_harness";
import { recordEvent } from "../../src/lib/record-event";
import type { AuthContext } from "../../src/lib/with-auth";
import type { InboundEvent } from "../../src/lib/voice-parser";
import { feedEvents, inboundEvents } from "../../src/lib/db/schema";

function ctxFor(
  seeded: TwoHouseholds,
  source: AuthContext["source"],
): AuthContext {
  return {
    user_id: seeded.hA.ownerId,
    household_id: seeded.hA.householdId,
    source,
    auth_method: source === "siri_shortcut" ? "bearer" : "session",
  };
}

function feedInbound(
  clientUuid: string,
  occurredAt: Date,
  volumeOz: number,
): InboundEvent {
  return {
    client_uuid: clientUuid,
    source: "pwa",
    occurred_at: occurredAt.toISOString(),
    event: { type: "feed", kind: "formula", volume_oz: volumeOz },
  };
}

describe("recordEvent idempotency + merge (Phase 1 carry-over)", () => {
  let seeded: TwoHouseholds;

  beforeEach(async () => {
    // No baseline event rows: a stray pwa/formula feed at "now" would be a
    // valid cross-source merge target and pollute the merge-window math.
    seeded = await seedTwoHouseholds(false);
  });

  it("same (source, client_uuid) twice → one row, 2nd is duplicate, same event_id", async () => {
    const ctx = ctxFor(seeded, "pwa");
    const uuid = randomUUID();
    const at = new Date();

    const first = await recordEvent(ctx, feedInbound(uuid, at, 3));
    const second = await recordEvent(ctx, feedInbound(uuid, at, 3));

    expect(first.status).toBe("accepted");
    expect(second.status).toBe("duplicate");
    expect(second.event_id).toBe(first.event_id);

    const rows = await asUser(seeded.hA.ownerId, async (tx) =>
      tx
        .select()
        .from(feedEvents)
        .where(eq(feedEvents.babyId, seeded.hA.babyId)),
    );
    // 1 seeded baseline feed + exactly 1 from this test (replay added none).
    expect(rows.filter((r) => r.clientUuid === uuid)).toHaveLength(1);

    const ledger = await asUser(seeded.hA.ownerId, async (tx) =>
      tx
        .select()
        .from(inboundEvents)
        .where(
          and(
            eq(inboundEvents.source, "pwa"),
            eq(inboundEvents.clientUuid, uuid),
          ),
        ),
    );
    expect(ledger).toHaveLength(1);
  });

  it("distinct uuids, SAME source, 3 min apart → two rows (no same-source merge)", async () => {
    const ctx = ctxFor(seeded, "pwa");
    const t0 = new Date();
    const t3 = new Date(t0.getTime() + 3 * 60 * 1000);

    const a = await recordEvent(ctx, feedInbound(randomUUID(), t0, 3));
    const b = await recordEvent(ctx, feedInbound(randomUUID(), t3, 3));

    expect(a.status).toBe("accepted");
    expect(b.status).toBe("accepted");
    expect(a.event_id).not.toBe(b.event_id);

    const rows = await asUser(seeded.hA.ownerId, async (tx) =>
      tx
        .select()
        .from(feedEvents)
        .where(eq(feedEvents.babyId, seeded.hA.babyId)),
    );
    // No seeded baseline → exactly the two distinct, unmerged feeds.
    expect(rows).toHaveLength(2);
  });

  it("cross-source within 5 min → merged, corroborating_sources appended", async () => {
    const at = new Date();
    const pwa = await recordEvent(
      ctxFor(seeded, "pwa"),
      feedInbound(randomUUID(), at, 3),
    );
    const siri = await recordEvent(
      ctxFor(seeded, "siri_shortcut"),
      {
        client_uuid: randomUUID(),
        source: "siri_shortcut",
        occurred_at: new Date(at.getTime() + 60 * 1000).toISOString(),
        event: { type: "feed", kind: "formula", volume_oz: 3 },
      },
    );

    expect(pwa.status).toBe("accepted");
    expect(siri.status).toBe("merged");
    expect(siri.event_id).toBe(pwa.event_id);

    const [merged] = await asUser(seeded.hA.ownerId, async (tx) =>
      tx
        .select()
        .from(feedEvents)
        .where(eq(feedEvents.id, pwa.event_id)),
    );
    expect(merged.corroboratingSources).toEqual(["siri_shortcut"]);
  });

  it("a locked_at row is never a merge target → a new row is created instead", async () => {
    const at = new Date();
    const pwa = await recordEvent(
      ctxFor(seeded, "pwa"),
      feedInbound(randomUUID(), at, 3),
    );

    // Lock the row (mimics a PATCH that sets locked_at) via owner conn.
    await adminDb
      .update(feedEvents)
      .set({ lockedAt: new Date() })
      .where(eq(feedEvents.id, pwa.event_id));

    const siri = await recordEvent(ctxFor(seeded, "siri_shortcut"), {
      client_uuid: randomUUID(),
      source: "siri_shortcut",
      occurred_at: new Date(at.getTime() + 60 * 1000).toISOString(),
      event: { type: "feed", kind: "formula", volume_oz: 3 },
    });

    // Locked row excluded from the merge window → a fresh accepted row.
    expect(siri.status).toBe("accepted");
    expect(siri.event_id).not.toBe(pwa.event_id);

    const rows = await asUser(seeded.hA.ownerId, async (tx) =>
      tx
        .select()
        .from(feedEvents)
        .where(eq(feedEvents.babyId, seeded.hA.babyId)),
    );
    // pwa (1, locked) + siri (1, fresh) = 2; none merged.
    expect(rows).toHaveLength(2);
  });
});
