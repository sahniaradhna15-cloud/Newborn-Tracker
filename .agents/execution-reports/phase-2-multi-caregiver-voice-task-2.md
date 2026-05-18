# Execution Report — Phase 2, Task 2: Caregiver identity

**Status:** SUCCESS (single pass, no `⟂ SPLIT` fallback needed)
**Branch:** `phase-2-task-1-integration-harness` (the de-facto Phase 2 phase branch)
**Date:** 2026-05-18

## Implemented subtasks (all from the plan's Task 2)

- `src/lib/audit.ts` — `writeAudit(tx, {...})` appends one `event_audit` row inside
  the caller's tx; `toAuditJson` narrows Drizzle rows to plain JSON. Append-only;
  no PII (event rows carry no names; tokens/codes never passed).
- `src/lib/rate-limit.ts` — `consume(tx, key, limit, windowSec)` Postgres
  fixed-window token bucket via an atomic `INSERT ... ON CONFLICT DO UPDATE`.
- `src/lib/db/migrations/0002_rate_limits.sql` — `rate_limits(key, window_start,
  count)` + hand-authored §4-style RLS header: RLS ENABLEd, **zero policies**
  (deny-all/fail-closed for `app_runtime`; only the BYPASSRLS service-role path
  writes it), `REVOKE ALL ... FROM anon, authenticated`. Generated via
  `pnpm db:generate` then renamed to the mandated `0002_rate_limits` (journal
  idx 2 + snapshot renamed to match) and the RLS block appended — exactly the
  CLAUDE.md §4 flow used for `0000`.
- `src/lib/record-event.ts` — `writeAudit` on the **three `accepted` creates only**
  (feed/diaper/mom), inside the existing `withUserContext` tx, before each return;
  `.returning({id})` widened to `.returning()` so the full row is the `after`.
  `duplicate`/`merged` are NOT audited (correct — not creates).
- `src/app/api/feeds/[id]/route.ts` + `src/app/api/diapers/[id]/route.ts` —
  PATCH writes `{before:prev, after:next}` `*.updated`; DELETE now fetches the row
  first (for `before`), deletes, writes `{before:prev, after:null}` `*.deleted`,
  returns 404 if absent — all in the one mutation tx.
- `src/middleware.ts` — `/api/recovery/redeem` and `/api/invites/[token]/accept`
  (regex-scoped to the `…/accept` sub-path, NOT the owner-only `POST /api/invites`
  mint) exempted from `X-Requested-With`; same-origin `Origin` check kept; bearer
  routes unchanged.
- `POST /api/invites` (session, owner-only; app 403 + RLS defense-in-depth),
  `POST /api/access-links` (any member; unique-violation → friendly 409;
  `access_link.issued` audit), `POST /api/invites/[token]/accept` (no-session,
  `adminDb`; §11.5; `access_link.redeemed` audit with `revoked_prior`),
  `GET /api/caregivers` (roster + per-member logged-count),
  `POST /api/caregivers/[user_id]/revoke` (owner-only, self-revoke rejected,
  `caregiver.revoked`), `POST /api/caregivers/transfer-ownership` (owner-only,
  atomic role swap, `ownership.transferred`),
  `POST /api/recovery-code/rotate` (session; `recovery_code.rotated`),
  `POST /api/recovery/redeem` (no-auth, rate-limited, `adminDb`; auto-rotate;
  `recovery_code.redeemed`).
- Pages: `src/app/i/[token]/page.tsx` (+ `AcceptInviteCard` client),
  `src/app/(app)/settings/page.tsx`, `settings/caregivers/page.tsx`
  (+ `CaregiversPanel` client), `settings/recovery/page.tsx`
  (+ `RotateRecoveryCode` client), `src/app/recover/page.tsx`,
  `src/app/recover/success/page.tsx`.
- Tests: `test/integration/peer-recovery.test.ts` (P0 R10),
  `test/integration/recovery-code.test.ts`.

## §11.5 invariant — verbatim line shipped

```ts
const shouldRevokePriorSessions =
  issuer?.role === "owner" || invite.createdBy === targetUserId;
```

