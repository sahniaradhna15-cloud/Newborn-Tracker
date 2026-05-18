# Execution Report — Phase 2, Task 1

**Task:** Pre-flight gate — Vitest + real-Postgres integration harness + P0 RLS isolation
**Status:** SUCCESS — gate is GREEN against a real RLS-enforcing connection
**Date:** 2026-05-18
**Writes application code:** No (characterizes existing Phase 1 behavior only)

## What was implemented

### Created
- **`vitest.config.ts`** — first Vitest config. Two projects:
  - `unit`: `include: ['src/**/*.test.ts']`, `environment: node`, **no setup file, no DB, no env loading**. Preserves the pre-existing 57-test suite exactly.
  - `integration`: `include: ['test/integration/**/*.test.ts']`, `pool: 'forks'`, `maxWorkers: 1` + `fileParallelism: false` (serial — shared DB), `testTimeout/hookTimeout: 30000`, `setupFiles: ['test/integration/_harness.ts']`.
- **`test/integration/_harness.ts`** — `appDb` (postgres-js as the non-owner `app_runtime` role, RLS ENFORCED), `adminDb` (postgres/owner role, fixture setup/teardown, bypasses RLS). Helpers: `runMigrations()` (idempotent — applies `0000_loud_leech.sql` only if `feed_events` is absent), `truncateAll()` (TRUNCATE all 15 app tables RESTART IDENTITY CASCADE via `adminDb`), `seedTwoHouseholds(withBaselineEvents = true)` → `{ hA, hB, caregiverInHA }`, `asUser(userId, fn)` (binds `request.user_id` GUC on `appDb`, mirrors `withUserContext`). `beforeAll` runs migrations + the false-pass guard + initial truncate; `afterEach(truncateAll)`; `afterAll` closes both pools.
  - **False-pass guard `assertAppDbIsRlsEnforced()`**: throws loudly (citing CLAUDE.md §8) if the `appDb` connection's role is `postgres` (table owner) OR has `rolbypassrls = true` OR `is_superuser != off`. Empirically verified it trips on the owner connection.
- **`test/integration/rls-isolation.test.ts`** — P0 Risk R1. 8 tests: cross-household SELECT isolation for `feed_events`/`diaper_events`/`weight_events`/`babies` (both directions + explicit by-id cross-read); no-GUC ⇒ zero rows on every household table; `mom_events_self` co-member privacy + WITH CHECK forge rejection; write-isolation corollary; cross-household INSERT rejected by WITH CHECK.
- **`test/integration/events-idempotency.test.ts`** — Testing Strategy Test 2. 4 tests driving `recordEvent` directly: same `(source,client_uuid)` ⇒ `duplicate` + identical `event_id` + single ledger row; distinct uuids same-source 3 min apart ⇒ two rows (no same-source merge); cross-source within 5 min ⇒ `merged` + `corroborating_sources` appended; `locked_at` row never a merge target ⇒ fresh `accepted` row.

### Modified
- **`package.json`** — `test` = `vitest run --project unit` (fast, DB-free, CI default); added `test:integration` = `vitest run --project integration`; added `test:all` = `vitest run`; `test:watch` scoped to the unit project.
- **`.env.example`** — documented optional `DATABASE_URL_TEST` + `DATABASE_URL_ADMIN_TEST` (no values), including the destructive-truncate warning and the dev-connection fallback.

## Test-DB connection decision

`DATABASE_URL_TEST` is **not set** in this environment. Per the Task 1 fallback rule (strategy 2), the harness reuses the project's existing dev connections from `.env.local`:

- `appDb`   ← `DATABASE_URL`        — the non-owner `app_runtime` pooled conn, **RLS enforced**
- `adminDb` ← `DATABASE_URL_ADMIN`  — the `postgres` owner conn, fixture setup/teardown (bypasses RLS)

`DATABASE_URL_TEST` / `DATABASE_URL_ADMIN_TEST` are honored first if present, so a dedicated throwaway DB can be slotted in later with zero code change. Per-test isolation is provided by `truncateAll()` in `afterEach`. The choice and its destructive nature are documented in a comment block in `_harness.ts` and in `.env.example`.

