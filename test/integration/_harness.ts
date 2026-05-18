/**
 * Integration-test harness — the load-bearing security fixture.
 *
 * Exposes two connections to ONE Postgres database:
 *
 *  - `appDb`   — bound as the non-owner **`app_runtime`** role
 *                (LOGIN, NOBYPASSRLS, not the table owner). RLS IS
 *                ENFORCED here. Every assertion about isolation runs
 *                through this connection, via `asUser()` (which binds the
 *                `request.user_id` GUC the policies read) or raw (no GUC →
 *                policies must deny every row). This is the entire point
 *                of the gate.
 *
 *  - `adminDb` — bound as the `postgres` / table-owner role, which on
 *                Supabase owns every table AND has BYPASSRLS (CLAUDE.md
 *                §8). Used ONLY for fixture setup/teardown
 *                (`seedTwoHouseholds`, `truncateAll`) so tests can plant
 *                cross-household data that `appDb` then must NOT be able
 *                to read across the boundary.
 *
 * --- Test-DB connection decision (Phase 2 Task 1) -------------------
 * The plan documents an optional dedicated `DATABASE_URL_TEST`. None is
 * configured in this environment, so per the Task 1 fallback rule we
 * reuse the project's existing dev connections from .env.local:
 *
 *   appDb   ← DATABASE_URL        (the app_runtime pooled conn — RLS on)
 *   adminDb ← DATABASE_URL_ADMIN  (the postgres owner conn — RLS bypass)
 *
 * `DATABASE_URL_TEST` / `DATABASE_URL_ADMIN_TEST` are honored first if
 * present, so a dedicated throwaway DB can be slotted in later with no
 * code change. Isolation between tests is provided by `truncateAll()`
 * in an `afterEach` hook — the suite is destructive to whatever DB it
 * points at, which is acceptable for the local dev database (it is
 * re-seeded with `pnpm db:seed`, and the gate seeds its own fixtures).
 *
 * --- Superuser / owner false-pass guard ----------------------------
 * If `appDb` ever connects as the table owner or a BYPASSRLS role, RLS
 * silently no-ops and this whole gate FALSE-PASSES (CLAUDE.md §8,
 * memory `project_rls_app_runtime_role`). `assertAppDbIsRlsEnforced()`
 * therefore refuses to run unless the appDb role is NOT `postgres`, has
 * `rolbypassrls = false`, and `is_superuser = off`. A misconfig throws
 * loudly with the CLAUDE.md citation rather than producing a green run.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll } from "vitest";

import * as schema from "../../src/lib/db/schema";

/* ------------------------------------------------------------------ */
/* Env loading (Vitest does not auto-load .env.local for node tests)  */
/* ------------------------------------------------------------------ */

try {
  // Node 20+ — same approach drizzle.config.ts / seed.ts use.
  process.loadEnvFile(".env.local");
} catch {
  // .env.local absent — rely on the ambient environment (CI).
}

const APP_DB_URL = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL;
const ADMIN_DB_URL =
  process.env.DATABASE_URL_ADMIN_TEST ??
  process.env.DATABASE_URL_ADMIN ??
  process.env.DATABASE_URL_DIRECT;

if (!APP_DB_URL) {
  throw new Error(
    "[integration harness] No app-runtime DB URL. Set DATABASE_URL_TEST " +
      "(preferred) or DATABASE_URL in .env.local to the NON-OWNER " +
      "`app_runtime` pooled connection. This gate cannot run without a " +
      "real RLS-enforcing connection (CLAUDE.md §8).",
  );
}
if (!ADMIN_DB_URL) {
  throw new Error(
    "[integration harness] No owner/admin DB URL. Set DATABASE_URL_ADMIN_TEST, " +
      "DATABASE_URL_ADMIN, or DATABASE_URL_DIRECT in .env.local to the " +
      "`postgres` owner connection (fixture setup/teardown bypasses RLS).",
  );
}

/* ------------------------------------------------------------------ */
/* Connections                                                         */
/* ------------------------------------------------------------------ */

// `prepare: false` is mandatory on the Supabase transaction-mode pooler
// (same constraint as src/lib/db/client.ts). `max: 1` keeps the GUC /
// transaction semantics predictable on a serial suite.
const appClient = postgres(APP_DB_URL, { prepare: false, max: 1 });
const adminClient = postgres(ADMIN_DB_URL, { prepare: false, max: 1 });

export const appDb = drizzle(appClient, { schema });
export const adminDb = drizzle(adminClient, { schema });

/* ------------------------------------------------------------------ */
/* The false-pass guard                                                */
/* ------------------------------------------------------------------ */

