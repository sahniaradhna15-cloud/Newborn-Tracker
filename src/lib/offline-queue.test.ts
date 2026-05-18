/**
 * Phase 3 Task 2 — offline queue durability (Testing Strategy Test 2).
 *
 * Runs in the DB-free `unit` project (node env, no setup file), so IndexedDB
 * is provided per-file by `fake-indexeddb/auto` rather than a global setup —
 * keeping `vitest.config.ts` (Phase 2 Task 1) untouched.
 */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ack,
  count,
  drainQueue,
  enqueue,
  peekAll,
  resetConnectionForTests,
} from "./offline-queue";

const DB_NAME = "newborn-tracker-offline";

async function wipeDatabase(): Promise<void> {
  await resetConnectionForTests();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

function feedBody(uuid: string): Record<string, unknown> {
  return {
    client_uuid: uuid,
    occurred_at: new Date().toISOString(),
    kind: "formula",
    volume_oz: 2,
  };
}

beforeEach(wipeDatabase);
afterEach(() => {
  vi.restoreAllMocks();
});

describe("offline-queue storage", () => {
  it("enqueues 5 entries and reads them all back, oldest-first", async () => {
    for (let index = 0; index < 5; index += 1) {
      await enqueue("/api/feeds", feedBody(`uuid-${index}`));
    }

    const pending = await peekAll();

    expect(pending).toHaveLength(5);
    expect(await count()).toBe(5);
    for (let index = 1; index < pending.length; index += 1) {
      expect(pending[index].queued_at).toBeGreaterThanOrEqual(
        pending[index - 1].queued_at,
      );
    }
  });

  it("ack removes exactly one entry", async () => {
    await enqueue("/api/feeds", feedBody("keep-1"));
    await enqueue("/api/feeds", feedBody("drop"));
    await enqueue("/api/feeds", feedBody("keep-2"));

    await ack("drop");

    const remaining = await peekAll();
    expect(remaining).toHaveLength(2);
    expect(remaining.map((entry) => entry.client_uuid).sort()).toEqual([
      "keep-1",
      "keep-2",
    ]);
    expect(await count()).toBe(2);
  });

  it("persists entries across a fresh database connection", async () => {
    await enqueue("/api/feeds", feedBody("survives-1"));
    await enqueue("/api/diapers", {
      client_uuid: "survives-2",
      occurred_at: new Date().toISOString(),
      pee: true,
      poop: false,
    });
    await enqueue("/api/feeds", feedBody("survives-3"));

    // Drops the cached IDBDatabase (and the in-memory fallback), forcing the
    // next call to open a brand-new connection to the same durable store.
    await resetConnectionForTests();

    const pending = await peekAll();
    expect(pending.map((entry) => entry.client_uuid).sort()).toEqual([
      "survives-1",
      "survives-2",
      "survives-3",
    ]);
  });

  it("falls back without losing prior entries when the store hits quota", async () => {
    await enqueue("/api/feeds", feedBody("prior-1"));
    await enqueue("/api/feeds", feedBody("prior-2"));

    // Force the next readwrite transaction (the quota-bound enqueue) to throw
    // QuotaExceededError, exactly as Safari does under storage pressure.
    vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementationOnce(
      () => {
        throw new DOMException("storage full", "QuotaExceededError");
      },
    );

    await expect(
      enqueue("/api/feeds", feedBody("quota-victim")),
    ).resolves.toBeUndefined();

    const pending = await peekAll();
    const uuids = pending.map((entry) => entry.client_uuid).sort();
    expect(uuids).toEqual(["prior-1", "prior-2", "quota-victim"]);
    expect(await count()).toBe(3);
  });
});

describe("offline-queue drain", () => {
  it("acks accepted and malformed entries, keeps retriable ones", async () => {
    await enqueue("/api/feeds", feedBody("accepted"));
    await enqueue("/api/feeds", feedBody("malformed"));
    await enqueue("/api/feeds", feedBody("retry-later"));

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { client_uuid: string };
        if (body.client_uuid === "accepted") {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        if (body.client_uuid === "malformed") {
          return new Response(JSON.stringify({ ok: false }), { status: 400 });
        }
        return new Response("upstream down", { status: 503 });
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await drainQueue();

    expect(result.drained).toBe(2); // accepted (2xx) + malformed (4xx, unrecoverable)
    expect(result.remaining).toBe(1);
    const left = await peekAll();
    expect(left.map((entry) => entry.client_uuid)).toEqual(["retry-later"]);

    vi.unstubAllGlobals();
  });
});
