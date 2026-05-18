# Plan: Phase 1 — Core Logging + Intake Intelligence

> **Phase:** 1 of 3 from PLAN.md (Week 1)
> **Tasks:** 4 (max 4)
> **Overall Progress: 50% (Tasks 1–2 of 4 complete)**
> **Status:** In Progress — Task 1 ✅ (2026-05-16). Task 2 ✅ (2026-05-17): migrations applied to live Supabase, seed idempotent, onboarding/redirect verified, RLS isolation enforced via dedicated `app_runtime` role (owner-bypass P0 found + fixed). Next.js 16 + Tailwind 4 (superseding planned 15/3).
> **Task Token Budget:** Each task ≤ 150K tokens

## TLDR

Stand up the Next.js 15 + Supabase + Drizzle PWA from zero. By the end of this phase, the owner (Aradhna) can onboard, log feeds (nursing/pumped/formula) and diapers from her iPhone in Safari, and see a TodayCard answering "is baby getting enough?" with a live age-adjusted intake target. Every write must go through `recordEvent()` so Siri integration in Phase 2 is a thin adapter. No multi-caregiver, no voice, no PWA install, no offline — those land in Phases 2 and 3.

## Critical Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Auth tables in Phase 1 | Custom `users` + `sessions` (no NextAuth) | Decision locked in: invite-link sessions, no email/OAuth. NextAuth is overhead for a 50-line cookie. |
| 2 | All writes funnel through one function | `recordEvent(ctx, inbound)` from day 1, called by `/api/events`, `/api/feeds`, `/api/diapers` | Retrofitting integrations is expensive; the canonical pipeline is cheap to build now per TECHNICAL_SPEC §0/§5. |
| 3 | RLS enabled on every app table from migration 0001 | Postgres enforces household boundary via `SET LOCAL request.user_id` | App-level checks are easy to forget; if a caregiver sees another household's data, the product is broken (R1, catastrophic). |
| 4 | DB driver | `postgres-js` + Supabase pooled connection (port 6543) | Drizzle's recommended driver for Supabase; PLAN.md's lingering `@neondatabase/serverless` mention is superseded by TECHNICAL_SPEC §2. |
| 5 | TodayCard renders server-side | React Server Component; client only for QuickLogBar optimistic UI | First paint on mobile 4G needs to be one round-trip; Realtime is added in Phase 2. |
| 6 | Browser support | Latest two versions of **Chrome (desktop + Android), Safari (macOS + iOS), Edge, Firefox** | The web app is fully cross-browser; only the Siri Shortcuts integration in Phase 2 is iPhone-only. Don't ship anything in Phase 1 that depends on a Safari-only or Chrome-only API. |

## Relevant Files

| File | Action | Purpose |
|------|--------|---------|
| `package.json` | CREATE | Pinned deps per TECHNICAL_SPEC §2 |
| `next.config.ts` | CREATE | App Router config |
| `tailwind.config.ts` | CREATE | Tailwind + shadcn theme |
| `tsconfig.json` | CREATE | `strict: true` |
| `drizzle.config.ts` | CREATE | Migrations target `src/lib/db/migrations/` |
| `.env.example` | CREATE | Document required env vars |
| `.gitignore` | CREATE | `.env.local`, `*.shortcut`, `node_modules`, `.next` |
| `src/app/layout.tsx` | CREATE | Root layout |
| `src/app/page.tsx` | CREATE | Dashboard (TodayCard) |
| `src/app/onboarding/page.tsx` | CREATE | First-visit household creation |
| `src/app/(app)/log/feed/page.tsx` | CREATE | FeedForm host page |
| `src/app/(app)/log/diaper/page.tsx` | CREATE | DiaperForm host page |
| `src/app/api/onboarding/create-household/route.ts` | CREATE | Onboarding endpoint |
| `src/app/api/events/route.ts` | CREATE | Canonical ingestion |
| `src/app/api/feeds/route.ts` | CREATE | PWA feed CRUD (POST/GET) |
| `src/app/api/feeds/[id]/route.ts` | CREATE | Feed PATCH/DELETE |
| `src/app/api/diapers/route.ts` | CREATE | PWA diaper CRUD |
| `src/app/api/diapers/[id]/route.ts` | CREATE | Diaper PATCH/DELETE |
| `src/app/api/summary/route.ts` | CREATE | Today rollup + target band |
| `src/components/TodayCard.tsx` | CREATE | The differentiator |
| `src/components/FeedForm.tsx` | CREATE | 3-tab nursing/pumped/formula |
| `src/components/DiaperForm.tsx` | CREATE | Wet / Dirty buttons |
| `src/components/QuickLogBar.tsx` | CREATE | Optimistic shortcuts on dashboard |
| `src/lib/db/schema.ts` | CREATE | All Drizzle table definitions |
| `src/lib/db/client.ts` | CREATE | RLS-aware Drizzle client |
| `src/lib/db/admin.ts` | CREATE | Service-role client (onboarding only) |
| `src/lib/db/migrations/0001_initial.sql` | CREATE | All tables + RLS + helper func |
| `src/lib/db/seed.ts` | CREATE | Aradhna + Anay seed |
| `src/lib/session.ts` | CREATE | Cookie mint / verify / revoke |
| `src/lib/with-user-context.ts` | CREATE | Wraps Drizzle calls in RLS-bound transaction |
| `src/lib/with-auth.ts` | CREATE | Unified `AuthContext` resolver (session + bearer stub) |
| `src/lib/record-event.ts` | CREATE | THE service function |
| `src/lib/voice-parser.ts` | CREATE | Zod `InboundEvent` discriminated union |
| `src/lib/outbox.ts` | CREATE | Transactional outbox writer |
| `src/lib/targets.ts` | CREATE | Daily target band + nursing rate by age |
| `src/lib/day-window.ts` | CREATE | 4am rollover math (DST-safe) |
| `src/lib/targets.test.ts` | CREATE | Unit test |
| `src/lib/day-window.test.ts` | CREATE | Unit test (DST fixtures required) |
| `src/middleware.ts` | CREATE | Origin check + session cookie resolve |
| `README.md` | CREATE | Local dev steps per TECHNICAL_SPEC §8 |