/**
 * Asserts the `appDb` connection genuinely enforces RLS. If it connects
 * as the table owner / a BYPASSRLS role, every policy is a silent no-op
 * and the isolation tests would FALSE-PASS — worse than an honest
 * failure (CLAUDE.md §8). Throws loudly on any of those conditions.
 */
export async function assertAppDbIsRlsEnforced(): Promise<void> {
  const [row] = await appClient<
    {
      current_user: string;
      is_superuser: string;
      rolbypassrls: boolean;
    }[]
  >`
    SELECT
      current_user,
      current_setting('is_superuser') AS is_superuser,
      (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS rolbypassrls
  `;

  const problems: string[] = [];
  if (row.current_user === "postgres") {
    problems.push(
      `appDb connected as "postgres" — the table OWNER. RLS is ENABLE (not ` +
        `FORCE) so the owner bypasses every policy.`,
    );
  }
  if (row.rolbypassrls === true) {
    problems.push(
      `appDb role "${row.current_user}" has rolbypassrls=true — RLS is a no-op.`,
    );
  }
  if (row.is_superuser !== "off") {
    problems.push(
      `appDb role "${row.current_user}" is a superuser (is_superuser=` +
        `${row.is_superuser}) — RLS is a no-op.`,
    );
  }

  if (problems.length > 0) {
    throw new Error(
      "[integration harness] RLS FALSE-PASS GUARD TRIPPED.\n" +
        problems.map((p) => `  - ${p}`).join("\n") +
        "\n\nThe RLS isolation gate would silently pass while enforcing " +
        "nothing. Point DATABASE_URL_TEST/DATABASE_URL at the non-owner " +
        "`app_runtime` role (LOGIN, NOBYPASSRLS, not the table owner). " +
        "See CLAUDE.md §8 and memory `project_rls_app_runtime_role`.",
    );
  }
}

/* ------------------------------------------------------------------ */
/* Migrations (idempotent)                                             */
/* ------------------------------------------------------------------ */

const APP_TABLES = [
  "rate_limits",
  "event_audit",
  "inbound_events",
  "event_outbox",
  "mom_events",
  "diaper_events",
  "feed_events",
  "weight_events",
  "babies",
  "api_tokens",
  "recovery_codes",
  "invites",
  "household_members",
  "households",
  "sessions",
  "users",
] as const;

/**
 * Ensures the schema is present. The migrations are hand-authored SQL
 * with the RLS blocks appended; `pnpm db:migrate` owns first-time setup.
 * Here we only need an idempotent guard per migration — each is keyed on
 * a sentinel table it creates (`feed_events` for 0000, `rate_limits` for
 * 0002). If the sentinel is absent we apply that migration via the admin
 * (owner) connection so the suite is self-bootstrapping on a fresh DB.
 */
async function tableExists(name: string): Promise<boolean> {
  const [{ present }] = await adminClient<{ present: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${name}
    ) AS present
  `;
  return present;
}

async function applyMigration(file: string): Promise<void> {
  const ddl = readFileSync(
    resolve(process.cwd(), "src/lib/db/migrations", file),
    "utf8",
  );
  // drizzle-kit uses this exact statement separator.
  const statements = ddl
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const statement of statements) {
    await adminClient.unsafe(statement);
  }
}

export async function runMigrations(): Promise<void> {
  if (!(await tableExists("feed_events"))) {
    await applyMigration("0000_loud_leech.sql");
  }
  if (!(await tableExists("rate_limits"))) {
    await applyMigration("0002_rate_limits.sql");
  }
}

/* ------------------------------------------------------------------ */
/* Truncation (between every test)                                     */
/* ------------------------------------------------------------------ */

/**
 * Wipes every app table via the owner connection (bypasses RLS).
 * RESTART IDENTITY + CASCADE so FK chains and the `event_outbox` bigserial
 * reset cleanly between tests.
 */
export async function truncateAll(): Promise<void> {
  const list = APP_TABLES.map((t) => `"${t}"`).join(", ");
  await adminClient.unsafe(
    `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`,
  );
}

/* ------------------------------------------------------------------ */
/* RLS-bound query helper (mirrors src/lib/with-user-context.ts)       */
/* ------------------------------------------------------------------ */

type AppTx = Parameters<Parameters<typeof appDb.transaction>[0]>[0];

/**
 * Runs `fn` inside one `appDb` transaction with `request.user_id` bound
 * to `userId` — exactly what `withUserContext` does in app code, but
 * pointed at the harness's `appDb`. Use for every "as this user" assertion.
 * `set_config(..., true)` keeps the GUC transaction-local (no pool bleed).
 */
export async function asUser<T>(
  userId: string,
  fn: (tx: AppTx) => Promise<T>,
): Promise<T> {
  return appDb.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('request.user_id', ${userId}, true)`,
    );
    return fn(tx);
  });
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

