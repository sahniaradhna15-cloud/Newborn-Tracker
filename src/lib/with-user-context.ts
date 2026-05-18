/**
 * RLS context wrapper. THE single correct way to query app tables.
 *
 * Opens one transaction, binds the `request.user_id` GUC that every
 * RLS policy reads (see migrations/0000_*.sql), then runs `fn`. Outside
 * this wrapper the GUC is unset, so `current_user_households()` returns
 * the empty set and every household-scoped policy denies every row —
 * provided the connection role is `app_runtime` (non-owner, NOBYPASSRLS).
 *
 * Bypassing this for a normal query is a P0 bug: it does not "leak a
 * little", it removes the household boundary entirely.
 *
 * `set_config(key, value, is_local=true)` scopes the GUC to the current
 * transaction, so it cannot bleed across pooled connections.
 */
import { sql } from "drizzle-orm";

import { db } from "./db/client";

type TransactionCallback = Parameters<typeof db.transaction>[0];
type Tx = Parameters<TransactionCallback>[0];

export async function withUserContext<T>(
  userId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('request.user_id', ${userId}, true)`);
    return fn(tx);
  });
}
