/**
 * `writeAudit` — append one immutable `event_audit` row INSIDE the
 * caller's transaction (CLAUDE.md §11.4, Decision #5 "Edit audit trail").
 *
 * Invariants:
 * - Runs in the SAME transaction as the mutation it records, so the
 *   domain write and its audit row commit or roll back together — there
 *   is never an unaudited mutation or an audit row without its mutation.
 * - `event_audit` is append-only by contract (no UPDATE/DELETE policy in
 *   migrations/0000_*.sql). A correction is a NEW row, never an edit.
 * - The RLS `event_audit_household_insert` policy requires the row's
 *   `household_id` to be one of the caller's households, so this MUST be
 *   called from inside `withUserContext` (or the `adminDb`/service-role
 *   tx for the no-session accept/redeem paths).
 *
 * No PII (CLAUDE.md §13): event rows carry no names; `before`/`after`
 * are the row JSON as-is. Callers MUST NOT pass raw tokens, recovery
 * codes, or session values in `before`/`after`/`ip`.
 *
 * `kind` is one of the CLAUDE.md §7 dotted past-tense audit kinds:
 *   feed.created|updated|deleted, diaper.created|updated|deleted,
 *   mom.created, access_link.issued|redeemed,
 *   recovery_code.rotated|redeemed, caregiver.revoked,
 *   ownership.transferred.
 */
import type { db } from "./db/client";
import { eventAudit } from "./db/schema";

type TransactionCallback = Parameters<typeof db.transaction>[0];
type Tx = Parameters<TransactionCallback>[0];

export type AuditKind =
  | "feed.created"
  | "feed.updated"
  | "feed.deleted"
  | "diaper.created"
  | "diaper.updated"
  | "diaper.deleted"
  | "mom.created"
  | "access_link.issued"
  | "access_link.redeemed"
  | "recovery_code.rotated"
  | "recovery_code.redeemed"
  | "caregiver.revoked"
  | "ownership.transferred";

type JsonRecord = Record<string, unknown>;

export type WriteAuditInput = {
  actor_user_id: string;
  household_id: string;
  kind: AuditKind;
  entity_table: string;
  entity_id: string;
  before: JsonRecord | null;
  after: JsonRecord | null;
  ip?: string | null;
};

/**
 * Inserts the audit row using the caller's transaction handle so it
 * shares the mutation's atomic boundary. Returns nothing — a failed
 * insert throws and rolls back the whole transaction (correct: an
 * unauditable mutation must not commit).
 */
export async function writeAudit(tx: Tx, input: WriteAuditInput): Promise<void> {
  await tx.insert(eventAudit).values({
    actorUserId: input.actor_user_id,
    householdId: input.household_id,
    kind: input.kind,
    entityTable: input.entity_table,
    entityId: input.entity_id,
    before: input.before,
    after: input.after,
    ip: input.ip ?? null,
  });
}

/**
 * Drizzle returns Date objects and numeric columns as strings; JSON
 * serialization for the `before`/`after` payloads is lossy-but-stable
 * here. This narrows an inserted/selected row to a plain JSON record so
 * it can be stored without leaking class instances. No field is removed
 * — event rows have no PII (CLAUDE.md §13).
 */
export function toAuditJson(row: Record<string, unknown>): JsonRecord {
  return JSON.parse(JSON.stringify(row)) as JsonRecord;
}