## Dependencies

**New packages:**
- `next@15` — App Router framework
- `react@19`, `react-dom@19` — Next 15 default
- `typescript@^5.5`, `@types/node`, `@types/react` — strict TS
- `drizzle-orm`, `drizzle-kit` — typed ORM + migrations
- `postgres` (postgres-js) — Drizzle's recommended driver for Supabase
- `@supabase/supabase-js` — anon client for future Realtime (used in Phase 2; install now)
- `zod` — schema validation
- `tailwindcss`, `postcss`, `autoprefixer` — styling
- `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react` — shadcn helpers
- `react-hook-form`, `@hookform/resolvers` — forms with Zod
- `date-fns`, `date-fns-tz` — DST-safe America/Chicago math
- `vitest`, `@vitest/coverage-v8` — unit tests (dev)

**Configuration changes:**
- `.env.local` (untracked) — `DATABASE_URL`, `DATABASE_URL_DIRECT`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL=http://localhost:3000`
- Supabase dev project provisioned (user creates manually; URL + keys pasted into `.env.local`)
- `package.json` scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `db:generate`, `db:migrate`, `db:seed`

## Tasks

### Task 1: Scaffold project and infrastructure

**Estimated scope:** ~10 files, 0 endpoints, 0 components
**Files touched:**
- `package.json` (CREATE)
- `next.config.ts` (CREATE)
- `tailwind.config.ts`, `postcss.config.js` (CREATE)
- `tsconfig.json` (CREATE)
- `drizzle.config.ts` (CREATE)
- `.env.example`, `.gitignore` (CREATE)
- `src/app/layout.tsx`, `src/app/page.tsx` (CREATE — placeholder "hello newborn tracker")
- `src/app/globals.css` (CREATE — Tailwind directives)
- `README.md` (CREATE)
- `components.json` (CREATE — shadcn config)

