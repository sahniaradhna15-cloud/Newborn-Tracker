/**
 * SERVICE-ROLE database access — BYPASSES Row Level Security.
 *
 * ALLOWED IN EXACTLY TWO FILES (CLAUDE.md §13):
 *   1. src/lib/db/admin.ts                              (this file)
 *   2. src/app/api/onboarding/create-household/route.ts (the only caller)
 * Importing `withAdmin` anywhere else is a P0 security bug. The Phase 2
 * security checklist audits the import graph of this module.
 *
 * Why this exists: onboarding must insert the first user / household /
 * baby BEFORE any session (and thus any `request.user_id`) exists, so it
 * cannot satisfy the GUC-based RLS policies. This path connects via
 * DATABASE_URL_ADMIN (the `postgres` role) — the runtime DATABASE_URL is
 * the locked-down `app_runtime` role, which deliberately CANNOT assume
 * `service_role`. It then `SET LOCAL ROLE service_role` (BYPASSRLS) for
 * the insert. `SET LOCAL ROLE` is transaction-scoped so the elevation
 * cannot leak onto a pooled connection.
 *
 * `service_role` is a fixed trusted constant, never user input.
 */
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

let cachedAdminDb: ReturnType<typeof drizzle<typeof schema>> | null = null;

function createAdminDb() {
  const url = process.env.DATABASE_URL_ADMIN;
  if (!url) {
    throw new Error(
      "DATABASE_URL_ADMIN is not set. It must be the `postgres`-role pooled connection (the only role that can SET ROLE service_role). See .env.example.",
    );
  }
  const client = postgres(url, { prepare: false });
  return drizzle(client, { schema });
}

function getAdminDb() {
  if (!cachedAdminDb) cachedAdminDb = createAdminDb();
  return cachedAdminDb;
}

type TransactionCallback = Parameters<
  ReturnType<typeof createAdminDb>["transaction"]
>[0];
type Tx = Parameters<TransactionCallback>[0];

/**
 * Runs `fn` in one transaction elevated to `service_role` (BYPASSRLS).
 * Use only for the pre-session onboarding insert.
 */
export async function withAdmin<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return getAdminDb().transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE service_role`);
    return fn(tx);
  });
}
