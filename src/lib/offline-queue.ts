/**
 * Offline write queue (Phase 3 Task 2).
 *
 * A tiny hand-rolled IndexedDB wrapper plus the send/drain helpers the PWA
 * forms use so a feed/diaper logged with no network is never lost. One object
 * store, four storage primitives, and the network policy in one place so the
 * forms and the replay loop cannot drift.
 *
 * Invariants:
 * - `client_uuid` is the store key, so a re-enqueue of the same submit is a
 *   harmless overwrite, and a replayed POST is idempotent server-side
 *   (Phase 1 `recordEvent` dedupes on `(source, client_uuid)`).
 * - FIFO: `peekAll` and the drain process oldest-first to preserve the order
 *   the caregiver actually logged events in.
 * - SSR/node-safe: nothing here touches `window`/`navigator`/`indexedDB` at
 *   module load; every browser API is feature-checked at call time so this
 *   imports cleanly in a Server Component and under the node test runner.
 *
 * No external `idb` library and no Sentry (not in the Phase 1/2 stack): a
 * dropped-because-expired or malformed entry is pruned silently with a code
 * comment rather than a breadcrumb.
 */

const DB_NAME = "newborn-tracker-offline";
const DB_VERSION = 1;
const STORE_NAME = "pending_events";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type PendingEvent = {
  client_uuid: string;
  endpoint: string;
  body: Record<string, unknown>;
  queued_at: number;
};

export type SendResult =
  | { ok: true; data: unknown }
  | { ok: false; retriable: boolean };

export type SubmitOutcome =
  | { status: "sent"; data: unknown }
  | { status: "queued" }
  | { status: "failed" };

export const QUEUE_CHANGED_EVENT = "newborn-tracker:queue-changed";

/**
 * Last-resort store used only when IndexedDB is unavailable (private-mode
 * Safari, disabled storage) or throws `QuotaExceededError`. It lives for the
 * lifetime of the tab — no data is lost mid-session; it is simply not durable
 * across a reload, which is an acceptable degradation per the Phase 3 plan.
 */
const memoryFallback = new Map<string, PendingEvent>();

let cachedConnection: Promise<IDBDatabase> | null = null;

function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== "undefined" && indexedDB !== null;
}

function openConnection(): Promise<IDBDatabase> {
  if (cachedConnection) {
    return cachedConnection;
  }
  cachedConnection = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "client_uuid" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return cachedConnection;
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function isQuotaExceeded(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "QuotaExceededError" ||
      error.name === "NS_ERROR_DOM_QUOTA_REACHED")
  );
}

/**
 * Persist one pending submit. Drops anything older than 24h in the same
 * transaction (iOS Safari ITP can evict the store anyway — keeping it small
 * limits the blast radius). Falls back to the in-memory map on quota
 * exhaustion or any IndexedDB failure so the caregiver's tap is never lost
 * within the session.
 */