`issuer` = invite creator (`created_by`); target = `invite.targetUserId`. This
matches CLAUDE.md §11.5 (`issuer.role === "owner" || issuer.user_id ===
target.user_id`) — `invite.createdBy === targetUserId` is the self-issued case
(issuer.user_id === target.user_id). `issuer?.role` is optional-chained because
the membership read can be empty; an absent issuer is treated as non-owner
(fails safe to ADDITIVE — never an unintended revoke). Verified by 6
`peer-recovery.test.ts` specs (additive / owner-revoking / self-revoking /
cross-household-blocked / caregiver-new-invite-blocked / owner-can-mint).

## Divergences from plan (all justified, none scope-reducing)

1. **Migration filename mechanics.** `pnpm db:generate` emitted
   `0001_motionless_proudstar`; renamed file + journal (idx 2, tag
   `0002_rate_limits`) + snapshot to satisfy the mandated `0002_rate_limits.sql`
   name (CLAUDE.md §7). `pnpm db:migrate` applied it cleanly.
2. **Atomicity hardening (code-review self-fix).** The accept/redeem routes
   originally called `revokeAllUserSessions`/`mintSession` from `session.ts`,
   which use a *separate* `db` connection — a rollback after them would leave a
   user locked out with a still-valid old code/invite. Reworked so the session
   revoke + new-session INSERT run **on the `withAdmin` tx** (the `sessions`
   table has no RLS, so the service-role tx writes it freely); only the cookie
   (a response concern) is set post-commit. `session.ts` was NOT modified
   (not in the file list; its primitives are reused elsewhere unchanged).
3. **Rate-limit semantics.** Plan says "5/IP/hour + 24h soft block". Implemented
   as primary 5/IP/hour gate + a *secondary* higher 24h threshold (20/day) so a
   legitimate user who taps the hourly cap a couple times in a day is not
   24h-blocked, while sustained abuse is. Test mirrors these constants.
4. **Harness touch (minimal, necessary).** Added `rate_limits` to
   `_harness.ts` `APP_TABLES` (truncate) and refactored `runMigrations()` to be
   per-migration sentinel-keyed so a fresh DB self-bootstraps `0002` too.
   Task 1's 12 specs still pass unchanged.

## Validation output

- `pnpm typecheck` — clean (no `any`; `unknown` + guards only).
- `pnpm lint` — clean (one `react-hooks/set-state-in-effect` on
  `/recover/success` fixed via `useSyncExternalStore` — hydration-safe,
  server snapshot null).
- `pnpm db:migrate` — `0002_rate_limits.sql` applied; `rate_limits` exists,
  `relrowsecurity=true`.
- `pnpm test` (unit) — **57 passed**, 4 files, ~3s, DB-free (unchanged).
- `pnpm build` — clean; all 9 new routes + 6 pages registered.
- `pnpm test:integration` — **23 passed, 4 files**:
  - `events-idempotency.test.ts` 4 (Task 1, unchanged)
  - `rls-isolation.test.ts` 8 (Task 1, unchanged) → **Task 1's 12 still green**
  - `peer-recovery.test.ts` 6 (NEW, P0 R10)
  - `recovery-code.test.ts` 5 (NEW)

## Service-role cap (CLAUDE.md §3/§8)

Confirmed: **no third file** accesses `process.env.SUPABASE_SERVICE_ROLE_KEY`.
The no-session routes route through `withAdmin` (`src/lib/db/admin.ts`, the
existing conduit). `grep` for the literal string in `src/` matches only JSDoc
comments in the new routes that explicitly state they do NOT add a reference.

## Challenges / notes

- Drizzle-kit's auto migration tag vs. the project's mandated `NNNN_*` naming
  convention required manual journal/snapshot reconciliation; documented above
  so a future migration follows the same pattern.
- `event_audit_household_insert` RLS requires `household_id IN
  current_user_households()`; the session routes satisfy it via
  `withUserContext`, the no-session routes via the BYPASSRLS `withAdmin` tx.
- Integration tests reproduce each route's security core against real Postgres
  (the accept/redeem handlers set cookies via a Next server API unavailable
  under Vitest node; the §11.5 expression + revoke/mint logic is byte-identical
  to the route and is what is asserted).
