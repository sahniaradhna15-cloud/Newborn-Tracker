/**
 * Transactional outbox writer (the trigger seam — TECHNICAL_SPEC §"Outbound").
 *
 * `enqueue` inserts one `event_outbox` row INSIDE the caller's transaction, so
 * the domain write and its outbound notification commit or roll back together
 * (no lost events, no phantom events). There is intentionally NO consumer in
 * Phase 1 — rows accumulate; a worker fans them out in a later phase. Do not
 * add dispatch logic here.
 *
 * Topics are flat, dotted, past-tense (CLAUDE.md §7): `event.feed.recorded`,
 * `event.diaper.recorded`, `event.mom.recorded`.
 */
import { db } from "./db/client";
import { eventOutbox } from "./db/schema";

type TransactionCallback = Parameters<typeof db.transaction>[0];
type Tx = Parameters<TransactionCallback>[0];

export async function enqueue(
  tx: Tx,
  topic: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await tx.insert(eventOutbox).values({ topic, payload });
}