**Subtasks:**
- [ ] Run `pnpm create next-app@latest . --typescript --tailwind --app --src-dir --eslint --no-import-alias` (or equivalent flags to land on Next.js 15 + App Router + `src/` + Tailwind)
- [ ] **Cross-browser baseline.** Set Browserslist target in `package.json` to `["last 2 Chrome versions", "last 2 Safari versions", "last 2 Edge versions", "last 2 Firefox versions", "last 2 iOS versions", "last 2 ChromeAndroid versions"]`. Do NOT use any Safari-only or Chrome-only API in Phase 1. Verified APIs we will use: `crypto.randomUUID()` (all modern browsers), `fetch`, `IndexedDB` (Phase 3), service workers (Phase 3). Anything else needs a feature check before adoption.
- [ ] Install runtime deps: `pnpm add drizzle-orm postgres @supabase/supabase-js zod react-hook-form @hookform/resolvers date-fns date-fns-tz class-variance-authority clsx tailwind-merge lucide-react`
- [ ] Install dev deps: `pnpm add -D drizzle-kit @types/pg vitest @vitest/coverage-v8`
- [ ] Initialize shadcn: `pnpm dlx shadcn@latest init` — accept defaults, generate `components/ui/` aliased to `@/components/ui`
- [ ] Add shadcn primitives we know we need: `pnpm dlx shadcn@latest add button input label card tabs toast`
- [ ] Create `drizzle.config.ts` pointing at `src/lib/db/schema.ts` and `src/lib/db/migrations/`
- [ ] Add scripts to `package.json`: `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `db:generate`, `db:migrate`, `db:seed`
- [ ] Populate `.env.example` with the keys listed in Dependencies (no values)
- [ ] Confirm `.gitignore` includes `.env.local`, `.env`, `node_modules`, `.next`, `*.shortcut`
- [ ] Replace `src/app/page.tsx` with a one-screen placeholder ("Newborn Tracker — setup complete")
- [ ] Write `README.md` with local dev steps from TECHNICAL_SPEC §8 (no Vercel deploy steps yet; deploy is a manual step the user performs)

**Details:**
Use `pnpm`. Pin to Next.js 15.x, React 19. `tsconfig.json` must set `strict: true` and `target: ES2022`. Path alias `@/*` → `src/*`. Do NOT install Sentry, Inngest, Recharts, Serwist, `@react-pdf/renderer` in this phase — they're for Phase 2/3. Do NOT install `next-auth` (we are not using it).

**Depends on:** None

**Definition of Done:**
- `pnpm dev` boots the placeholder page at `http://localhost:3000` with no console errors
- **Manual cross-browser smoke:** the placeholder page renders correctly with zero console errors in **Chrome (desktop)**, **Safari (desktop)**, **Chrome on Android** (or Chrome DevTools device emulation), and **Safari on iOS** (or Safari Responsive Design Mode emulating iPhone). If any browser shows an error or layout break, fix before closing the task.
- `pnpm typecheck` and `pnpm lint` both pass
- `.env.example` documents every required env var
- `README.md` lists the steps a fresh clone takes to get to a running dev server (including the manual Supabase project creation), and explicitly lists the supported browsers
- No DB, no API routes, no business components yet — those land in subsequent tasks

---

### Task 2: Database schema, RLS, sessions, and onboarding

**Estimated scope:** ~12 files, 1 endpoint, 0 user-facing components (1 onboarding page)
**Files touched:**
- `src/lib/db/schema.ts` (CREATE)
- `src/lib/db/client.ts` (CREATE)
- `src/lib/db/admin.ts` (CREATE)
- `src/lib/db/migrations/0001_initial.sql` (CREATE)
- `src/lib/db/seed.ts` (CREATE)
- `src/lib/session.ts` (CREATE)
- `src/lib/with-user-context.ts` (CREATE)
- `src/lib/with-auth.ts` (CREATE)
- `src/middleware.ts` (CREATE)
- `src/app/api/onboarding/create-household/route.ts` (CREATE)
- `src/app/onboarding/page.tsx` (CREATE)
- `src/app/page.tsx` (MODIFY — redirect to `/onboarding` if no session)

**Subtasks:**
- [ ] Write `src/lib/db/schema.ts` with Drizzle table definitions for: `users`, `sessions`, `households`, `household_members`, `babies`, `weight_events`, `feed_events`, `diaper_events`, `mom_events`, `invites`, `api_tokens`, `inbound_events`, `event_outbox`, `event_audit`, `recovery_codes`. Mirror PLAN.md §"Data Model" and TECHNICAL_SPEC §3.1–§3.3 exactly (including `corroborating_sources jsonb`, `locked_at`, `wasted_oz`, `client_uuid unique`, `source` defaults).
- [ ] Write `0001_initial.sql` (hand-authored — Drizzle generation does not produce the RLS policies):
  - All tables with constraints/indexes
  - `CREATE EXTENSION IF NOT EXISTS pgcrypto` for `gen_random_uuid()`
  - `CREATE OR REPLACE FUNCTION current_user_households() ...` (TECHNICAL_SPEC §3.4)
  - `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` on all app tables
  - RLS policies for every table per TECHNICAL_SPEC §3.4 (own + household + the `mom_events_self` and `recovery_codes_self` exceptions)
  - Unique indexes: `sessions_token_hash_idx`, `invites_token_hash_idx`, `invites_active_target_idx`, `recovery_codes_code_hash_idx`, `recovery_codes_active_user_idx`, `inbound_events_dedupe_idx`, `feed_events_baby_time`, `diaper_events_baby_time`
- [ ] `src/lib/db/client.ts`: export a `db` (Drizzle bound to `postgres-js`, pooled URL) and `dbDirect` (session-mode URL, used by migrations only) — both via env vars
- [ ] `src/lib/db/admin.ts`: export an `adminDb` that uses `SUPABASE_SERVICE_ROLE_KEY` and is safe to call only from the onboarding route. Mark with a top-of-file comment per TECHNICAL_SPEC §11.
- [ ] `src/lib/with-user-context.ts`: `withUserContext(userId: string, fn: (tx) => Promise<T>): Promise<T>` — opens a transaction, runs `SELECT set_config('request.user_id', $1, true)`, calls `fn`, commits. Bypassing this for normal queries is a P0 bug — document at top of file.
- [ ] `src/lib/session.ts`: `mintSession(userId, deviceLabel)`, `verifySessionCookie(rawToken) → { userId, householdId } | null`, `revokeSession(sessionId)`. Cookie spec per TECHNICAL_SPEC §4.2 (HttpOnly, Secure in prod, SameSite=Lax, Max-Age=1y, name `nt_session`). Hash with SHA-256 before storing.
- [ ] `src/lib/with-auth.ts`: `withAuth(req): Promise<AuthContext | null>` — tries session cookie first, then `Authorization: Bearer` (looks up `api_tokens.token_hash`). Returns `{ user_id, household_id, source: 'pwa' | 'siri_shortcut', auth_method: 'session' | 'bearer' }`. The bearer path can be a stub in Phase 1 (returns null) — it's properly populated in Phase 2 Task 2.
- [ ] `src/middleware.ts`: on POST/PATCH/DELETE, require `Origin` matches `NEXT_PUBLIC_APP_URL` and `X-Requested-With: fetch` header (skip for `/api/events`, `/api/voice` — they use bearer auth). Resolve session cookie and attach to request (via header) for downstream routes.
- [ ] `src/app/api/onboarding/create-household/route.ts`: POST endpoint that, in one `adminDb` transaction, inserts `users` (display_name = body.owner_display_name), `households` (name = "My Family"), `household_members` (role=owner), `babies` (Anay defaults from body), then mints a session and sets the cookie. Returns `{ ok: true }` and the redirect target. Generate and return the initial `recovery_codes` raw code in the response so the UI can show the "save this" card (TECHNICAL_SPEC §4.5.2).
- [ ] `src/app/onboarding/page.tsx`: a single form (household name pre-filled "My Family", baby name "Anay Srivastava", DOB "2026-04-23", birth weight "109" oz, owner display name "Mom"). On submit calls the endpoint, then shows a full-screen "Save your recovery code" card with the raw code (copy + print buttons) and a single "I've saved it" CTA that redirects to `/`.
- [ ] `src/app/page.tsx`: server component that checks for session via `withAuth`. If none, redirect to `/onboarding`. Otherwise render a "Dashboard placeholder — TodayCard lands in Task 4" stub.
- [ ] `src/lib/db/seed.ts`: idempotent script that, if no households exist, inserts Aradhna (display_name "Mom") as owner of "My Family" + Anay (DOB 2026-04-23, birth weight 109 oz). Used for local dev only; production goes through `/onboarding`.

**Details:**
- Use `pgcrypto`'s `gen_random_uuid()` for all UUID defaults; Drizzle declares `defaultRandom()`.
- The migration SQL is hand-authored, not generated by `drizzle-kit generate`, because Drizzle does not emit RLS policies. Use `drizzle-kit generate` to confirm the table DDL matches your schema file, then hand-merge any policy/index SQL into `0001_initial.sql`.
- `SUPABASE_SERVICE_ROLE_KEY` is referenced in exactly two files (`src/lib/db/admin.ts`, `src/app/api/onboarding/create-household/route.ts`) and nowhere else — keep that list short for the audit in TECHNICAL_SPEC §11.
- The recovery-code generator (Crockford Base32, 4-4-4-4 hyphenated, ~80 bits) goes in `src/lib/session.ts` for now; will be reused by `/api/recovery-code/rotate` in Phase 2.

**Depends on:** Task 1

**Definition of Done:**
- `pnpm db:migrate` against a fresh Supabase dev project applies `0001_initial.sql` with zero errors
- `pnpm db:seed` is idempotent (re-running does not duplicate rows)
- Visiting `/` with no cookie redirects to `/onboarding`
- Submitting the onboarding form creates the household, mints a session, sets the cookie, and shows the recovery-code card with a real 16-char Crockford Base32 code (e.g. `K3HM-7TPN-Q9XR-4FBC`)
- After dismissing the card the user lands on `/` with the dashboard placeholder
- Manual check: a `SELECT` against `feed_events` from `psql` without `SET LOCAL request.user_id` returns zero rows (RLS blocks anonymous access)

---

### Task 3: Canonical event pipeline + manual logging forms

**Estimated scope:** ~12 files, 5 endpoints, 3 components
**Files touched:**
- `src/lib/voice-parser.ts` (CREATE)
- `src/lib/record-event.ts` (CREATE)
- `src/lib/outbox.ts` (CREATE)
- `src/app/api/events/route.ts` (CREATE)
- `src/app/api/feeds/route.ts` (CREATE)
- `src/app/api/feeds/[id]/route.ts` (CREATE)
- `src/app/api/diapers/route.ts` (CREATE)
- `src/app/api/diapers/[id]/route.ts` (CREATE)
- `src/components/FeedForm.tsx` (CREATE)
- `src/components/DiaperForm.tsx` (CREATE)
- `src/components/QuickLogBar.tsx` (CREATE)
- `src/app/(app)/log/feed/page.tsx` (CREATE)
- `src/app/(app)/log/diaper/page.tsx` (CREATE)

**Subtasks:**
- [ ] `src/lib/voice-parser.ts`: Zod `InboundEvent` discriminated union exactly as in TECHNICAL_SPEC §5.1 (`FeedNursing`, `FeedBottle`, `FeedEvent`, `DiaperEvent`, `MomEvent`). Export the inferred TS type.
- [ ] `src/lib/outbox.ts`: `enqueue(tx, topic, payload)` — inserts a row into `event_outbox` *inside the caller's transaction*. No consumer logic here.
- [ ] `src/lib/record-event.ts`: `recordEvent(ctx: AuthContext, inbound: InboundEvent): Promise<RecordResult>` per TECHNICAL_SPEC §5.2. Inside one `withUserContext` transaction:
  1. INSERT into `inbound_events`, ON CONFLICT (`source`, `client_uuid`) → return existing `resulting_event_id` as `{status: 'duplicate', ...}`
  2. Resolve `baby_id` from `household_id` if absent
  3. For feeds: compute `estimated_oz` using `lib/targets.ts` nursing-rate-by-age helper (added in Task 4 — for now stub with a simple `duration_min * 0.15` and a `// TODO Task 4` comment, OR add the helper now and call it)
  4. Merge-window check (5min feeds, 2min diapers, 10min sleep). On hit: update existing event's `corroborating_sources jsonb`, return `{status: 'merged'}`
  5. INSERT into the domain table
  6. `enqueue(tx, 'event.{feed|diaper|mom}.recorded', payload)`
  7. UPDATE the `inbound_events` row with `resulting_event_id`, `resulting_table`, `status`
  After commit (outside the transaction), compute the `say` field per TECHNICAL_SPEC §5.2 — keep this read separate from the write.
- [ ] `src/app/api/events/route.ts`: POST handler. Resolve `withAuth` (in Phase 1 this is session-only; bearer path is stubbed). Parse body with `InboundEvent`. Call `recordEvent`. Return `{ ok: true, event_id, say }` on success, the error shape from §5.4 on failure (always include `say`).
- [ ] `src/app/api/feeds/route.ts`: POST that maps body into an `InboundEvent` with `event.type='feed'`, calls `recordEvent`, returns the inserted row. GET that lists today's feeds for the active household (used by EventList in Phase 2 — return shape should already be the row shape).
- [ ] `src/app/api/feeds/[id]/route.ts`: PATCH (partial edit; set `locked_at = now()` so future merges don't clobber). DELETE (soft? no — hard delete is fine since `event_audit` will record it; for Phase 1 hard delete is acceptable, audit table is wired in Phase 2 Task 1).
- [ ] `src/app/api/diapers/route.ts`, `src/app/api/diapers/[id]/route.ts`: same pattern as feeds.
- [ ] `src/components/FeedForm.tsx` (client component): three tabs (`Tabs` from shadcn) — Nursing / Pumped / Formula. Nursing fields: side (left/right/both), duration_min. Bottle fields: volume_oz, wasted_oz (optional). Common: occurred_at (default now), note. Generate `client_uuid` with `crypto.randomUUID()`. Submit posts to `/api/feeds` with `X-Requested-With: fetch`. Optimistic toast on submit; redirect to `/` on success.
- [ ] `src/components/DiaperForm.tsx` (client component): two large toggle buttons (Wet / Dirty), tap one or both, optional note. Default `occurred_at = now()`. Submit to `/api/diapers`.
- [ ] `src/components/QuickLogBar.tsx` (client component): four buttons on the dashboard — Wet, Dirty, Wet+Dirty, "Log feed" (links to `/log/feed`). The three diaper buttons fire optimistic POSTs directly without leaving the dashboard.
- [ ] `src/app/(app)/log/feed/page.tsx`, `src/app/(app)/log/diaper/page.tsx`: thin page hosts that render the forms inside the `(app)` layout (auth-required).

**Details:**
- Every mutation route must enforce `withAuth` returning non-null and the request passing the middleware's CSRF check; reject 401 or 403 otherwise.
- `recordEvent` is the single write path; do NOT INSERT directly into `feed_events`/`diaper_events` from route handlers. PATCH/DELETE routes go directly to the table (they are not "events"), but they MUST set `locked_at` on PATCH so the merge window check skips them.
- Forms: use `react-hook-form` + `@hookform/resolvers/zod` so the same Zod schema validates client and server.
- Generate `client_uuid` client-side; if the user double-taps submit, server idempotency makes the second request a no-op returning the same `say`.
- `crypto.randomUUID()` is supported in Chrome 92+, Safari 15.4+, Firefox 95+, Edge 92+. If we ever need to support older browsers, fall back to `uuid` package — not needed in Phase 1.

**Depends on:** Task 2

**Definition of Done:**
- Manual: with a session cookie, submit FeedForm (nursing 10 min left side) → row in `feed_events` with `source='pwa'`, `estimated_oz≈1.5`, response includes a `say` string
- Manual: submit FeedForm twice with the same `client_uuid` (DevTools) → exactly one row, second response status `duplicate`
- Manual: DiaperForm with both Wet and Dirty checked → one row in `diaper_events` with `pee=true` AND `poop=true`
- Manual: PATCH a feed → row updated, `locked_at IS NOT NULL`
- Manual: cross-origin POST to `/api/feeds` (e.g. from `evil.example`) is rejected by middleware Origin check
- `curl -X POST /api/events` without a session/bearer returns 401
- `pnpm typecheck` and `pnpm lint` pass

---

### Task 4: Intake intelligence — targets, day window, TodayCard, inline insights

**Estimated scope:** ~7 files (3 logic + 3 tests + 2 components + 1 endpoint), 1 endpoint, 2 components
**Files touched:**
- `src/lib/targets.ts` (CREATE)
- `src/lib/day-window.ts` (CREATE)
- `src/lib/insights.ts` (CREATE)
- `src/lib/targets.test.ts` (CREATE)
- `src/lib/day-window.test.ts` (CREATE)
- `src/lib/insights.test.ts` (CREATE)
- `src/app/api/summary/route.ts` (CREATE)
- `src/components/TodayCard.tsx` (CREATE)
- `src/components/InsightBanner.tsx` (CREATE)
- `src/app/page.tsx` (MODIFY — render TodayCard + InsightBanner + QuickLogBar)

**Subtasks:**
- [ ] `src/lib/day-window.ts`:
  - `getDayWindow(now: Date, tz: string, dayStartHour: number): { start: Date; end: Date }` — given an instant, return the [4am local → 4am next-day local] interval as UTC `Date`s. Use `date-fns-tz`'s `zonedTimeToUtc`/`utcToZonedTime`.
  - `dayNumberSinceBirth(now: Date, dob: Date, tz: string, dayStartHour: number): number` — used by targets.
- [ ] `src/lib/targets.ts`:
  - `nursingRateOzPerMin(ageDays: number): number` — `<7d:0.10, 7–30d:0.15, 30–60d:0.20, 60+:0.25` (PLAN.md §"Daily Target & Nursing-Minutes Estimation")
  - `estimateNursingOz(durationMin: number, ageDays: number): number`
  - `dailyTargetRange({ ageDays, currentWeightOz, birthWeightOz }): { lowOz: number; highOz: number }` per the same section: ramp formula for days 1–6, `2.0–2.5 oz/lb` for day 7+, estimated weight = `birthWeightOz + (ageDays - 14) * 1 oz/day` after day 14 if `currentWeightOz` is null, cap at 32 oz/day
- [ ] `src/lib/day-window.test.ts` — Vitest. **DST is the highest-priority test in the project** (Risk R2):
  - America/Chicago fall-back 2026-11-01 03:00 local: the day window for that moment must span the duplicated 01:00–02:00 window correctly
  - America/Chicago spring-forward 2027-03-08 03:00 local: window correctly skips the 02:00–03:00 gap
  - 4am rollover: at 03:59am local on day N, window starts at 04:00 of day N-1; at 04:00am local, window starts at 04:00 of day N
  - With `dayStartHour=4` and `tz='America/Chicago'`, an event logged at 03:30 local counts as the *previous* day
- [ ] `src/lib/targets.test.ts` — Vitest:
  - Day 1: target band saturates at the day-num ramp
  - Day 7 with weight 7.0 lb: low=14.0, high=17.5
  - Day 30 with weight 10 lb: high capped at 25.0 (still under 32)
  - Day 60 with weight 16 lb: high capped at 32.0
  - `estimateNursingOz(20, 14) === 3.0`
- [ ] `src/app/api/summary/route.ts`: GET endpoint that (within `withUserContext`) returns the today rollup for the active baby:
  ```ts
  {
    day_start: ISO8601, day_end: ISO8601,
    feeds: { total_oz, nursing_oz, pumped_oz, formula_oz, wasted_oz, count, last_at },
    diapers: { pee_count, poop_count, last_at },
    target: { low_oz, high_oz, age_days, weight_oz },
    last_feed_minutes_ago: number | null,
  }
  ```
  Computed via raw SQL or Drizzle over `feed_events`/`diaper_events` filtered by the day window from `lib/day-window.ts` and grouped by `kind`.
- [ ] `src/components/TodayCard.tsx` (server component): takes the summary object, renders the differentiator screen. Layout (mobile-first):
  - Big number: `{total_oz} oz today`
  - Sub-line: `target {low}–{high} oz · {age_days}d old · {weight_oz} oz`
  - Donut placeholder (`IntakeDonut` lands in Phase 2; for now a stacked horizontal bar of nursing/pumped/formula is fine — keep the file simple)
  - Two stats: `{pee_count} wet · {poop_count} dirty`
  - "Last fed {N} min ago" line
  - A muted "Not medical advice" disclaimer footer
- [ ] `src/lib/insights.ts`: pure function `computeInsights(summary, baby, now): Insight[]` that returns zero-or-more *informational* signals derived from the day's data and WHO/AAP-aligned newborn norms. **Tone is informational, never alarmist or preachy. Never "wrong" — always "worth a glance" or "for your awareness". Always paired with "Not medical advice."** Signals to compute:
  1. **Low intake.** If `now` is past `hour 18:00` local AND `today_oz < target_low_oz`: `{ severity: 'info', kind: 'low_intake', text: "Today's running below the {low}-{high} oz range. {target_low - today_oz} oz to go." }`. Suppressed before 6pm to avoid mid-day false alarms.
  2. **Low pee count.** Expected pee threshold from PLAN.md: `day_num` wet diapers for days 1–5, `6+` for day 6 onward. If `now > 20:00 local` AND `pee_count < expected_low`: `{ severity: 'info', kind: 'low_pee', text: "{pee_count} wet diapers logged today so far. Healthy newborns usually have {expected_low}+ by end of day." }`.
  3. **High formula share.** If total `feed_oz > 0` AND `formula_oz / total_feed_oz > 0.66` for the day AND `pumped_oz + nursing_oz > 0` (i.e. it's not a formula-only day on purpose): `{ severity: 'info', kind: 'formula_share', text: "{formula_pct}% of today's feeds were formula. Heads up — useful context, not a problem on its own." }`. Threshold tunable later; never block, never warn.
  4. **No feed in 4+ hours during daytime.** If `now` is between 08:00 and 22:00 local AND `last_feed_minutes_ago > 240`: `{ severity: 'info', kind: 'long_gap', text: "It's been {hours}h since the last logged feed." }`. (Helps the night-shift caregiver who just woke up.)
  5. **No diaper in 6+ hours during daytime.** Same time window, `now - last_diaper_at > 360min`: `{ severity: 'info', kind: 'long_diaper_gap', text: "{hours}h since the last logged diaper." }`.
  Every insight returns a stable `kind` so the UI can dedupe and dismiss. Insights are derived live — no DB table, no state. Re-computed every render.
- [ ] `src/lib/insights.test.ts` (Vitest): one test per signal — a fixture that triggers it, a fixture that doesn't (boundary on either side). Cover the time-of-day gates explicitly.
- [ ] `src/components/InsightBanner.tsx` (server component, no client JS): takes `Insight[]`, renders zero-or-more small cards stacked under the TodayCard. Visual treatment: muted background (Tailwind `bg-amber-50` for `severity: 'info'`), small icon, 2-line max text, no close button (the signal goes away on its own when the data shifts). Each card ends with a tiny `Not medical advice. Call your pediatrician if you're worried.` line. If `Insight[]` is empty, render nothing (don't show "All good!" — that's preachy).
- [ ] `src/app/page.tsx`: server component — call `withAuth`, redirect to `/onboarding` if no session. Fetch summary via direct DB call (not HTTP). Render `<TodayCard summary={...} />`, then `<InsightBanner insights={computeInsights(summary, baby, new Date())} />`, then `<QuickLogBar />`.

**Details:**
- Time zone defaults: `America/Chicago`, `day_start_hour = 4`. Read from `households` row.
- `last_feed_minutes_ago` uses `Date.now()` at render time — that means the value is stale by the time the user sees it, but it refreshes on every navigation. Real-time updates come in Phase 2 via Realtime.
- **Insight tone is non-negotiable.** Never use the words "alert", "warning", "wrong", "problem". Never red color. Use `bg-amber-50` for the muted-info treatment. Always end with the "Not medical advice. Call your pediatrician if you're worried." line. The product position is "informational, with judgment left to the parent" — see PLAN.md §"What Moms Actually Say They Want": moms hate preachy apps. WHO/AAP newborn norms (8–12 feeds/day, expected wet diaper counts) inform the *thresholds*, not the *language*.
- Insights show on the dashboard only. NO popups, NO modals, NO push notifications, NO email, NO toast on insight appearance. The signal is part of the dashboard's quiet glance.

**Depends on:** Task 3 (forms need to be working so there's data to summarize, but more importantly recordEvent in Task 3 should call `targets.ts` for `estimated_oz` — Task 3 left a stub or imported the helper; either way Task 4 finalizes the math).

**Definition of Done:**
- `pnpm test src/lib/day-window.test.ts`, `pnpm test src/lib/targets.test.ts`, and `pnpm test src/lib/insights.test.ts` all pass, including the DST fixtures
- With a fresh seeded DB and one nursing feed logged via FeedForm, `/` renders TodayCard with the correct estimated oz, the correct target band for a 19-day-old at 109 oz birth weight (band ≈ 14–18 oz), and "last fed ~Xmin ago"
- Crossing 04:00 local (manually adjust an event's `occurred_at` to 03:30 local) → that event does NOT count toward today's total
- `/api/summary` returns a well-typed JSON object matching the spec above
- **Insight banner smoke (manual, in both Chrome and Safari):**
  - Log nothing all day, set device clock to 8:30pm local → dashboard shows the low-intake insight AND the low-pee insight, both with the muted amber treatment + "Not medical advice" line
  - Log 6 wet diapers, set clock to 9pm → low-pee insight is gone
  - Log 4 oz formula and 0 oz breastmilk → formula-share insight does NOT show (it's a formula-only day, threshold conditioned on `pumped_oz + nursing_oz > 0`)
  - Log 4 oz formula + 1 oz pumped → formula-share insight shows ("80% formula today …")
  - Visual treatment is calm and informational; no red, no exclamation marks, no modals appear at any point

## Testing Strategy

### Test 1: `day-window.test.ts` (highest priority — Risk R2)

**File:** `src/lib/day-window.test.ts` (create)

- [ ] America/Chicago fall-back (2026-11-01 01:30 local CDT *and* the duplicate 01:30 local CST) both resolve to the same day window
- [ ] America/Chicago spring-forward (2027-03-08 02:30 local does not exist) — input at 03:30 local CDT resolves correctly
- [ ] 4am rollover: 03:59 local → previous day window; 04:00 local → new day window
- [ ] Day-number-since-birth across a DST boundary is monotonic (no skipped or duplicated days)

**Approach:** unit, no DB

### Test 2: `targets.test.ts`

**File:** `src/lib/targets.test.ts` (create)

- [ ] Day 1, weight 109 oz: target band is the day-num ramp (0.5–1.0 oz × day_num × 8 feeds)
- [ ] Day 7, weight 7.0 lb: low=14.0, high=17.5
- [ ] Day 30, weight 10 lb: low=20.0, high=25.0
- [ ] Day 60, weight 16 lb: low=32.0, high=32.0 (capped)
- [ ] `nursingRateOzPerMin` returns 0.10/0.15/0.20/0.25 at the right age boundaries
- [ ] When `currentWeightOz` is null and age > 14 days, estimated weight = birthWeight + (age − 14) oz

**Approach:** unit, no DB

### Test 3: Manual smoke — RLS isolation (Risk R1, security checklist)

Not automated in Phase 1, but document in the README:

- [ ] Open `psql` against the Supabase dev DB with the anon role (no `SET LOCAL request.user_id`) → `SELECT count(*) FROM feed_events;` returns 0
- [ ] With `SET LOCAL request.user_id = '<aradhna_uuid>'` → returns the actual count

## Validation Commands

Run these in order after all tasks complete:

```bash
# Linting
pnpm lint

# Type checking
pnpm typecheck

# Tests
pnpm test

# Build verification
pnpm build

# Migration sanity (against a throwaway Supabase project or local Postgres)
pnpm db:migrate
pnpm db:seed
```

Manual smoke (per PLAN.md §"Verification — After Week 1"):

```bash
pnpm dev
# Run the full smoke flow in BOTH:
#   (a) desktop Chrome (latest), and
#   (b) iPhone Safari (or desktop Safari with iPhone responsive mode).
# Repeat in Chrome on Android (or Chrome DevTools device emulation) before closing the phase.
#
# 1. Visit http://localhost:3000 → redirected to /onboarding
# 2. Submit onboarding form → recovery code card → "I've saved it" → /
# 3. /log/feed → log a nursing feed 10 min left → /api/feeds 200 → redirect to /
# 4. TodayCard shows ~1.5 oz total, target band 14–18 oz
# 5. /log/diaper → tap both Wet+Dirty → /api/diapers 200
# 6. TodayCard shows 1 wet, 1 dirty
# 7. Log a wasted_oz pumped event → counts in wasted column, not in target total
#
# Each browser must complete the flow with no console errors and visually consistent layout.
```

## Integration Notes

- **Connects to Phase 2:** The canonical `recordEvent` + `/api/events` is built here, so Phase 2 Task 2 only needs to (a) populate the bearer-token path in `withAuth` and (b) author the Siri Shortcut files that POST to `/api/events`. The route handler does not change.
- **Connects to Phase 3:** TodayCard is server-rendered. Phase 2 adds Realtime → `router.refresh()` re-runs the server component. No client refactor needed.
- **Breaking changes:** NONE — greenfield project.
- **Documentation updates:** `README.md` is created in Task 1; keep it current as decisions firm up.
- **Things NOT done in Phase 1 (call out so a reviewer doesn't ask):**
  - No invite acceptance flow (`/i/[token]`) — Phase 2
  - No `/settings/*` pages — Phase 2 (caregivers, voice) and Phase 3 (general settings)
  - No Realtime — Phase 2
  - No PDF export — Phase 2
  - No PWA manifest / service worker — Phase 3
  - No offline queue, no informational alerts banners, no growth chart, no mom tab — Phase 3
  - `event_audit` table is created in the migration but no code writes to it until Phase 2 Task 1
  - `withAuth` bearer path is a stub returning null; real implementation is Phase 2 Task 2