Pre-flight DB probe confirmed the gate is meaningful, NOT vacuous:
- `DATABASE_URL` → `current_user=app_runtime`, `is_superuser=off`, `rolbypassrls=false`; `SELECT count(*) FROM feed_events` with no GUC returned **0** (RLS genuinely denies).
- `DATABASE_URL_ADMIN` → `current_user=postgres`, `rolbypassrls=true` — the false-pass guard correctly trips on it (verified by a deliberate misconfig probe).

Notable: Supabase's `postgres` role reports `is_superuser=off` but still owns the tables and has `rolbypassrls=true`. A guard checking only `is_superuser` would have false-passed; the implemented guard checks all three conditions and catches it.

## Divergences from plan

- The plan text said "skip the whole project with a clear message if `DATABASE_URL_TEST` is unset (never hang CI)." The task instructions explicitly override this: do NOT ship a vacuously-green skipped suite — fall back to dev connections (strategy 2) when no dedicated test DB exists. Followed the instruction override; the suite runs for real against the dev DB.
- Vitest 4 removed `poolOptions.forks.singleFork`. Used the flattened equivalent (`pool: 'forks'`, `maxWorkers: 1`, `fileParallelism: false`) — same serial guarantee, no deprecation warning, typecheck-clean. (`minWorkers` is not a valid project-level key in Vitest 4 — caught by `tsc` and removed.)
- `seedTwoHouseholds` gained a `withBaselineEvents` parameter (default `true`). The RLS test needs concrete feed/diaper/weight rows on both households to prove zero-leak. The idempotency test passes `false`: a baseline `pwa`/`formula` feed at "now" is a legitimate cross-source merge target and would contaminate the merge-window assertions (this surfaced as a real test failure first run, then fixed).

## Challenges

- **Initial idempotency failure (fixed):** the locked-row merge test returned `merged` instead of `accepted` because the Siri event merged with the *seeded baseline pwa feed*, not the locked row. Root cause was fixture contamination, not an app bug. Resolved by seeding the idempotency suite without baseline event rows (`withBaselineEvents = false`) and adjusting row-count expectations. This validates the merge logic is actually correct — the locked `recordEvent` row IS excluded from the merge window; the only mergeable candidate had to be removed from the fixture.
- No Phase 1 RLS regression found. The R1 isolation suite passed on first run — Phase 1 RLS is correctly enforced under the `app_runtime` role.

## Validation results

- `pnpm typecheck` — **clean** (caught and fixed an invalid `minWorkers` project key).
- `pnpm lint` — **clean**.
- `pnpm test` (unit) — **57 passed (4 files)** — unchanged from the pre-task baseline, DB-free.
- `pnpm test:integration`:

```
 RUN  v4.1.6
 Test Files  2 passed (2)
      Tests  12 passed (12)
   Duration  ~30s
```

  - `rls-isolation.test.ts` — 8 passed (P0 R1)
  - `events-idempotency.test.ts` — 4 passed

- False-pass guard verified: deliberately pointing `appDb` at the `postgres` owner conn trips `assertAppDbIsRlsEnforced()` (`connected as postgres (table OWNER); rolbypassrls=true`).

## Gate status

**GREEN.** `pnpm test:integration` passes against the real test DB as `app_runtime`; unit suite unchanged at 57. Task 2 is unblocked. The two new Phase 2 integration specs (`peer-recovery.test.ts`, `recovery-code.test.ts`) will run on this harness.

## Issues / Concerns

- The integration suite is **destructive** to whatever DB it targets — currently the shared dev database (it TRUNCATEs all app tables between tests). The dev DB is re-creatable via `pnpm db:seed`. For CI or to protect dev data, set `DATABASE_URL_TEST` + `DATABASE_URL_ADMIN_TEST` to a dedicated throwaway database (documented in `.env.example`). Not a blocker for the gate, but worth flagging before running this routinely on a DB with real data.
- Pre-existing unrelated working-tree modifications (UI components, `globals.css`, `plans/*-progress.md`, `.claude/agents/`) were present before this task and are intentionally NOT staged — only Task 1's six files are committed.