export type SeededHousehold = {
  ownerId: string;
  householdId: string;
  babyId: string;
};

export type TwoHouseholds = {
  hA: SeededHousehold;
  hB: SeededHousehold;
  /** A second member of household A (non-owner caregiver). */
  caregiverInHA: string;
};

/**
 * Seeds two fully independent households via the owner connection
 * (bypasses RLS so the cross-household rows actually land):
 *
 *  - hA: owner + one caregiver + a baby
 *  - hB: owner + a baby
 *
 * The RLS isolation test then asserts a user in hA can read ONLY hA's
 * rows through `appDb`, never hB's.
 *
 * `withBaselineEvents` (default `true`) also plants one feed/diaper/weight
 * row per baby — the RLS test needs concrete rows on both sides to prove
 * cross-household reads return zero. The idempotency test passes `false`:
 * a stray baseline `pwa`/`formula` feed at "now" would be a legitimate
 * cross-source merge target and would muddy the merge-window assertions.
 */
export async function seedTwoHouseholds(
  withBaselineEvents = true,
): Promise<TwoHouseholds> {
  return adminDb.transaction(async (tx) => {
    const [ownerA] = await tx
      .insert(schema.users)
      .values({ displayName: "Owner A" })
      .returning({ id: schema.users.id });
    const [caregiverA] = await tx
      .insert(schema.users)
      .values({ displayName: "Caregiver A" })
      .returning({ id: schema.users.id });
    const [ownerB] = await tx
      .insert(schema.users)
      .values({ displayName: "Owner B" })
      .returning({ id: schema.users.id });

    const [householdA] = await tx
      .insert(schema.households)
      .values({ name: "Household A" })
      .returning({ id: schema.households.id });
    const [householdB] = await tx
      .insert(schema.households)
      .values({ name: "Household B" })
      .returning({ id: schema.households.id });

    await tx.insert(schema.householdMembers).values([
      {
        householdId: householdA.id,
        userId: ownerA.id,
        role: "owner",
        displayName: "Owner A",
      },
      {
        householdId: householdA.id,
        userId: caregiverA.id,
        role: "caregiver",
        displayName: "Caregiver A",
      },
      {
        householdId: householdB.id,
        userId: ownerB.id,
        role: "owner",
        displayName: "Owner B",
      },
    ]);

    const [babyA] = await tx
      .insert(schema.babies)
      .values({
        householdId: householdA.id,
        name: "Baby A",
        birthDate: new Date("2026-04-23T00:00:00Z"),
        birthWeightOz: "109.0",
        currentWeightOz: "120.0",
      })
      .returning({ id: schema.babies.id });
    const [babyB] = await tx
      .insert(schema.babies)
      .values({
        householdId: householdB.id,
        name: "Baby B",
        birthDate: new Date("2026-04-23T00:00:00Z"),
        birthWeightOz: "110.0",
        currentWeightOz: "121.0",
      })
      .returning({ id: schema.babies.id });

    if (withBaselineEvents) {
      const now = new Date();
      await tx.insert(schema.feedEvents).values([
        {
          babyId: babyA.id,
          loggedBy: ownerA.id,
          occurredAt: now,
          kind: "formula",
          volumeOz: "3.0",
          estimatedOz: "3.0",
          source: "pwa",
        },
        {
          babyId: babyB.id,
          loggedBy: ownerB.id,
          occurredAt: now,
          kind: "formula",
          volumeOz: "4.0",
          estimatedOz: "4.0",
          source: "pwa",
        },
      ]);
      await tx.insert(schema.diaperEvents).values([
        { babyId: babyA.id, loggedBy: ownerA.id, occurredAt: now, pee: true, poop: false, source: "pwa" },
        { babyId: babyB.id, loggedBy: ownerB.id, occurredAt: now, pee: true, poop: true, source: "pwa" },
      ]);
      await tx.insert(schema.weightEvents).values([
        { babyId: babyA.id, loggedBy: ownerA.id, occurredAt: now, weightOz: "120.0", source: "app" },
        { babyId: babyB.id, loggedBy: ownerB.id, occurredAt: now, weightOz: "121.0", source: "app" },
      ]);
    }

    return {
      hA: { ownerId: ownerA.id, householdId: householdA.id, babyId: babyA.id },
      hB: { ownerId: ownerB.id, householdId: householdB.id, babyId: babyB.id },
      caregiverInHA: caregiverA.id,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Global lifecycle                                                    */
/* ------------------------------------------------------------------ */

beforeAll(async () => {
  await runMigrations();
  await assertAppDbIsRlsEnforced();
  await truncateAll();
});

afterEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await appClient.end({ timeout: 5 });
  await adminClient.end({ timeout: 5 });
});
