# Plan: Phase 2 — Multi-Caregiver + Siri Voice + History + PDF

> **Phase:** 2 of 3 from PLAN.md (Week 2)
> **Tasks:** 4 (max 4)
> **Overall Progress: 0%**
> **Status:** Not Started
> **Task Token Budget:** Each task ≤ 150K tokens

## TLDR

Open the app to a second caregiver, make Siri voice logging excellent (with speak-back of today's total + target — the differentiator), wire Supabase Realtime so both phones reflect each other's logs within 2 seconds, and ship the pediatrician PDF export. Each subsystem stands on top of the canonical event pipeline from Phase 1 — no `recordEvent` changes.

## Critical Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Caregiver-issued recovery links are **additive** | Only owner-issued (or self-issued) links revoke prior sessions of the target | Prevents hostile lockout while still solving "Mom lost her phone, Dad gets her back in" (TECHNICAL_SPEC §4.5.1, Risk R10) |
| 2 | Six fixed-shape Siri Shortcuts, not one "smart" parser | Each Shortcut sends a single discriminated payload; one `Ask for Input` prompt per variable | Siri NLP is unreliable in 2026; fixed-shape is rock-solid and free (PLAN.md §"One Shortcut per phrase") |
| 3 | Realtime over polling | Supabase Realtime → `router.refresh()` in a single `(app)/layout.tsx` client provider | 50 lines vs. a 5s poll on every device; free tier easily covers a family (TECHNICAL_SPEC §6.2) |
| 4 | PDF export is free, single-page, last-7-days | `@react-pdf/renderer` server-side; served as a download from `/api/export/pediatrician` | Huckleberry paywalls sleep equivalents at $9.99/mo; PLAN.md killer feature #4 |
| 5 | Audit every write | Every `recordEvent` and every PATCH/DELETE on feed/diaper/mom/weight writes to `event_audit` with before+after payloads | Decision locked in (PLAN.md DECISIONS LOCKED IN — "Edit audit trail") |

## Relevant Files

| File | Action | Purpose |
|------|--------|---------|
| `src/app/i/[token]/page.tsx` | CREATE | Invite-accept landing (new caregiver + peer-recovery) |
| `src/app/recover/page.tsx` | CREATE | Recovery code redemption |
| `src/app/(app)/settings/page.tsx` | CREATE | Settings index |
| `src/app/(app)/settings/caregivers/page.tsx` | CREATE | Invite + revoke + transfer + peer-recovery |
| `src/app/(app)/settings/recovery/page.tsx` | CREATE | View/rotate recovery code |
| `src/app/(app)/settings/voice/page.tsx` | CREATE | API tokens + Siri install deep links |
| `src/app/(app)/history/page.tsx` | CREATE | Last 7 days, editable EventList |
| `src/app/(app)/export/pediatrician/page.tsx` | CREATE | PDF preview + download |
| `src/app/api/invites/route.ts` | CREATE | Owner mints invite (new caregiver) |
| `src/app/api/invites/[token]/accept/route.ts` | CREATE | Accept invite, mint session |
| `src/app/api/access-links/route.ts` | CREATE | Peer-recovery link mint |
| `src/app/api/recovery-code/rotate/route.ts` | CREATE | Rotate recovery code |
| `src/app/api/recovery/redeem/route.ts` | CREATE | Redeem recovery code (rate-limited, no auth) |
| `src/app/api/caregivers/route.ts` | CREATE | List caregivers in household |
| `src/app/api/caregivers/[user_id]/revoke/route.ts` | CREATE | Owner revokes all sessions for user |
| `src/app/api/caregivers/transfer-ownership/route.ts` | CREATE | Swap owner / caregiver roles |
| `src/app/api/tokens/route.ts` | CREATE | Mint/revoke API tokens for Siri |
| `src/app/api/realtime-token/route.ts` | CREATE | Mints short-lived Supabase JWT scoped to household |
| `src/app/api/voice/route.ts` | CREATE | Legacy adapter → `/api/events` |
| `src/app/api/export/pediatrician/route.ts` | CREATE | PDF stream |
| `src/components/EventList.tsx` | CREATE | Editable, grouped by day |
| `src/components/IntakeDonut.tsx` | CREATE | Recharts donut on dashboard |
| `src/components/RealtimeProvider.tsx` | CREATE | Subscribes to feed/diaper changes |
| `src/components/PediatricianPDF.tsx` | CREATE | React-PDF document |
| `src/lib/audit.ts` | CREATE | `writeAudit(tx, ...)` helper |
| `src/lib/api-token.ts` | CREATE | Mint/hash/verify API tokens |
| `src/lib/recovery-code.ts` | MODIFY | Move recovery-code generator here (from `lib/session.ts`) |
| `src/lib/with-auth.ts` | MODIFY | Populate the bearer-token resolver (stub in Phase 1) |
| `src/lib/record-event.ts` | MODIFY | Call `writeAudit` inside the transaction |
| `src/app/api/feeds/[id]/route.ts` | MODIFY | PATCH/DELETE write audit row |
| `src/app/api/diapers/[id]/route.ts` | MODIFY | PATCH/DELETE write audit row |
| `src/app/(app)/layout.tsx` | MODIFY | Mount `RealtimeProvider` |
| `src/components/TodayCard.tsx` | MODIFY | Drop in IntakeDonut |
| `shortcuts/log-pee.shortcut.md` | CREATE | Manual build instructions + iCloud URL slot |
| `shortcuts/log-poop.shortcut.md` | CREATE | (same) |
| `shortcuts/log-dirty-diaper.shortcut.md` | CREATE | (same) |
| `shortcuts/log-formula.shortcut.md` | CREATE | (same) |
| `shortcuts/log-pumped.shortcut.md` | CREATE | (same) |
| `shortcuts/log-nursing.shortcut.md` | CREATE | (same) |

## Dependencies

**New packages:**
- `recharts` — donut + stacked bar on dashboard
- `@react-pdf/renderer` — server-side PDF for pediatrician export
- `@supabase/supabase-js` (already installed in Phase 1) — used here for browser Realtime client

**Configuration changes:**
- `NEXT_PUBLIC_APP_URL` must be set correctly — invite URLs and Siri Shortcut URL bases interpolate it
- Supabase project: enable Realtime on `feed_events` and `diaper_events` tables (UI toggle in Supabase dashboard, or via a small `ALTER PUBLICATION supabase_realtime ADD TABLE ...` SQL)

**Existing utilities to reuse:**
- `src/lib/record-event.ts` — every Siri write goes through this; do not duplicate
- `src/lib/voice-parser.ts` — the legacy `/api/voice` adapter maps to this Zod schema
- `src/lib/with-user-context.ts` — every mutation runs inside a transaction with RLS-bound `request.user_id`
- `src/lib/session.ts` — `mintSession`, `revokeSession`
- `src/lib/day-window.ts` and `src/lib/targets.ts` — PDF export reuses these for the 7-day rollup

## Tasks

### Task 1: Invite flow, caregivers settings, peer recovery, recovery codes

**Estimated scope:** ~13 files (mix of routes + pages + helpers), 7 endpoints, 3 pages
**Files touched:**
- `src/app/i/[token]/page.tsx` (CREATE)
- `src/app/recover/page.tsx` (CREATE)
- `src/app/(app)/settings/page.tsx` (CREATE)
- `src/app/(app)/settings/caregivers/page.tsx` (CREATE)
- `src/app/(app)/settings/recovery/page.tsx` (CREATE)
- `src/app/api/invites/route.ts` (CREATE)
- `src/app/api/invites/[token]/accept/route.ts` (CREATE)
- `src/app/api/access-links/route.ts` (CREATE)
- `src/app/api/recovery-code/rotate/route.ts` (CREATE)
- `src/app/api/recovery/redeem/route.ts` (CREATE)
- `src/app/api/caregivers/route.ts` (CREATE)
- `src/app/api/caregivers/[user_id]/revoke/route.ts` (CREATE)
- `src/app/api/caregivers/transfer-ownership/route.ts` (CREATE)
- `src/lib/recovery-code.ts` (CREATE — extract from Phase 1's `lib/session.ts`)
- `src/lib/audit.ts` (CREATE)
- `src/lib/record-event.ts` (MODIFY — add `writeAudit` call inside transaction)
- `src/app/api/feeds/[id]/route.ts` (MODIFY — audit on PATCH/DELETE)
- `src/app/api/diapers/[id]/route.ts` (MODIFY — audit on PATCH/DELETE)

**Subtasks:**
- [ ] `src/lib/audit.ts`: `writeAudit(tx, { actor_user_id, household_id, kind, entity_table, entity_id, before, after, ip? })` — INSERT into `event_audit` inside the caller's transaction. Kinds: `feed.created|updated|deleted`, `diaper.created|updated|deleted`, `access_link.issued|redeemed`, `recovery_code.redeemed|rotated`, `caregiver.revoked`, `ownership.transferred`.
- [ ] Wire `writeAudit` into `recordEvent` (every successful create) and into the existing `/api/feeds/[id]` and `/api/diapers/[id]` PATCH/DELETE handlers from Phase 1.
- [ ] `POST /api/invites` (owner only): body `{ display_name, role? }`. Generates raw token (32 random bytes base64url), stores `sha256(raw)` in `invites.token_hash`, `expires_at = now() + 7 days`, returns `{ url: ${APP_URL}/i/${raw_token}, expires_at }`. 403 if caller is not owner.
- [ ] `POST /api/access-links` (any active member): body `{ for_user_id }`. Validates target is co-member of caller's household and no outstanding unaccepted peer-recovery invite exists (DB unique index `invites_active_target_idx` enforces this — handle the conflict cleanly). Inserts `invites` row with `target_user_id = for_user_id`, `expires_at = now() + 24 hours`. Writes audit row `access_link.issued`. Returns `{ url, expires_at }`.
- [ ] `GET /i/[token]` page: server component. Hash, look up `invites` by `token_hash`. Validate `expires_at > now()` AND `accepted_at IS NULL`. If `target_user_id IS NULL` (new caregiver invite) render "Welcome — your role is {display_name}. Tap to join" with editable display_name. If `target_user_id IS NOT NULL` (peer recovery) render "Welcome back, {display_name}. Tap to sign in on this device." Invalid/expired/used token → friendly error page (don't leak which case).
- [ ] `POST /api/invites/[token]/accept`: in one `adminDb` transaction (no caller session required):
  - Re-validate token (hash, expiry, not accepted)
  - If `target_user_id IS NULL`: INSERT new `users` (display_name from body), INSERT `household_members(role=caregiver)`, mint session for new user
  - If `target_user_id IS NOT NULL`:
    - Lookup `created_by`'s role: if `owner` OR `created_by == target_user_id` → `UPDATE sessions SET revoked_at = now() WHERE user_id = target_user_id AND revoked_at IS NULL` (the **revoking** branch)
    - If `created_by` is caregiver and target is anyone else → do NOT revoke (the **additive** branch)
    - Mint a fresh session for `target_user_id`
  - UPDATE `invites SET accepted_at = now(), accepted_by = <target>`
  - Set the `nt_session` cookie
  - `writeAudit('access_link.redeemed', { issued_by: created_by, target: target_user_id, revoked_prior: boolean })`
  - Return `{ ok: true, redirect: '/' }`
- [ ] `GET /api/caregivers`: returns list of `household_members` joined with `users` for caller's household.
- [ ] `POST /api/caregivers/[user_id]/revoke` (owner only): `UPDATE sessions SET revoked_at = now() WHERE user_id = $1`. Writes audit row `caregiver.revoked`.
- [ ] `POST /api/caregivers/transfer-ownership` (owner only): body `{ to_user_id }`. In one transaction: swap roles in `household_members` (caller becomes `caregiver`, target becomes `owner`). Writes audit row `ownership.transferred`.
- [ ] `src/app/(app)/settings/caregivers/page.tsx`: server-renders the caregiver list. Each row shows display_name, role badge, "logged X times" stat, and three buttons:
  - "Revoke" (owner only, not on self) — POST `/api/caregivers/[id]/revoke` after confirm modal
  - "Send new access link" (any member, any *other* member) — POST `/api/access-links` → modal shows the URL with "Copy" + "Share" buttons
  - "Transfer ownership" (owner only, not on self) — POST `/api/caregivers/transfer-ownership` after a typed-confirmation modal ("You'll lose owner privileges — continue?")
  Below the list: an "Invite another caregiver" form (owner only) that POSTs `/api/invites` and shows the URL in a copy/share modal.
- [ ] `POST /api/recovery-code/rotate`: in one transaction, `UPDATE recovery_codes SET rotated_at = now() WHERE user_id = $1 AND rotated_at IS NULL AND used_at IS NULL`, INSERT new row with new code_hash, return the raw code. Shown once.
- [ ] `src/app/(app)/settings/recovery/page.tsx`: shows whether the user has an active code (no raw display — that's only shown at mint/rotate/redeem) and a "Rotate code" button that calls the route and shows the new code in a "Save this" modal.
- [ ] `POST /api/recovery/redeem` (no auth, rate-limited): body `{ code }`. Normalize (strip hyphens, uppercase). Hash. Look up `recovery_codes` by `code_hash`. Require `used_at IS NULL AND rotated_at IS NULL`. In one transaction:
  - `UPDATE recovery_codes SET used_at = now(), used_from_ip = req.ip`
  - `UPDATE sessions SET revoked_at = now() WHERE user_id = <code.user_id> AND revoked_at IS NULL`
  - INSERT new session for `<code.user_id>`, set the cookie
  - INSERT a new `recovery_codes` row (auto-rotate per TECHNICAL_SPEC §4.5.2)
  - `writeAudit('recovery_code.redeemed', ...)`
  - Return `{ ok: true, new_recovery_code: <raw> }`
- [ ] Rate limit `/api/recovery/redeem`: 5 attempts per IP per hour, then 24-hour soft block. Implement as a small Postgres-backed token bucket (table `rate_limits(key text, window_start timestamptz, count int)` — add migration `0002_rate_limits.sql`) OR keep it in-memory if the route is on Edge runtime. Postgres-backed is preferred for correctness under serverless cold starts.
- [ ] `src/app/recover/page.tsx`: a single form taking the code. On submit POSTs to `/api/recovery/redeem`. On success: redirects to `/recover/success` (a new page rendered inline) showing the new rotated code with the same "Save this" UI from onboarding.

**Details:**
- All four mutation paths above are state-changing and must include `X-Requested-With: fetch` from the browser. `/api/recovery/redeem` is the exception — it's called from a no-session device, so middleware's CSRF check must explicitly exempt it (or the page submits via a same-origin form, which satisfies the Origin check).
- The "asymmetric authority" invariant is the highest-impact behavior in this task — verify in code review that the `created_by` → `revoke?` decision is exactly: `revoke = (issuer.role === 'owner') || (issuer.user_id === target.user_id)`.
- Display the recovery code with hyphens (`K3HM-7TPN-Q9XR-4FBC`) but accept input in any format (strip whitespace, hyphens, case-fold).

**Depends on:** Phase 1 complete.

**Definition of Done:**
- Owner mints an invite from `/settings/caregivers`, opens the URL in a different browser → onboarding-like page → tap "Join" → new session + cookie → lands on `/`, sees the same baby's data
- Owner revokes the new caregiver → their next page load is rejected (cookie revoked)
- Caregiver-issued peer-recovery link to owner: accepting it creates a NEW session for owner but **does not revoke** owner's existing session (the additive-only invariant)
- Owner-issued peer-recovery link to caregiver: accepting it creates a new session and **revokes** caregiver's prior sessions
- Same-user-issued link (self peer-recovery): revokes own prior sessions on accept
- Recovery code redemption at `/recover` mints a session, revokes priors, returns a fresh rotated code
- Brute-forcing `/api/recovery/redeem` 6× from one IP returns 429 on attempt 6
- Every PATCH on a feed writes an `event_audit` row with before/after JSON
- `pnpm typecheck` and `pnpm lint` pass

---

### Task 2: Bearer auth, API tokens, canonical event ingestion for voice, six Siri Shortcuts

**Estimated scope:** ~10 files, 3 endpoints, 1 settings page + 6 Shortcut markdown docs
**Files touched:**
- `src/lib/api-token.ts` (CREATE)
- `src/lib/with-auth.ts` (MODIFY — populate bearer resolver)
- `src/app/api/tokens/route.ts` (CREATE)
- `src/app/api/voice/route.ts` (CREATE — legacy adapter)
- `src/app/(app)/settings/voice/page.tsx` (CREATE)
- `shortcuts/log-pee.shortcut.md` (CREATE)
- `shortcuts/log-poop.shortcut.md` (CREATE)
- `shortcuts/log-dirty-diaper.shortcut.md` (CREATE)
- `shortcuts/log-formula.shortcut.md` (CREATE)
- `shortcuts/log-pumped.shortcut.md` (CREATE)
- `shortcuts/log-nursing.shortcut.md` (CREATE)

**Subtasks:**
- [ ] `src/lib/api-token.ts`: `mintApiToken(userId, householdId, label)` → returns raw `{ token, id }`, stores `sha256(token)` in `api_tokens.token_hash`; `verifyApiToken(rawBearer)` → `{ user_id, household_id } | null` (also updates `last_used_at` opportunistically); `revokeApiToken(tokenId)` → `UPDATE ... SET revoked_at = now()`.
- [ ] `src/lib/with-auth.ts`: complete the bearer path. If `Authorization: Bearer xxx` header present, call `verifyApiToken`. Return `AuthContext { user_id, household_id, source: 'siri_shortcut', auth_method: 'bearer' }`. Session path remains first.
- [ ] `POST /api/tokens`: body `{ label }`. Auth: session. Mints a token (raw shown once), returns `{ id, token, label }`. `DELETE /api/tokens/[id]`: auth session, sets `revoked_at`. Note: keep token operations under `/api/tokens/[id]` for DELETE; `POST /api/tokens/[id]` returning the raw is OK on creation only.
- [ ] `POST /api/voice`: legacy adapter. Accepts the old shape `{ action: 'feed' | 'diaper', kind?, side?, duration_min?, volume_oz?, wasted_oz?, pee?, poop?, client_uuid?, occurred_at? }`, translates into an `InboundEvent`, calls `recordEvent`. Generates a `client_uuid` if missing. Returns the canonical `{ ok, event_id, say }` shape. Bearer auth only.
- [ ] `src/app/(app)/settings/voice/page.tsx`: server-rendered list of caller's existing tokens (label, last_used_at, status). Buttons:
  - "Generate new token" → posts, then a modal shows the raw value once + "Copy"
  - "Revoke" next to each token
  Below: six `shortcuts://import-shortcut/?url=...&name=...` deep links to iCloud-hosted Shortcut files. URL is filled in by `NEXT_PUBLIC_APP_URL` interpolation + the iCloud share URL stored in a constants file (the user uploads the Shortcut files to iCloud and pastes those URLs into env later).
- [ ] Six Shortcut markdown docs under `shortcuts/`: each one documents the actions in the Shortcut, the URL it POSTs to (`${APP_URL}/api/events`), the headers (`Authorization: Bearer ${API_TOKEN}`, `Content-Type: application/json`, `X-Requested-With: fetch`), the body shape, and the "Show Notification" action that displays the `say` field from the response. The Shortcut is built by hand on the user's iPhone — these markdown files are the recipe and the source of truth, NOT exported `.shortcut` binaries (those get stored in iCloud Drive by the user).
- [ ] Verify with `curl`:
  ```bash
  curl -X POST $APP_URL/api/events \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -H "X-Requested-With: fetch" \
    -d '{
      "client_uuid": "...uuid...",
      "source": "siri_shortcut",
      "occurred_at": "2026-05-14T20:00:00Z",
      "event": { "type": "diaper", "pee": true }
    }'
  # → { "ok": true, "event_id": "...", "say": "Logged. 3 wet diapers today." }
  ```
- [ ] Re-run with the same `client_uuid` → second response is `status: duplicate`, same `say` (the merge-check from Phase 1 Task 3 covers this).

**Details:**
- Shortcuts cannot refresh OAuth, which is why we use long-lived hashed bearer tokens that the user can revoke from `/settings/voice` (TECHNICAL_SPEC §4.4).
- The six Shortcut bodies, in JSON-canonical form (these go in the docs):
  - Log a pee: `{ type: "diaper", pee: true }`
  - Log a poop: `{ type: "diaper", poop: true }`
  - Log a dirty diaper: `{ type: "diaper", pee: true, poop: true }`
  - Log N oz formula: `{ type: "feed", kind: "formula", volume_oz: <N> }`
  - Log N oz pumped: `{ type: "feed", kind: "pumped", volume_oz: <N> }`
  - Log breastfeeding N minutes [side]: `{ type: "feed", kind: "nursing", duration_min: <N>, side: <L|R|B> }`
- The Shortcut for nursing uses **three separate Shortcuts** in practice (one per side) OR one Shortcut with a `Choose from Menu` action — pick whichever the user finds easier. Document both options in `log-nursing.shortcut.md`.
- Do NOT build a "smart" Siri parser in Phase 1 or 2; it's an explicitly deferred item per PLAN.md §"Explicitly Deferred".

**Depends on:** Task 1 (settings layout exists) but does not require Task 1's invite logic to complete — could run in parallel if needed.

**Definition of Done:**
- `/settings/voice` lets the user mint + copy + revoke API tokens
- `curl` against `/api/events` with a fresh token returns 200 and a sensible `say`
- Same `curl` with a wrong token returns 401
- Same `curl` after revoke returns 401
- On the user's actual iPhone, "Hey Siri, log a pee" → row in `diaper_events` with `source = 'siri_shortcut'`, Siri reads back today's wet-diaper count
- "Hey Siri, log 2 ounces formula" → row in `feed_events` with `kind = formula`, Siri reads back the daily total + target range from `lib/targets.ts`
- "Hey Siri, log breastfeeding 15 minutes left" → row with `kind = nursing`, `side = left`, `duration_min = 15`, `estimated_oz` computed from the nursing-rate-by-age table

---

### Task 3: History, EventList, IntakeDonut, Supabase Realtime

**Estimated scope:** ~7 files, 1 endpoint, 3 components
**Files touched:**
- `src/app/(app)/history/page.tsx` (CREATE)
- `src/app/api/realtime-token/route.ts` (CREATE)
- `src/components/EventList.tsx` (CREATE)
- `src/components/IntakeDonut.tsx` (CREATE)
- `src/components/RealtimeProvider.tsx` (CREATE)
- `src/app/(app)/layout.tsx` (MODIFY — mount RealtimeProvider)
- `src/components/TodayCard.tsx` (MODIFY — render IntakeDonut)
- `src/app/api/summary/route.ts` (MODIFY — extend to support `?days=7` for history)

**Subtasks:**
- [ ] In Supabase dashboard (one-time manual step the user performs, document in README): enable Realtime on `feed_events` and `diaper_events`. Verify with the Supabase JS client subscribing to a test channel.
- [ ] `src/app/api/realtime-token/route.ts`: session-authed GET that returns a short-lived (5-minute) Supabase JWT signed with `SUPABASE_SERVICE_ROLE_KEY` with claims `{ role: 'authenticated', sub: <user_id>, app_metadata: { household_id } }`. Realtime RLS uses these claims via Supabase's standard Realtime policies (no extra policy work needed if the table RLS already filters by household). This route MUST NOT be cached.
- [ ] `src/components/RealtimeProvider.tsx` (client): on mount, fetches a token from `/api/realtime-token`, creates `createBrowserClient(URL, ANON_KEY)`, subscribes to `household:${householdId}` channel with two `postgres_changes` listeners (one per table, filtered by `baby_id=eq.${babyId}`), and calls `router.refresh()` on any event. Re-fetches the token every 4 minutes. Disconnects on unmount. Wrap children in a `Suspense` boundary so the initial render is not blocked.
- [ ] `src/app/(app)/layout.tsx`: mount `<RealtimeProvider householdId={...} babyId={...}>` around `{children}`. Pull IDs from the server-resolved session.
- [ ] `src/components/IntakeDonut.tsx` (server component is fine — Recharts works in client only, so this is a thin client wrapper around a server-fetched data prop): donut showing today's oz split — nursing / pumped / formula — with `wasted_oz` shown as a small grey arc segment. Center label shows total + target band.
- [ ] `src/components/TodayCard.tsx` modify: replace the stacked-bar placeholder with `<IntakeDonut data={summary.feeds} target={summary.target} />`.
- [ ] `src/app/api/summary/route.ts` modify: accept `?days=7` (default 1). When `days > 1`, return an array of per-day rollups for the history view.
- [ ] `src/components/EventList.tsx` (client component): grouped by day, each event row shows time, kind, key fields (oz / side / pee/poop), who logged it ("Mom" / "Dad"), and an inline edit affordance (modal or expandable form that PATCHes `/api/feeds/[id]` or `/api/diapers/[id]`) and a delete button (confirm + DELETE). Optimistic UI.
- [ ] `src/app/(app)/history/page.tsx`: server component that fetches `/api/summary?days=7` and renders the 7-day rollup at top + EventList below.

**Details:**
- The dashboard's TodayCard re-renders on Realtime push *because it's a server component* — `router.refresh()` re-runs the server data fetch. No client state to sync.
- Do NOT use the Supabase anon key + RLS for browser-side direct table queries in Phase 2; all reads go through `/api/summary`. Realtime is the only browser-side Supabase usage.
- Show "logged by Mom" / "logged by Dad, edited by Mom 2h ago" attribution on each row by joining `event_audit` on the entity. Phase 1 already creates these rows for new events; Phase 2 Task 1 backfilled the PATCH/DELETE audit calls.

**Depends on:** Task 1 (audit rows must be populated for attribution display) and Task 2 (token UI is nearby in settings; not a hard dependency).

**Definition of Done:**
- Two phones, both logged in (one as Mom, one as Dad). Mom logs a feed from her phone → Dad's TodayCard updates within 2 seconds (no manual refresh)
- EventList groups events by day, shows "logged by Dad" attribution, allows inline edit + delete with confirm
- TodayCard donut shows the correct split between nursing / pumped / formula
- `/history` shows last 7 days with a per-day intake total and the EventList below
- Disabling Realtime in Supabase (or going offline) does NOT break the dashboard — it just stops auto-refreshing

---

### Task 4: Pediatrician PDF export

**Estimated scope:** ~3 files, 1 endpoint, 1 page
**Files touched:**
- `src/components/PediatricianPDF.tsx` (CREATE)
- `src/app/api/export/pediatrician/route.ts` (CREATE)
- `src/app/(app)/export/pediatrician/page.tsx` (CREATE)

**Subtasks:**
- [ ] `src/components/PediatricianPDF.tsx`: `@react-pdf/renderer` document component. Takes `{ baby, household, days: DayRollup[] }`. Renders a single-page (Letter size) PDF:
  - Header: "Newborn Tracker — {baby.name}, DOB {baby.birth_date}, age {N}d"
  - Section "Feeding (last 7 days)": small table per day with date, total oz, nursing min, pumped oz, formula oz, target band, color-coded "within / below / above target" pill
  - Section "Diapers (last 7 days)": small table per day with wet count, dirty count
  - Section "Notes": flat list of any event notes from the period
  - Footer: "Generated by Newborn Tracker on {date}. Informational, not medical advice."
- [ ] `GET /api/export/pediatrician?from=&to=` (session): query the events in the range via `lib/day-window` + `lib/targets`. Render the PDF via `@react-pdf/renderer`'s `renderToStream`. Return as `application/pdf` with `Content-Disposition: attachment; filename="anay-feeding-summary-${from}-to-${to}.pdf"`. Default `from = today - 7 days`, `to = today` if not provided.
- [ ] `src/app/(app)/export/pediatrician/page.tsx`: server component that renders a preview of the same data (as HTML, mirroring the PDF layout) and a "Download PDF" button that links to `/api/export/pediatrician?from=&to=`. Allow the user to pick a date range (defaults to last 7 days).

**Details:**
- Keep the PDF *one page*. Tight margins. Pediatricians scan, they don't read.
- Do NOT include caregiver attribution in the PDF — pediatrician doesn't need that and it might raise privacy concerns when shared.
- This is a **free** feature per PLAN.md killer feature #4 — no paywall checks anywhere.
- Mom-events (medication, mood) are **excluded** from this export by RLS (the `mom_events_self` policy only returns rows authored by the calling user, but more importantly the PDF query just shouldn't read `mom_events` at all — it's the baby's pediatrician, not the mom's GP).

**Depends on:** Task 3 (reuses `/api/summary?days=N` shape).

**Definition of Done:**
- `/export/pediatrician` renders the HTML preview of last 7 days with feed/diaper rollups + target adherence
- "Download PDF" produces a 1-page PDF that a pediatrician can read without scrolling
- Sharing the PDF via iMessage from Safari works (iOS quirk: PDFs served as `application/pdf` with `Content-Disposition: attachment` open in the iOS PDF viewer on tap)
- Mom-events do NOT appear in the export under any circumstance

## Testing Strategy

### Test 1: Asymmetric authority for peer recovery (Risk R10, security checklist)

**File:** `src/lib/access-links.test.ts` (create)

Integration test against a real test Postgres (Supabase dev project or local Docker):

- [ ] Caregiver issues a peer-recovery link to the owner → after acceptance: owner has TWO active sessions (additive); caregiver-issued link did NOT revoke
- [ ] Owner issues a peer-recovery link to caregiver → after acceptance: caregiver has ONE active session; old caregiver sessions are revoked
- [ ] User issues a peer-recovery link to themselves → after acceptance: only the new session is active (self-revoking branch)
- [ ] Caregiver attempts to issue a link with `target_user_id` outside their household → 403
- [ ] Caregiver attempts to mint an invite with `target_user_id IS NULL` (a "new caregiver" invite) → 403 (only owner may)

**Approach:** integration

### Test 2: Recovery code redeem flow

**File:** `src/lib/recovery-code.test.ts` (create)

- [ ] Onboarding mints exactly one active recovery code per user
- [ ] Redemption normalizes (handles `K3HM-7TPN-Q9XR-4FBC`, `k3hm7tpnq9xr4fbc`, with/without spaces)
- [ ] Successful redeem rotates the code, revokes prior sessions, mints new session
- [ ] 6th attempt from one IP in an hour returns 429
- [ ] Used code → 401 on second redemption

**Approach:** integration

### Test 3: Idempotency of `/api/events`

**File:** `src/app/api/events/route.test.ts` (create)

- [ ] Same `client_uuid` twice → one row, second response has `status: duplicate`, same `say`
- [ ] Two distinct `client_uuid` for feeds 3 minutes apart → both rows; the second has `corroborating_sources IS NULL` (5-min merge window means same `client_uuid` would have hit, different uuids don't)
- [ ] Two distinct `client_uuid` for diapers 1 minute apart with same fields → second is `merged`, `corroborating_sources` updated on the first row
- [ ] Manual edit (PATCH) on a row sets `locked_at`; next merge-window candidate inserts a new row instead

**Approach:** integration

### Test 4: Manual smoke (PLAN.md §"Verification — After Week 2")

- [ ] Partner accepts invite on a second iPhone with their own display name → sees the same baby's events
- [ ] Owner revokes Dad → Dad's next request 401 → owner mints a fresh invite → Dad re-accepts → back in
- [ ] Mom's phone "lost" (Safari → clear data); Dad taps "Send new access link" next to Mom in `/settings/caregivers` → URL shared → Mom opens on new device → signed in as Mom with full history → Mom's old phone still works (additive)
- [ ] Dad's phone "lost"; Mom taps "Send new access link" → Dad opens new link → Dad signed in, old session dead (revoking)
- [ ] At `/recover`, enter the recovery code from onboarding → land on `/recover/success` with a *new* code displayed
- [ ] Owner transfers ownership to Dad → Mom can no longer revoke/invite, Dad can
- [ ] Two iPhones online: Mom logs feed → Dad's dashboard updates within 2s (Realtime)
- [ ] `/export/pediatrician` → PDF with last 7 days

## Validation Commands

```bash
# Linting
pnpm lint

# Type checking
pnpm typecheck

# Tests
pnpm test

# Build verification
pnpm build

# Migration
pnpm db:migrate
```

Manual:

```bash
# Curl smoke test for canonical event endpoint
TOKEN="..."  # paste the raw token from /settings/voice
curl -X POST $APP_URL/api/events \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Requested-With: fetch" \
  -d '{"client_uuid":"'"$(uuidgen)"'","source":"siri_shortcut","occurred_at":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","event":{"type":"diaper","pee":true}}'
```

## Integration Notes

- **Builds on Phase 1:** No changes to `recordEvent`'s signature — only an internal call to `writeAudit`. The canonical `/api/events` already exists; Phase 2 just populates the bearer resolver and authors the Shortcuts.
- **Sets up Phase 3:** Realtime is the substrate Phase 3's offline-queue replay listens to (queued events POST to `/api/events`, Realtime propagates them to other devices). PDF + Realtime + multi-caregiver complete the "shippable to family" milestone.
- **Breaking changes:** None — Phase 1 routes (`/api/feeds`, `/api/diapers`) keep their shape. PATCH/DELETE handlers now write audit rows (additive).
- **Documentation updates:** Add a "Multi-caregiver setup" section to `README.md` (how to invite a partner, how to recover a lost phone, how to add Siri Shortcuts).
- **Migration:** Add `0002_rate_limits.sql` if implementing the rate-limit table; otherwise no schema changes — all tables exist from Phase 1's `0001_initial.sql`.
- **Things NOT done in Phase 2:**
  - PWA manifest, service worker, "Add to Home Screen" — Phase 3
  - Offline queue — Phase 3
  - Growth chart, WHO percentiles, weight settings — Phase 3
  - Mom tab UI — Phase 3 (`mom_events` table exists; route + UI don't)
  - Low-pee 8pm banner — Phase 3
  - Health bridge `GET /api/health-export` — deferred post-MVP per PLAN.md
  - Alexa/Google adapters, hardware webhooks — deferred per PLAN.md "Explicitly Deferred"
