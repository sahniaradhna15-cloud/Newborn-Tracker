/**
 * Postgres-backed fixed-window rate limiter (Decision #7 — no Redis in
 * the stack, CLAUDE.md §2; §13 rate-limit requirements).
 *
 * Correct under serverless cold starts (an in-memory counter would
 * reset on every new lambda). One `rate_limits` row per logical key
 * (e.g. `recovery_redeem:<ip>`):
 *
 *   - If no row, or the row's window has elapsed → start a fresh window
 *     at count 1 and ALLOW.
 *   - Else if count < limit → increment and ALLOW.
 *   - Else → DENY (the soft block: the window simply has to elapse).
 *
 * `consume` runs inside the caller's transaction handle so the
 * limit-check and the protected side effect commit/rollback together.
 * It is written for the service-role (`adminDb`) path the pre-session
 * routes use; `rate_limits` has RLS ENABLEd with no policy, so the
 * non-owner `app_runtime` role cannot touch it (fail-closed by design —
 * see migrations/0002_rate_limits.sql).
 *
 * The UPSERT is atomic via `INSERT ... ON CONFLICT ... DO UPDATE` with
 * a `WHERE` that only resets/increments under the documented
 * conditions, so two concurrent requests cannot both slip past the
 * boundary (the row is locked for the conflicting writer).
 */
import { sql } from "drizzle-orm";

import type { withAdmin } from "./db/admin";

type AdminTxCallback = Parameters<typeof withAdmin>[0];
type AdminTx = Parameters<AdminTxCallback>[0];

/**
 * @param tx          service-role transaction (from `withAdmin`)
 * @param key         bucket identity, e.g. `recovery_redeem:1.2.3.4`
 * @param limit       max allowed actions per window
 * @param windowSec   fixed window length in seconds
 * @returns `true` if the action is allowed (quota consumed), `false`
 *          if the caller is over the limit and must be rejected.
 */
export async function consume(
  tx: AdminTx,
  key: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  const rows = await tx.execute<{ allowed: boolean }>(sql`
    INSERT INTO rate_limits (key, window_start, count)
    VALUES (${key}, now(), 1)
    ON CONFLICT (key) DO UPDATE
      SET
        window_start = CASE
          WHEN rate_limits.window_start < now() - (${windowSec} * interval '1 second')
            THEN now()
          ELSE rate_limits.window_start
        END,
        count = CASE
          WHEN rate_limits.window_start < now() - (${windowSec} * interval '1 second')
            THEN 1
          ELSE rate_limits.count + 1
        END
    RETURNING (count <= ${limit}) AS allowed
  `);

  const first = (rows as unknown as Array<{ allowed: boolean }>)[0];
  return first?.allowed === true;
}