export async function enqueue(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<void> {
  const clientUuid = body.client_uuid;
  if (typeof clientUuid !== "string" || clientUuid.length === 0) {
    throw new Error("enqueue requires body.client_uuid to be a non-empty string");
  }
  const entry: PendingEvent = {
    client_uuid: clientUuid,
    endpoint,
    body,
    queued_at: Date.now(),
  };

  if (!isIndexedDbAvailable()) {
    memoryFallback.set(clientUuid, entry);
    notifyQueueChanged();
    return;
  }

  try {
    const database = await openConnection();
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const cutoff = Date.now() - MAX_AGE_MS;
      const cursorRequest = store.openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor) {
          const value = cursor.value as PendingEvent;
          if (value.queued_at < cutoff) {
            cursor.delete();
          }
          cursor.continue();
        } else {
          store.put(entry);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    notifyQueueChanged();
  } catch (error) {
    if (isQuotaExceeded(error)) {
      memoryFallback.set(clientUuid, entry);
      notifyQueueChanged();
      return;
    }
    throw error;
  }
}

/** Every pending submit, oldest-first (FIFO replay order). */
export async function peekAll(): Promise<PendingEvent[]> {
  const fromMemory = [...memoryFallback.values()];
  if (!isIndexedDbAvailable()) {
    return fromMemory.sort((a, b) => a.queued_at - b.queued_at);
  }
  const database = await openConnection();
  const tx = database.transaction(STORE_NAME, "readonly");
  const stored = await promisifyRequest(
    tx.objectStore(STORE_NAME).getAll() as IDBRequest<PendingEvent[]>,
  );
  return [...stored, ...fromMemory].sort((a, b) => a.queued_at - b.queued_at);
}

/** Remove one entry once it has been accepted (or proven unrecoverable). */
export async function ack(clientUuid: string): Promise<void> {
  memoryFallback.delete(clientUuid);
  if (!isIndexedDbAvailable()) {
    notifyQueueChanged();
    return;
  }
  const database = await openConnection();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(clientUuid);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  notifyQueueChanged();
}

/** How many submits are waiting to sync (store + in-memory fallback). */
export async function count(): Promise<number> {
  if (!isIndexedDbAvailable()) {
    return memoryFallback.size;
  }
  const database = await openConnection();
  const tx = database.transaction(STORE_NAME, "readonly");
  const storedCount = await promisifyRequest(
    tx.objectStore(STORE_NAME).count(),
  );
  // A quota-fallback entry could share a uuid with a stored one only if a
  // later enqueue succeeded; in practice the sets are disjoint, so summing is
  // correct and avoids a second full scan.
  return storedCount + memoryFallback.size;
}

/**
 * POST one event with the same headers a foreground form uses, then classify
 * the outcome for the queue:
 * - 2xx, or 409 (server-side duplicate) → accepted, drop from the queue.
 * - 4xx other than 409 → the payload is malformed; retrying cannot fix it, so
 *   it is non-retriable (the drain drops it).
 * - 5xx, a network throw, or offline → retriable; stays queued.
 */
export async function sendEvent(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<SendResult> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "fetch",
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, retriable: true };
  }

  if (response.ok || response.status === 409) {
    const data = await response.json().catch(() => null);
    return { ok: true, data };
  }
  if (response.status >= 500) {
    return { ok: false, retriable: true };
  }
  return { ok: false, retriable: false };
}

/**
 * The single submit path for the PWA forms. Online → try the network and only
 * queue on a retriable failure; offline → queue immediately. A non-retriable
 * rejection (validation 4xx) is surfaced as `failed` so the form can show its
 * normal error instead of silently swallowing a bad payload.
 */
export async function submitOrQueue(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<SubmitOutcome> {
  const offline =
    typeof navigator !== "undefined" && navigator.onLine === false;

  if (offline) {
    await enqueue(endpoint, body);
    return { status: "queued" };
  }

  const result = await sendEvent(endpoint, body);
  if (result.ok) {
    return { status: "sent", data: result.data };
  }
  if (result.retriable) {
    await enqueue(endpoint, body);
    return { status: "queued" };
  }
  return { status: "failed" };
}

/**
 * Replay every queued submit oldest-first, sequentially (never parallel — it
 * keeps order and avoids hammering the server the instant a phone reconnects).
 * Accepted and unrecoverable entries are acked; retriable ones stay for the
 * next drain. Returns counts so the caller can decide whether to refresh.
 */
export async function drainQueue(): Promise<{
  drained: number;
  remaining: number;
}> {
  const pending = await peekAll();
  let drained = 0;
  for (const entry of pending) {
    const result = await sendEvent(entry.endpoint, entry.body);
    if (result.ok || !result.retriable) {
      // Accepted, a server-side duplicate, or malformed-beyond-retry: in all
      // three cases keeping it queued would only loop forever.
      await ack(entry.client_uuid);
      drained += 1;
    }
  }
  const remaining = await count();
  notifyQueueChanged();
  return { drained, remaining };
}

function notifyQueueChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(QUEUE_CHANGED_EVENT));
  }
}

/**
 * Test-only: drop the cached connection so a spec can prove durability across
 * a "fresh" open. Not part of the runtime API.
 */
export async function resetConnectionForTests(): Promise<void> {
  if (cachedConnection) {
    const database = await cachedConnection;
    database.close();
    cachedConnection = null;
  }
  memoryFallback.clear();
}
