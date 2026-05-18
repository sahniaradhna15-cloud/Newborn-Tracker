/**
 * Runtime database client (RLS-enforced).
 *
 * Connects via the Supabase transaction-mode pooler (DATABASE_URL,
 * port 6543) as the `app_runtime` role: a non-owner role with
 * rolbypassrls=false. RLS is only ENABLE (not FORCE) on the tables, so
 * enforcement depends entirely on this connection NOT being the table
 * owner and NOT having BYPASSRLS. Do not point DATABASE_URL at `postgres`
 * (it owns the tables AND has BYPASSRLS — every policy would silently
 * no-op). App code must run queries through `withUserContext()`
 * (src/lib/with-user-context.ts) so the `request.user_id` GUC is bound
 * and the household boundary holds.
 *
 * `prepare: false` is REQUIRED: the transaction-mode pooler does not
 * support prepared statements (a well-known Supabase + postgres-js gotcha).
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

let cachedDb: ReturnType<typeof drizzle<typeof schema>> | null = null;

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill in the Supabase pooled connection string.",
    );
  }
  const client = postgres(url, { prepare: false });
  return drizzle(client, { schema });
}

/**
 * Lazily-initialized Drizzle instance. Lazy so `next build` (which may
 * import route modules without a DB env) does not crash at import time.
 */
export const db = new Proxy({} as ReturnType<typeof createDb>, {
  get(_target, prop, receiver) {
    if (!cachedDb) cachedDb = createDb();
    return Reflect.get(cachedDb, prop, receiver);
  },
});

export { schema };
