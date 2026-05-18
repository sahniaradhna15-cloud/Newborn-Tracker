# Plan: Phase 2 — Multi-Caregiver + Siri Voice + Realtime + Pediatrician PDF

> **Phase:** 2 of 3 from PLAN.md (Week 2)
> **Tasks:** 4 (max 4) — Task 1 is a pre-flight gate; Tasks 2–4 are feature work
> **Overall Progress: 0%**
> **Status:** Not Started
> **Task Token Budget:** Each task ≤ 150K tokens
> **Refreshed:** 2026-05-18 — reconciled against the codebase as actually built through commit `b6815fb`. Supersedes the 2026-05-14 draft.

## TLDR

Open the app to a second caregiver, make Siri voice logging excellent (speak-back of today's total + target — the differentiator), wire Supabase Realtime so both phones reflect each other's logs within 2 seconds, and ship the free single-page pediatrician PDF. Every write still flows through Phase 1's canonical `recordEvent` — no signature changes, only an internal `writeAudit` call. **Task 1 is a hard pre-flight gate**: the Vitest + real-Postgres integration harness and the P0 RLS cross-household isolation test must be green *before any Phase 2 feature code is written* (CLAUDE.md §12/§13, Risk R1).

## Reconciliation Notes (read before executing — the codebase moved since the 2026-05-14 draft)

These are **load-bearing**. The stale draft assumed greenfield; much of its "CREATE" scope is already done. Do **not** re-create:

- **`src/lib/session.ts` already exports** `generateRecoveryCode()`, `normalizeRecoveryCode()`, `hashRecoveryCode()`, `mintSession()`, `verifySessionToken()`, `revokeSession()`, **`revokeAllUserSessions(userId)`**, `setSessionCookie()`, `readSessionCookie()`, `clearSessionCookie()`. → The draft's "create `src/lib/recovery-code.ts` by extraction" is **cancelled**. Recovery-code + session-revocation primitives are reused from `session.ts` as-is. (If a dedicated `recovery-code.ts` module is desired later for tidiness, that is a non-Phase-2 refactor — do not do it here.)
- **RLS already enforces invite-INSERT authority.** `0000_loud_leech.sql` contains `invites_owner_new_caregiver_insert` (only an owner may INSERT a `target_user_id IS NULL` invite) and `invites_peer_recovery_insert` (any member may INSERT a `target_user_id IS NOT NULL` peer-recovery invite for a co-member). The remaining §11.5 invariant that is **app-layer and must be integration-tested** is the *session-revocation asymmetry* on accept (owner-or-self → revoke priors; caregiver-issued → additive).
- **`invites_active_target_idx`** (UNIQUE on `target_user_id` WHERE `target_user_id IS NOT NULL AND accepted_at IS NULL`) already exists → "no outstanding unaccepted peer-recovery link" is DB-enforced; handle the unique-violation cleanly, do not re-check in app code as the source of truth.
- **The 6 Siri Shortcut recipe docs already exist** (`shortcuts/*.shortcut.md` + `shortcuts/README.md`, commit `1b7f51a`). Do **not** re-create them. Task 3 only *verifies/reconciles* them against the final `/api/events` contract and may patch contract drift.
- **`src/lib/with-auth.ts` bearer path is an explicit stub** (`if (authz?.startsWith("bearer ")) return null;`). Session path, `getSessionAuthContext()`, `withAuth(req)`, and the `AuthContext`/`SourceChannel` types all exist there. Task 3 fills the bearer branch in place — do not move the types.
- **`src/lib/record-event.ts` has zero `writeAudit` calls.** It returns from inside a single `withUserContext(ctx.user_id, tx => …)` transaction with multiple exit points: `duplicate`, `merged`, and three `accepted` paths (feed / diaper / mom). Audit is written **only on the three `accepted` creates**, inside that transaction, before the return. `duplicate`/`merged` are not creates and are not audited.
- **`src/lib/day-summary.ts` exists** and is the single-source day rollup: `getDaySummary(userId, householdId, now) → { summary: DaySummaryPayload, baby }`. It is **single-day only**. History and the PDF must call a new sibling `getRangeSummary` added to the *same file* (loop or windowed query that reuses `getDayWindow` + `dailyTargetRange`). Do **not** re-derive feed/diaper totals anywhere else. `IntakeDonut` consumes the existing `summary.feeds` shape (`nursing_oz`/`pumped_oz`/`formula_oz`/`wasted_oz`).
- **Stack reality:** Next 16 + Tailwind 4 + React 19 (not the draft's 15/3). `cookies()` is async. There is **no `vitest.config.*`** — unit tests run on Vitest defaults. Task 1 introduces the first config file, scoped so unit tests stay DB-free and fast.
- **Migrations:** single file `src/lib/db/migrations/0000_loud_leech.sql` (the drizzle-kit tag won, as CLAUDE.md §4 predicted — "0001_initial.sql" in old docs == this artifact). New migrations continue from `0002_*`.
- **Doc spec bug (out of Phase 2 scope, surface to user):** TECHNICAL_SPEC §13 / CLAUDE.md §12 cite spring-forward `2027-03-08`; real America/Chicago DST is `2027-03-14`. `day-window.test.ts` already uses the correct date. This is a docs correction, not a code task.

## Scope & Budget Note (resolve at the checkpoint, before execution)

The skill ceiling is **4 tasks, ≤150K tokens each**. Reconciliation removed meaningful scope (recovery-code module, session-revocation primitive, 6 Siri docs, invite-insert authority logic), but **Task 2 (caregiver identity) and Task 4 (Realtime + History + PDF) remain at the upper budget bound**. Each has a designed clean internal split point (marked `⟂ SPLIT` in its subtasks). Options for the user at the checkpoint:

1. **Run as 4 tasks** — execute Task 2 and Task 4 as *two sub-agent passes each* at the `⟂ SPLIT` line (one Phase 2, four planned tasks, six execution passes). Recommended.
2. **Split into Phase 2A / 2B** — 2A = Tasks 1–3 (security + voice), 2B = Task 4 (Realtime + History + PDF). Cleaner budget headroom; one extra phase doc.

**DECIDED (2026-05-18, user):** Run as **4 single-pass tasks, no split** — one sub-agent per task, self-managing its context. The `⟂ SPLIT` markers are retained **only as a recovery fallback**: if a Task 2 or Task 4 sub-agent exhausts its budget mid-task, resume with a second pass starting at the marked split line rather than restarting the task. Do not pre-emptively split. The user has explicitly accepted the budget risk on Tasks 2 and 4.

## Critical Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Caregiver-issued recovery links are **additive** | Only owner-issued (or self-issued) links revoke prior sessions of the target | Prevents hostile lockout while still solving "Mom lost her phone, Dad gets her back in" (TECHNICAL_SPEC §4.5.1, Risk R10) |
| 2 | Six fixed-shape Siri Shortcuts, not one "smart" parser | Each Shortcut sends a single discriminated payload; one `Ask for Input` prompt per variable | Siri NLP is unreliable in 2026; fixed-shape is rock-solid and free (PLAN.md §"One Shortcut per phrase") |
| 3 | Realtime over polling | Supabase Realtime → `router.refresh()` in a single `(app)/layout.tsx` client provider | 50 lines vs. a 5s poll on every device; free tier easily covers a family (TECHNICAL_SPEC §6.2) |
| 4 | PDF export is free, single-page, last-7-days | `@react-pdf/renderer` server-side; served as a download from `/api/export/pediatrician` | Huckleberry paywalls sleep equivalents at $9.99/mo; PLAN.md killer feature #4 |
| 5 | Audit every write | Every `recordEvent` create and every PATCH/DELETE on feed/diaper writes to `event_audit` with before+after payloads | Decision locked in (PLAN.md DECISIONS LOCKED IN — "Edit audit trail") |
| 6 | **RLS isolation test is a pre-flight gate, not a backfill** | Stand up the integration harness + R1 RLS test as Task 1; it must be green before any feature code | CLAUDE.md §12/§13: "Required green before any Phase 2 work." Catches an RLS regression before it ships in the auth-heavy Task 2 |
| 7 | Postgres-backed rate limiting | `0002_rate_limits.sql` token-bucket table, not in-memory | Correct under serverless cold starts; no Redis in the stack (CLAUDE.md §2) |

## Relevant Files

| File | Action | Purpose |
|------|--------|---------|
| `vitest.config.ts` | CREATE | First Vitest config — two projects: fast DB-free `unit`, and `integration` (real Postgres, serial, setup file) |
| `test/integration/_harness.ts` | CREATE | Test-DB bootstrap: `appDb` (RLS-enforcing `app_runtime` conn), `adminDb` (postgres conn, fixture setup/teardown), `seedTwoHouseholds()`, `truncateAll()` |
| `test/integration/rls-isolation.test.ts` | CREATE | **P0 R1** — cross-household SELECT isolation + `mom_events_self` |
| `test/integration/events-idempotency.test.ts` | CREATE | `/api/events` insert / duplicate / merge / locked-row (Phase-1 carry-over, cheap now harness exists) |
| `test/integration/peer-recovery.test.ts` | CREATE | **P0 R10** — §11.5 asymmetric-authority on accept (Task 2 DoD) |
| `test/integration/recovery-code.test.ts` | CREATE | Recovery-code redeem: normalize, rotate, revoke-priors, rate-limit, used-code (Task 2 DoD) |
| `src/lib/audit.ts` | CREATE | `writeAudit(tx, {...})` — INSERT `event_audit` inside caller's tx |
| `src/lib/rate-limit.ts` | CREATE | Postgres token-bucket: `consume(tx, key, limit, windowSec) → boolean` |
| `src/lib/api-token.ts` | CREATE | `mintApiToken` / `verifyApiToken` (updates `last_used_at`) / `revokeApiToken` |
| `src/lib/db/migrations/0002_rate_limits.sql` | CREATE | `rate_limits(key, window_start, count)` + RLS (service-only / no anon) |
| `src/app/i/[token]/page.tsx` | CREATE | Invite-accept landing (new caregiver + peer-recovery), no-session |
| `src/app/recover/page.tsx` | CREATE | Recovery-code redemption form |
| `src/app/recover/success/page.tsx` | CREATE | Post-redeem "save your new code" card |
| `src/app/(app)/settings/page.tsx` | CREATE | Settings index |
| `src/app/(app)/settings/caregivers/page.tsx` | CREATE | Invite + revoke + transfer + send-access-link |
| `src/app/(app)/settings/recovery/page.tsx` | CREATE | Recovery-code status + rotate |
| `src/app/(app)/settings/voice/page.tsx` | CREATE | API tokens + Siri install deep links |
| `src/app/(app)/history/page.tsx` | CREATE | Last 7 days + editable EventList |
| `src/app/(app)/export/pediatrician/page.tsx` | CREATE | PDF preview + download |
| `src/app/api/invites/route.ts` | CREATE | Owner mints new-caregiver invite |
| `src/app/api/invites/[token]/accept/route.ts` | CREATE | Accept invite / peer-recovery, mint session (asymmetric authority) |
| `src/app/api/access-links/route.ts` | CREATE | Peer-recovery link mint (any member) |
| `src/app/api/recovery-code/rotate/route.ts` | CREATE | Rotate recovery code (session) |
| `src/app/api/recovery/redeem/route.ts` | CREATE | Redeem recovery code (no auth, rate-limited) |
| `src/app/api/caregivers/route.ts` | CREATE | List household members |
| `src/app/api/caregivers/[user_id]/revoke/route.ts` | CREATE | Owner revokes all sessions for a user |
| `src/app/api/caregivers/transfer-ownership/route.ts` | CREATE | Swap owner/caregiver roles |
| `src/app/api/tokens/route.ts` | CREATE | Mint API token (POST) |
| `src/app/api/tokens/[id]/route.ts` | CREATE | Revoke API token (DELETE) |
| `src/app/api/voice/route.ts` | CREATE | Legacy adapter → `recordEvent` (bearer) |
| `src/app/api/realtime-token/route.ts` | CREATE | Short-lived Supabase JWT scoped to household (no-cache) |
| `src/app/api/export/pediatrician/route.ts` | CREATE | PDF stream (session) |
| `src/components/EventList.tsx` | CREATE | Editable list grouped by day, with attribution |
| `src/components/IntakeDonut.tsx` | CREATE | Recharts donut (client) on TodayCard |
| `src/components/RealtimeProvider.tsx` | CREATE | Subscribes to feed/diaper changes → `router.refresh()` |
| `src/components/PediatricianPDF.tsx` | CREATE | `@react-pdf/renderer` document |
| `src/lib/day-summary.ts` | MODIFY | Add `getRangeSummary(userId, householdId, from, to)` reusing the day rollup |
| `src/lib/with-auth.ts` | MODIFY | Fill the bearer branch (`verifyApiToken`, `source: 'siri_shortcut'`) |
| `src/lib/record-event.ts` | MODIFY | `writeAudit` on the three `accepted` creates, inside the existing tx |
| `src/app/api/feeds/[id]/route.ts` | MODIFY | PATCH/DELETE write `event_audit` (before/after) |
| `src/app/api/diapers/[id]/route.ts` | MODIFY | PATCH/DELETE write `event_audit` (before/after) |
| `src/middleware.ts` | MODIFY | Exempt `/api/recovery/redeem` + `/api/invites/[token]/accept` from the `X-Requested-With` check (no-session devices); bearer routes already exempt |
| `src/app/(app)/layout.tsx` | MODIFY | Mount `RealtimeProvider` (create the `(app)` layout if absent) |
| `src/components/TodayCard.tsx` | MODIFY | Render `IntakeDonut` |
| `src/app/api/summary/route.ts` | MODIFY | Accept `?days=7` → delegate to `getRangeSummary` |
| `shortcuts/*.shortcut.md` | VERIFY | Reconcile existing 6 recipes to the final `/api/events` contract — patch only on drift, do not recreate |
| `README.md` | MODIFY | "Multi-caregiver setup", Siri install, Supabase Realtime enable step |

## Dependencies

**New packages:**
- `recharts` — dashboard donut
- `@react-pdf/renderer` — server-side pediatrician PDF

**Existing utilities to reuse (do not duplicate):**
- `src/lib/record-event.ts` — single write path; Siri/voice route through it unchanged
- `src/lib/voice-parser.ts` — `InboundEvent` Zod schema; `/api/voice` maps onto it
- `src/lib/with-user-context.ts` — `withUserContext(userId, tx => …)` RLS-bound tx
- `src/lib/session.ts` — `mintSession`, `verifySessionToken`, `revokeSession`, `revokeAllUserSessions`, `generate/normalize/hashRecoveryCode`, cookie helpers (all already present)
- `src/lib/with-auth.ts` — `AuthContext`, `getSessionAuthContext`, `withAuth`
- `src/lib/day-summary.ts` — `getDaySummary`; extend with `getRangeSummary` (same file)
- `src/lib/day-window.ts` / `src/lib/targets.ts` — windowing + target band for PDF/history
- `src/lib/db/admin.ts` — `adminDb` (service-role / postgres conn) for the integration harness fixture setup **only**
- `src/lib/outbox.ts` — `enqueue(tx, topic, payload)` (already called by `recordEvent`)

**Configuration changes:**
- `NEXT_PUBLIC_APP_URL` must be correct — invite URLs and Siri base interpolate it
- Supabase dashboard one-time: `ALTER PUBLICATION supabase_realtime ADD TABLE feed_events, diaper_events;` (document in README; the user performs it)
- A test database connection for the integration project — reuse the Supabase dev DB or local Docker Postgres; harness reads a `DATABASE_URL_TEST` (document in `.env.example`, never commit values)
- `SUPABASE_SERVICE_ROLE_KEY` stays referenced in **exactly two files** (CLAUDE.md §8). The realtime-token route signs a JWT with it — confirm whether this is a *third* referencing file; if so, this requires explicit user discussion at the checkpoint (flagged in Task 4 DoD).

## Tasks

### Task 1: Pre-flight gate — integration harness + P0 RLS isolation (BLOCKS Task 2)

**Estimated scope:** ~5 files, 0 endpoints, 3 test specs
**Files touched:**
- `vitest.config.ts` (CREATE)
- `test/integration/_harness.ts` (CREATE)
- `test/integration/rls-isolation.test.ts` (CREATE)
- `test/integration/events-idempotency.test.ts` (CREATE)
- `package.json` (MODIFY — add `test:integration` script; keep `test` = unit only, fast, DB-free)
- `.env.example` (MODIFY — document `DATABASE_URL_TEST`)

**Subtasks:**
- [ ] `vitest.config.ts`: two projects. `unit` — `include: ['src/**/*.test.ts']`, no setup, no DB (preserves the current fast 57-test suite exactly). `integration` — `include: ['test/integration/**/*.test.ts']`, `pool: 'forks'`, `singleFork: true` / `fileParallelism: false` (serial — shared DB), `testTimeout: 30000`, loads `_harness.ts`.
- [ ] `package.json`: `test` stays `vitest run --project unit` (CI default, no DB). Add `test:integration` = `vitest run --project integration`. Add a combined `test:all`.
- [ ] `test/integration/_harness.ts`: export `appDb` (postgres-js bound to `DATABASE_URL_TEST` as the **`app_runtime`** non-owner role — RLS enforced) and `adminDb` (same DB, postgres/owner role — fixture setup bypasses RLS). Helpers: `runMigrations()` (idempotent, applies `0000_*` + later), `truncateAll()` (TRUNCATE every app table, RESTART IDENTITY, CASCADE — via `adminDb`), `seedTwoHouseholds()` → returns `{ hA: { ownerId, householdId, babyId }, hB: { ownerId, householdId, babyId }, caregiverInHA }`. Provide `asUser(userId, fn)` wrapping `withUserContext` against `appDb`. `afterEach(truncateAll)`; skip the whole project with a clear message if `DATABASE_URL_TEST` is unset (never hang CI).
- [ ] `test/integration/rls-isolation.test.ts` (**P0, Risk R1**): seed two households.
  - User A `SELECT … FROM feed_events` returns only A's rows; **zero** of B's. Same for `diaper_events`, `weight_events`, `babies`.
  - No `request.user_id` GUC set at all (raw `appDb`, no `withUserContext`) → `SELECT count(*) FROM feed_events` = 0 (policy denies).
  - `mom_events_self`: caregiver in household A cannot see the owner-of-A's `mom_events` even though same household (self-only policy). Owner sees only their own.
  - Insert as A, attempt read as B → 0 rows (write isolation corollary).
- [ ] `test/integration/events-idempotency.test.ts`: drive `recordEvent` directly (it is the canonical path). Same `(source, client_uuid)` twice → one row, second result `status:'duplicate'`, identical `event_id`. Two distinct uuids same kind 3 min apart, **same source** → two rows (no cross-source merge → not collapsed). Cross-source within 5 min → `merged`, `corroborating_sources` appended. A row with `locked_at` set is never a merge target.

**Details:**
- The harness's `app_runtime` connection is the whole point — connecting as `postgres` silently disables RLS and the R1 test would false-pass (CLAUDE.md §8, memory `project_rls_app_runtime_role`). Assert in `_harness.ts` setup that `current_user` is **not** `postgres` and `SELECT current_setting('is_superuser')` is `off`; fail loudly otherwise.
- This task writes **no application code** — it characterizes existing Phase 1 behavior. If the R1 test fails, that is a Phase 1 RLS regression and **must be fixed before Task 2** (escalate to user; do not paper over).

**Depends on:** None.

**Definition of Done:**
- `pnpm test` (unit) still green, unchanged 57 tests, no DB required
- `pnpm test:integration` green: RLS isolation + idempotency specs pass against the real test DB as `app_runtime`
- Harness refuses to run as a superuser/owner connection (verified by a deliberate misconfig check or an asserted guard)
- `pnpm typecheck` + `pnpm lint` clean
- **GATE: Task 2 must not start until `test:integration` is green.**

---

### Task 2: Caregiver identity — invites, peer-recovery, recovery codes, settings, audit wiring

**Estimated scope:** ~22 files (heaviest task — see `⟂ SPLIT`), 9 endpoints, 5 pages
**Files touched:**
- `src/lib/audit.ts` (CREATE)
- `src/lib/rate-limit.ts` (CREATE)
- `src/lib/db/migrations/0002_rate_limits.sql` (CREATE)
- `src/lib/record-event.ts` (MODIFY — audit on 3 accepted creates)
- `src/app/api/feeds/[id]/route.ts` (MODIFY — audit PATCH/DELETE)
- `src/app/api/diapers/[id]/route.ts` (MODIFY — audit PATCH/DELETE)
- `src/middleware.ts` (MODIFY — CSRF exemptions for no-session routes)
- `src/app/api/invites/route.ts` (CREATE)
- `src/app/api/invites/[token]/accept/route.ts` (CREATE)
- `src/app/api/access-links/route.ts` (CREATE)
- `src/app/api/caregivers/route.ts` (CREATE)
- `src/app/api/caregivers/[user_id]/revoke/route.ts` (CREATE)
- `src/app/api/caregivers/transfer-ownership/route.ts` (CREATE)
- `src/app/i/[token]/page.tsx` (CREATE)
- `src/app/(app)/settings/page.tsx` (CREATE)
- `src/app/(app)/settings/caregivers/page.tsx` (CREATE)
- `⟂ SPLIT` (above = pass 2a: invites + caregivers + audit; below = pass 2b: recovery codes)
- `src/app/api/recovery-code/rotate/route.ts` (CREATE)
- `src/app/api/recovery/redeem/route.ts` (CREATE)
- `src/app/(app)/settings/recovery/page.tsx` (CREATE)
- `src/app/recover/page.tsx` (CREATE)
- `src/app/recover/success/page.tsx` (CREATE)
- `test/integration/peer-recovery.test.ts` (CREATE)
- `test/integration/recovery-code.test.ts` (CREATE)

**Subtasks:**
- [ ] `src/lib/audit.ts`: `writeAudit(tx, { actor_user_id, household_id, kind, entity_table, entity_id, before, after, ip? })` → INSERT `event_audit` inside the caller's tx. Kinds (CLAUDE.md §7): `feed.created|updated|deleted`, `diaper.created|updated|deleted`, `access_link.issued|redeemed`, `recovery_code.redeemed|rotated`, `caregiver.revoked`, `ownership.transferred`. No PII (CLAUDE.md §13) — `before`/`after` are row JSON minus nothing here (rows have no names), but never log raw tokens/codes.
- [ ] Wire `writeAudit` into `recordEvent`: inside the existing `withUserContext` tx, immediately before each of the **three `accepted`** returns (feed/diaper/mom), `await writeAudit(tx, { actor_user_id: ctx.user_id, household_id: ctx.household_id, kind: '<feed|diaper|mom>.created', entity_table, entity_id: row.id, before: null, after: <inserted row> })`. Do **not** audit `duplicate`/`merged`. Re-fetch the inserted row (or use `.returning()` full row) for `after`.
- [ ] Wire `writeAudit` into `/api/feeds/[id]` + `/api/diapers/[id]` PATCH (`before`=prev row, `after`=next; recall PATCH already sets `locked_at`) and DELETE (`before`=prev, `after`=null). Same tx as the mutation.
- [ ] `src/lib/rate-limit.ts`: `consume(tx, key, limit, windowSec) → boolean` token-bucket against `rate_limits`. `0002_rate_limits.sql`: `rate_limits(key text primary key, window_start timestamptz not null, count int not null)`; RLS enabled, no anon/authenticated grants (service path only — it runs in routes that may be pre-session; document the access model in the migration header like §4's RLS block).
- [ ] `POST /api/invites` (session, **owner only** — also DB-enforced by `invites_owner_new_caregiver_insert`): body `{ display_name, role? }`. Raw token = 32 random bytes base64url; store `sha256`; `expires_at = now()+7d`. Return `{ url: ${APP_URL}/i/${raw}, expires_at }`. 403 if not owner (defense in depth even though RLS also blocks).
- [ ] `POST /api/access-links` (session, any member): body `{ for_user_id }`. INSERT `invites` with `target_user_id=for_user_id`, `created_by=caller`, `expires_at=now()+24h`. Rely on `invites_active_target_idx` for "one outstanding" — catch the unique violation → friendly 409. `writeAudit('access_link.issued')`. Return `{ url, expires_at }`.
- [ ] `GET /i/[token]` (server component, no session): hash, look up by `token_hash`, require `expires_at>now() AND accepted_at IS NULL`. `target_user_id IS NULL` → "Welcome — your role is {display_name}. Tap to join" (editable display_name). `target_user_id IS NOT NULL` → "Welcome back, {display_name}. Tap to sign in here." Invalid/expired/used → one generic friendly error (do not leak which case).
- [ ] `POST /api/invites/[token]/accept` (no caller session; `adminDb` tx): re-validate token. If `target_user_id IS NULL`: INSERT `users`, INSERT `household_members(role=caregiver)`, `mintSession`, set cookie. If `target_user_id IS NOT NULL`: compute `shouldRevokePriorSessions = issuer.role === 'owner' || issuer.user_id === target.user_id` (CLAUDE.md §11.5 — the single load-bearing expression); if true `await revokeAllUserSessions(target_user_id)`; then `mintSession(target_user_id)` + cookie. UPDATE `invites.accepted_at/accepted_by`. `writeAudit('access_link.redeemed', { revoked_prior: boolean })`. Return `{ ok:true, redirect:'/' }`.
- [ ] `GET /api/caregivers`: `household_members ⋈ users` for caller's household + per-member "logged N" count.
- [ ] `POST /api/caregivers/[user_id]/revoke` (owner only): `revokeAllUserSessions(user_id)`; `writeAudit('caregiver.revoked')`. Reject self-revoke.
- [ ] `POST /api/caregivers/transfer-ownership` (owner only): one tx swaps `household_members.role` (caller→caregiver, target→owner). `writeAudit('ownership.transferred')`.
- [ ] `src/app/(app)/settings/page.tsx` + `settings/caregivers/page.tsx`: server-render member list; per row role badge, "logged N", and buttons — Revoke (owner, not self, confirm modal), Send access link (any member, any *other* member, → modal with copy/share URL), Transfer ownership (owner, not self, typed-confirm). Below: "Invite caregiver" form (owner only).
- [ ] `⟂ SPLIT` — recovery-code half:
- [ ] `POST /api/recovery-code/rotate` (session): tx — `UPDATE recovery_codes SET rotated_at=now() WHERE user_id=$1 AND rotated_at IS NULL AND used_at IS NULL`; INSERT new row (`hashRecoveryCode`); `writeAudit('recovery_code.rotated')`; return `{ code: <raw> }` (shown once).
- [ ] `POST /api/recovery/redeem` (no auth, rate-limited 5/IP/hour + 24h soft block via `rate-limit.ts`): body `{ code }`. `hashRecoveryCode` (normalizes). Look up; require `used_at IS NULL AND rotated_at IS NULL`. tx: set `used_at/used_from_ip`; `revokeAllUserSessions(code.user_id)`; `mintSession` + cookie; INSERT new code row (auto-rotate, §4.5.2); `writeAudit('recovery_code.redeemed')`; return `{ ok:true, new_recovery_code:<raw> }`. Bad code → friendly message with the example format.
- [ ] `src/app/(app)/settings/recovery/page.tsx`: shows whether an active code exists (no raw display) + "Rotate" → "save this" modal.
- [ ] `src/app/recover/page.tsx`: single code form → POST redeem → on success redirect `/recover/success`. `src/app/recover/success/page.tsx`: shows the new rotated code with the onboarding "save this" UI.
- [ ] `src/middleware.ts`: exempt `/api/recovery/redeem` and `/api/invites/[token]/accept` from the `X-Requested-With: fetch` requirement (called from no-session devices); keep the same-origin `Origin` check; bearer routes (`/api/events`,`/api/voice`) remain exempt as today.
- [ ] `test/integration/peer-recovery.test.ts` (**P0 R10**) + `test/integration/recovery-code.test.ts` — see Testing Strategy. Use the Task 1 harness.

**Details:**
- The asymmetric-authority expression is the single highest-risk line in the project — code review must confirm it is **exactly** `issuer.role === 'owner' || issuer.user_id === target.user_id` (CLAUDE.md §11.5). It is verified by `peer-recovery.test.ts` (Risk R10, "an integration test verifies this").
- Recovery code: display hyphenated `XXXX-XXXX-XXXX-XXXX`, accept any case/spacing (`normalizeRecoveryCode` already handles it).
- `/api/invites/[token]/accept` and `/api/recovery/redeem` use `adminDb` only for the no-session writes they must do — this does **not** add a third service-role file (admin.ts is the conduit). Confirm no new `SUPABASE_SERVICE_ROLE_KEY` import is introduced.

**Depends on:** Task 1 green (gate). The two new integration specs here run on Task 1's harness.

**Definition of Done:**
- Owner mints invite → opened in another browser → "Join" → new session + cookie → `/` with the same baby's data
- Owner revokes caregiver → caregiver's next request 401
- Caregiver-issued peer-recovery link to owner → owner gets a NEW session, **prior owner session still valid** (additive)
- Owner-issued link to caregiver → caregiver's prior sessions **revoked**
- Self-issued link → own priors revoked
- `/recover` redeem → new session, priors revoked, fresh rotated code shown; 6th attempt/IP/hour → 429; used code → rejected
- Every feed/diaper create + PATCH + DELETE writes an `event_audit` row with correct before/after
- `pnpm test:integration` green incl. `peer-recovery.test.ts` (R10) and `recovery-code.test.ts`; `pnpm typecheck` + `pnpm lint` clean
- No third file references `SUPABASE_SERVICE_ROLE_KEY`

---

### Task 3: Siri voice — bearer auth + API tokens

**Estimated scope:** ~6 files, 3 endpoints, 1 page, verify 6 existing docs
**Files touched:**
- `src/lib/api-token.ts` (CREATE)
- `src/lib/with-auth.ts` (MODIFY — fill bearer branch)
- `src/app/api/tokens/route.ts` (CREATE — POST mint)
- `src/app/api/tokens/[id]/route.ts` (CREATE — DELETE revoke)
- `src/app/api/voice/route.ts` (CREATE — legacy adapter)
- `src/app/(app)/settings/voice/page.tsx` (CREATE)
- `shortcuts/*.shortcut.md` + `shortcuts/README.md` (VERIFY — patch only on contract drift; do NOT recreate)

**Subtasks:**
- [ ] `src/lib/api-token.ts`: `mintApiToken(userId, householdId, label) → { id, token }` (32 bytes base64url, store `sha256`, raw once); `verifyApiToken(rawBearer) → { user_id, household_id } | null` (joins `api_tokens`, `revoked_at IS NULL`, opportunistically bumps `last_used_at`); `revokeApiToken(tokenId)`.
- [ ] `src/lib/with-auth.ts`: replace `if (authz?.startsWith("bearer ")) return null;` with: parse the token, `verifyApiToken`; on hit return `{ user_id, household_id, source: 'siri_shortcut', auth_method: 'bearer' }`; on miss return null. Session path stays the fallback. Do not move the exported types.
- [ ] `POST /api/tokens` (session): `{ label }` → mint, return `{ id, token, label }` (raw once). `DELETE /api/tokens/[id]` (session): `revokeApiToken`.
- [ ] `POST /api/voice` (bearer): accept the legacy shape `{ action:'feed'|'diaper', kind?, side?, duration_min?, volume_oz?, wasted_oz?, pee?, poop?, client_uuid?, occurred_at? }`, translate into an `InboundEvent`, generate `client_uuid` if absent, call `recordEvent`, return canonical `{ ok, event_id, say }`.
- [ ] `src/app/(app)/settings/voice/page.tsx`: list caller's tokens (label, last_used_at, status) with Generate (modal shows raw once) + Revoke. Below: six `shortcuts://import-shortcut/?url=…&name=…` deep links; the iCloud share URLs come from env/constants the user fills later (interpolate `NEXT_PUBLIC_APP_URL`).
- [ ] Reconcile `shortcuts/*.shortcut.md` against the **final** `/api/events` contract (headers `Authorization: Bearer`, `Content-Type`, `X-Requested-With: fetch`; body = `InboundEvent.event` discriminated shapes; "Show Notification" reads `say`). They were authored in `1b7f51a` — only patch lines that drifted; if accurate, leave untouched and note "verified, no change".

**Details:**
- Shortcuts cannot refresh OAuth → long-lived hashed bearer tokens, user-revocable (TECHNICAL_SPEC §4.4).
- No "smart" Siri parser — explicitly deferred (PLAN.md §"Explicitly Deferred").

**Depends on:** Task 1 (gate). Independent of Task 2 logic, but `settings/voice` shares the settings layout created in Task 2 — run after Task 2.

**Definition of Done:**
- `/settings/voice` mints/copies/revokes tokens
- `curl /api/events` with a fresh token → 200 + sensible `say`; wrong token → 401; after revoke → 401
- Same `client_uuid` twice → second response `status:duplicate`, identical `say` (idempotency carried by `recordEvent`)
- On a real iPhone: "Hey Siri, log a pee" → `diaper_events` row `source='siri_shortcut'`, Siri reads today's wet count; "log 2 oz formula" → `feed_events` `kind=formula`, reads daily total + target band
- `shortcuts/` docs match the shipped contract; `pnpm typecheck` + `pnpm lint` clean

---

### Task 4: Realtime + History + IntakeDonut + Pediatrician PDF

**Estimated scope:** ~12 files (upper-bound — see `⟂ SPLIT`), 3 endpoints, 4 components
**Files touched:**
- `src/lib/day-summary.ts` (MODIFY — add `getRangeSummary`)
- `src/app/api/summary/route.ts` (MODIFY — `?days=` → `getRangeSummary`)
- `src/app/api/realtime-token/route.ts` (CREATE)
- `src/components/RealtimeProvider.tsx` (CREATE)
- `src/app/(app)/layout.tsx` (MODIFY/CREATE — mount provider)
- `src/components/IntakeDonut.tsx` (CREATE)
- `src/components/TodayCard.tsx` (MODIFY — render donut)
- `src/components/EventList.tsx` (CREATE)
- `src/app/(app)/history/page.tsx` (CREATE)
- `⟂ SPLIT` (above = pass 4a: Realtime + history + donut; below = pass 4b: PDF)
- `src/components/PediatricianPDF.tsx` (CREATE)
- `src/app/api/export/pediatrician/route.ts` (CREATE)
- `src/app/(app)/export/pediatrician/page.tsx` (CREATE)
- `README.md` (MODIFY — Realtime enable step + multi-caregiver setup)

**Subtasks:**
- [ ] `src/lib/day-summary.ts`: add `getRangeSummary(userId, householdId, from: Date, to: Date) → DaySummaryPayload[]` — one entry per logical day, computed by reusing the existing windowing (`getDayWindow`) + `dailyTargetRange`; factor the per-day reducer so `getDaySummary` and `getRangeSummary` share it (no re-derivation, no drift). RLS-bound via `withUserContext`.
- [ ] `src/app/api/summary/route.ts`: `?days=N` (default 1). N=1 → existing single payload (unchanged shape). N>1 → `getRangeSummary` array.
- [ ] `src/app/api/realtime-token/route.ts` (session GET, `no-store`): mint a 5-min Supabase JWT with claims `{ role:'authenticated', sub:user_id, app_metadata:{ household_id } }` signed with the Supabase JWT secret. **CHECKPOINT FLAG:** if this requires importing `SUPABASE_SERVICE_ROLE_KEY` it would be a *third* file referencing it (CLAUDE.md §8 caps at 2) — prefer the project JWT secret; if unavoidable, stop and raise with the user before coding.
- [ ] `src/components/RealtimeProvider.tsx` (client): fetch token, `createClient(URL, ANON_KEY)`, subscribe to `household:${householdId}` with two `postgres_changes` listeners (`feed_events`, `diaper_events`, `filter: baby_id=eq.${babyId}`) → `router.refresh()`. Re-fetch token every 4 min; unsubscribe on unmount; wrap in Suspense so first paint is not blocked.
- [ ] `src/app/(app)/layout.tsx`: mount `<RealtimeProvider householdId babyId>` around children (IDs from server-resolved session). Create the `(app)` route-group layout if it does not yet exist (Phase 1 left `(app)/log/*` without a group layout).
- [ ] `src/components/IntakeDonut.tsx` (client wrapper, Recharts): donut of `summary.feeds` nursing/pumped/formula, `wasted_oz` as a small grey arc; center = total + target band. Consumes the existing `DaySummaryPayload.feeds` shape — no new query.
- [ ] `src/components/TodayCard.tsx`: replace the stacked-bar placeholder with `<IntakeDonut data={summary.feeds} target={summary.target} />`. Keep it a server component; donut is the only client island.
- [ ] `src/components/EventList.tsx` (client): events grouped by day; row = time, kind, key fields, "logged by Mom/Dad" (+ "edited by … Nh ago" from `event_audit`), inline edit (PATCH `/api/feeds|diapers/[id]`) + delete (confirm). Optimistic UI.
- [ ] `src/app/(app)/history/page.tsx`: server-fetch `/api/summary?days=7` (or call `getRangeSummary` directly), render 7-day rollup + `EventList`.
- [ ] `⟂ SPLIT` — PDF half:
- [ ] `src/components/PediatricianPDF.tsx`: `@react-pdf/renderer` single-page Letter doc — header (baby name/DOB/age), Feeding 7-day table (date, total oz, nursing min, pumped oz, formula oz, target band, within/below/above pill), Diapers 7-day table (wet/dirty), Notes flat list, footer "Informational, not medical advice." **No caregiver attribution. No `mom_events`.**
- [ ] `GET /api/export/pediatrician?from=&to=` (session): pull range via `getRangeSummary` + notes; `renderToStream`; `application/pdf` + `Content-Disposition: attachment; filename="anay-feeding-summary-<from>-to-<to>.pdf"`. Default last 7 days.
- [ ] `src/app/(app)/export/pediatrician/page.tsx`: HTML preview mirroring the PDF + date-range picker + "Download PDF" link.
- [ ] `README.md`: add Supabase Realtime enable SQL, "invite a partner / recover a lost phone / add Siri Shortcuts" sections.

**Details:**
- TodayCard re-renders on Realtime push because it is a **server component** — `router.refresh()` re-runs the server fetch; no client cache.
- Realtime is the only browser-side Supabase usage; all reads still go through `getDaySummary`/`getRangeSummary` server-side.
- PDF stays one page; pediatricians scan. `mom_events` excluded structurally (the query never touches that table) — not merely relying on `mom_events_self`.

**Depends on:** Task 1 (gate); Task 2 (audit rows power EventList attribution; settings layout). Task 3 not required.

**Definition of Done:**
- Two phones, both signed in: one logs a feed → the other's TodayCard updates < 2 s, no manual refresh
- Going offline does not break the dashboard — it just stops auto-refreshing
- `/history` shows last 7 days (per-day total) + editable/deletable `EventList` with attribution
- TodayCard donut shows correct nursing/pumped/formula split + wasted arc
- `/export/pediatrician` HTML preview + a 1-page PDF a pediatrician reads without scrolling; iMessage-share from Safari opens the iOS PDF viewer
- `mom_events` never appear in the export
- No third file references `SUPABASE_SERVICE_ROLE_KEY` (or the user explicitly approved an exception)
- `pnpm typecheck` + `pnpm lint` + `pnpm build` clean; `pnpm test:integration` still green

## Testing Strategy

### Test 1: RLS cross-household isolation (P0, Risk R1) — Task 1

**File:** `test/integration/rls-isolation.test.ts` (create) — **approach: integration (real Postgres, `app_runtime` role)**

- [ ] User A cannot SELECT B's `feed_events` / `diaper_events` / `weight_events` / `babies` (zero rows)
- [ ] No `request.user_id` GUC → every household table returns zero
- [ ] `mom_events_self`: a co-member cannot read another member's `mom_events`; author sees only their own
- [ ] Harness fails loudly if connected as `postgres`/superuser (RLS would false-pass)

### Test 2: `/api/events` idempotency + merge — Task 1

**File:** `test/integration/events-idempotency.test.ts` (create) — **integration**

- [ ] Same `(source, client_uuid)` twice → one row, 2nd `status:duplicate`, same `event_id`
- [ ] Two uuids, same source, 3 min apart → two rows (no same-source merge)
- [ ] Cross-source within 5 min → `merged`, `corroborating_sources` appended
- [ ] `locked_at` row is never a merge target

### Test 3: Peer-recovery asymmetric authority (P0, Risk R10) — Task 2

**File:** `test/integration/peer-recovery.test.ts` (create) — **integration**

- [ ] Caregiver issues link to owner → after accept owner has TWO active sessions (additive); not revoked
- [ ] Owner issues link to caregiver → after accept caregiver has ONE (priors revoked)
- [ ] Self-issued link → only the new session active
- [ ] Caregiver issues link with `target_user_id` outside their household → blocked (RLS `invites_peer_recovery_insert` + app 403)
- [ ] Caregiver attempts a `target_user_id IS NULL` (new-caregiver) invite → blocked (RLS `invites_owner_new_caregiver_insert` + app 403)

### Test 4: Recovery-code redeem — Task 2

**File:** `test/integration/recovery-code.test.ts` (create) — **integration**

- [ ] Onboarding/rotate yields exactly one active code per user
- [ ] Redeem normalizes `K3HM-7TPN-Q9XR-4FBC` / `k3hm7tpnq9xr4fbc` / spaced input identically
- [ ] Successful redeem rotates code, revokes priors, mints session
- [ ] 6th attempt from one IP within the hour → 429; soft-block holds
- [ ] Used or rotated code → rejected on next attempt

### Test 5: Manual smoke (PLAN.md §"Verification — After Week 2")

- [ ] Partner accepts invite on a 2nd iPhone with their own display name → same baby's events
- [ ] Owner revokes Dad → Dad 401 → fresh invite → Dad re-accepts → back in
- [ ] Mom "loses" phone; Dad sends access link → Mom signs in on a new device, full history; Mom's old session still works (additive)
- [ ] Dad "loses" phone; Mom (owner) sends link → Dad in, old session dead (revoking)
- [ ] `/recover` with the onboarding code → `/recover/success` with a new code
- [ ] Owner transfers ownership to Dad → Mom can no longer revoke/invite; Dad can
- [ ] Two iPhones online: Mom logs feed → Dad's dashboard < 2 s (Realtime)
- [ ] `/export/pediatrician` → 1-page PDF, last 7 days, no mom data

## Validation Commands

Run in order after all tasks complete:

```bash
pnpm lint
pnpm typecheck
pnpm test               # unit project — fast, no DB (must stay 57+ green)
pnpm test:integration   # real Postgres — RLS R1, idempotency, peer-recovery R10, recovery-code
pnpm build
pnpm db:migrate         # applies 0002_rate_limits.sql
```

Per-task gate: after **Task 1**, `pnpm test:integration` must be green before Task 2 begins.

Manual curl (canonical event endpoint, after Task 3):

```bash
TOKEN="..."  # raw token from /settings/voice
curl -X POST "$APP_URL/api/events" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "X-Requested-With: fetch" \
  -d '{"client_uuid":"'"$(uuidgen)"'","source":"siri_shortcut","occurred_at":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","event":{"type":"diaper","pee":true}}'
```

## Integration Notes

- **Builds on Phase 1:** `recordEvent`'s signature is unchanged — only an internal `writeAudit` call on the three create paths. `/api/events` already exists; Task 3 only fills the bearer branch and authors `/api/voice`. The 6 Siri docs already exist (`1b7f51a`) — verified, not recreated.
- **Sets up Phase 3:** Realtime is the substrate Phase 3's offline-queue replay rides on (queued events POST `/api/events`; Realtime propagates). The `(app)` layout created/extended in Task 4 is where the Phase 3 install-prompt and offline banner mount.
- **Breaking changes:** None. Phase 1 routes keep their shapes. PATCH/DELETE handlers gain an additive audit write. `pnpm test` semantics tighten slightly: `test` becomes the *unit* project (already DB-free in practice); integration is `test:integration`.
- **Migration:** `0002_rate_limits.sql` is the only schema change — all other tables exist in `0000_loud_leech.sql`. Never edit the merged `0000_*` file.
- **Build-gate vs. launch-gate:** PRD §9 sets a *launch* trigger ("Phase 1 stable for 30 days, no P0/P1"). That gates public launch, **not** Phase 2 implementation. Per the user's explicit direction, Phase 2 is being *built* now with the RLS pre-flight as the build gate; the 30-day launch criterion is tracked separately and is not a blocker for Tasks 1–4.
- **Docs correction (not a task):** TECHNICAL_SPEC §13 / CLAUDE.md §12 cite spring-forward `2027-03-08`; the real America/Chicago date is `2027-03-14` and `day-window.test.ts` already uses it. Recommend a one-line doc fix outside this phase.
- **`SUPABASE_SERVICE_ROLE_KEY` is capped at 2 files** (CLAUDE.md §8). `/api/realtime-token` must not become a third — prefer the JWT secret; Task 4 DoD enforces this and flags the user if unavoidable.
- **Things NOT done in Phase 2:** PWA manifest / service worker / Add-to-Home-Screen, offline queue, growth chart + WHO percentiles + weight settings, mom-tab UI, low-pee 8pm banner, health-bridge export, Alexa/Google adapters — all Phase 3 or deferred per PLAN.md.
