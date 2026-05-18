# Execution Report — Phase 2 Task 3: Siri voice (bearer auth + API tokens)

**Branch:** `phase-2-task-1-integration-harness` (de-facto Phase 2 phase branch)
**Date:** 2026-05-18
**Status:** SUCCESS

## Implemented subtasks

| Subtask | File | Result |
|---|---|---|
| `mintApiToken` / `verifyApiToken` / `revokeApiToken` | `src/lib/api-token.ts` (CREATE) | Done. 32-byte base64url token, sha256 at rest, raw returned once. |
| Fill the bearer branch | `src/lib/with-auth.ts` (MODIFY) | Done. Parses `Bearer <tok>`, `verifyApiToken` → `{source:'siri_shortcut', auth_method:'bearer'}`; miss → null; session path unchanged fallback; exported types not moved. |
| `POST /api/tokens` (session mint) | `src/app/api/tokens/route.ts` (CREATE) | Done. `{label?}` → `{ok,id,token,label}`, raw once. |
| `DELETE /api/tokens/[id]` (session revoke) | `src/app/api/tokens/[id]/route.ts` (CREATE) | Done. RLS-scoped revoke, 404 if not the caller's / unknown / already revoked. |
| `POST /api/voice` (bearer legacy adapter) | `src/app/api/voice/route.ts` (CREATE) | Done. Accepts the flat `{action,kind,side,...}` shape, lifts to `InboundEvent`, generates `client_uuid` if absent, calls `recordEvent`, canonical `{ok,status,event_id,say}`. |
| `/settings/voice` page + client island | `src/app/(app)/settings/voice/page.tsx` + `VoiceTokensPanel.tsx` (CREATE) | Done. Server page lists tokens (label, last used, status); client island Generate (raw-once card) / Revoke; six `shortcuts://import-shortcut/?url=…&name=…` deep links with a clearly-named `SIRI_SHORTCUTS` placeholder constant (iCloud URLs empty until user pastes); `NEXT_PUBLIC_APP_URL` surfaced for the Shortcuts' `APP_URL` action. |

## Shortcuts verification (per file)

All against the FINAL `/api/events` contract (endpoint, `Authorization: Bearer` + `Content-Type: application/json` + `X-Requested-With: fetch` headers, body = `InboundEvent` §5.1, "Get Dictionary Value → say" + "Show Notification" reads `say`):

- `shortcuts/README.md` — **verified, no change** (also already documents the `/api/voice` fallback this task builds)
- `shortcuts/log-pee.shortcut.md` — **verified, no change**
- `shortcuts/log-poop.shortcut.md` — **verified, no change**
- `shortcuts/log-dirty-diaper.shortcut.md` — **verified, no change** (correctly notes the diaper `pee||poop` refinement)
- `shortcuts/log-formula.shortcut.md` — **verified, no change** (`wasted_oz` correctly described as optional/omit-when-absent)
- `shortcuts/log-pumped.shortcut.md` — **verified, no change**
- `shortcuts/log-nursing.shortcut.md` — **verified, no change** (`side` lowercase enum note correct)

No drift found. No shortcut files touched.

## Divergences from the plan

1. **`revokeApiToken(userId, tokenId)` instead of `revokeApiToken(tokenId)`.** Required for correctness: `api_tokens` has RLS (`api_tokens_self` keyed on `current_user_id()`). A `revokeApiToken(tokenId)` with no user context runs as `app_runtime` with an unset GUC → the UPDATE matches zero rows and the token is never revoked (silent failure). Scoping by the session caller's `user_id` via `withUserContext` is both correct and the security boundary (a caller cannot revoke another user's token by id). The route already has `ctx.user_id`.

2. **`verifyApiToken` resolves through `withAdmin` (the `adminDb` conduit).** `api_tokens` is RLS-enabled but `verifyApiToken` runs PRE-SESSION (it is establishing identity from the bearer — there is no `request.user_id` GUC yet, identical chicken-and-egg to recovery-code redeem). The established Task 2 codebase pattern for a no-session RLS-table touch is the `adminDb` service-role conduit (`/api/recovery/redeem`, `/api/invites/[token]/accept`). This introduces **no** `process.env.SUPABASE_SERVICE_ROLE_KEY` reference (grep: 0 code usages repo-wide; `admin.ts` uses `DATABASE_URL_ADMIN` + `SET LOCAL ROLE service_role`). The §8/§13 cap (the *service role key env var*, exactly-two-files) is unaffected — `api-token.ts` mentions the string only in a design doc-comment, exactly as the three Task 2 files do.

## Validation output

```
pnpm typecheck   → clean (tsc --noEmit, no output)
pnpm lint        → clean (eslint, no output)
pnpm test        → Test Files 5 passed (5) | Tests 62 passed (62)
pnpm test:integration → Test Files 4 passed (4) | Tests 23 passed (23)
pnpm build       → success; /api/tokens, /api/tokens/[id], /api/voice, /settings/voice all registered
```

**Unit count note:** the suite is **62**, not the "57" cited in the brief. Verified by stashing all Task 3 files and re-running: **62 with AND without Task 3** (identical). The 57 figure is the Phase 2 Task 1 baseline; Task 2's commit `7fcfe3b` added 5 unit tests → 62 is the correct post-Task-2 baseline. Task 3 adds zero unit tests and zero unit regressions.

**Integration:** 23/23 green — Tasks 1+2 specs (`rls-isolation`, `events-idempotency`, `peer-recovery`, `recovery-code`) all still pass. Task 3 adds no integration specs (per the brief); no regression.

## Manual DoD (user-performed, not automatable here — like Phase 1's manual smoke)

- `curl /api/events` with a fresh token → 200 + sensible `say`; wrong token → 401; after revoke → 401
- Same `client_uuid` twice → second response `status:duplicate`, identical `say` (carried by `recordEvent`, covered by the Task 1 idempotency integration test)
- Real iPhone: "Hey Siri, log a pee" → `diaper_events` row `source='siri_shortcut'`, Siri reads wet count; "log 2 oz formula" → `feed_events` `kind=formula`, reads daily total + target band

## Challenges / concerns

- **Stale `src/lib/db/admin.ts` docstring** (not a Task 3 file; surfaced for the user): its header says `withAdmin` is "ALLOWED IN EXACTLY TWO FILES". Task 2 already shipped 2 additional value-importers (`recovery/redeem`, `invites/[token]/accept`); my `api-token.ts` is consistent with that established pattern. The actual CLAUDE.md §8 constraint is on the *`SUPABASE_SERVICE_ROLE_KEY` env var* (0 code references, satisfied). Recommend the user reconcile the `admin.ts` docstring with Task 2's shipped reality in a follow-up.
- **`/settings` index does not link to `/settings/voice`.** `src/app/(app)/settings/page.tsx` is a Task 2 file, out of Task 3's touch scope and not in the parallel-UI-work set; left unmodified to avoid scope creep. Recommend adding the link as a one-line follow-up (the page is reachable directly at `/settings/voice`).
- ~15 unrelated uncommitted parallel-UI-work files were present throughout; not modified, staged, reverted, or stashed (one temporary scoped `git stash` of only Task 3 files was used to verify the unit baseline, then immediately popped — verified restored).
