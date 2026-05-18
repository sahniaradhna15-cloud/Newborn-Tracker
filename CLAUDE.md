---
description: Project-specific development rules for Newborn Tracker
alwaysApply: true
---

# Newborn Tracker — Project Rules

> **Note on document hierarchy.** For *what* and *why*, read `PLAN.md`. For *how* (architecture, contracts, ops), read `TECHNICAL_SPEC.md`. For *user stories + acceptance bars*, read `PRD.md`. For *per-phase implementation*, read `plans/phase-N-*.md`. This file is the always-on coding contract. If this file conflicts with PLAN/SPEC/PRD on a fact (DOB, weight, locked-in decisions), PLAN/SPEC win. If it conflicts on a coding convention, this file wins.

---

## 1. Project overview

A **PWA** that lets a new mother, her partner, and (later) caregivers log feeds, diapers, weights, and postpartum-mom events for a single baby — with a dashboard that answers *"is baby getting enough today?"* using age-adjusted intake targets — plus iOS Siri Shortcuts for hands-free voice logging. Multi-caregiver from day one, each with their own session, no shared logins. Free forever in Phase 1. Built by the user for her own use first; designed to generalize to other families later.

- **Phase 1** — core logging + intake intelligence + cross-browser PWA UI
- **Phase 2** — multi-caregiver invites + Siri voice + Realtime + pediatrician PDF
- **Phase 3** — installable PWA, offline queue, WHO growth chart, postpartum mom tab

---

## 2. Tech stack — resolved choices

These are decided. Do not introduce alternatives without an explicit user-facing tradeoff discussion.

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node.js 20 LTS | Vercel default |
| Framework | **Next.js 16** (App Router) + React 19 + TypeScript 5.5+ (`strict: true`) | RSC for first paint; client components only where interactivity is needed. Phase 1 scaffolded on Next 16.2; older PLAN.md / TECHNICAL_SPEC.md references to "Next 15.x" are superseded. |
| Database | **Supabase** Postgres (free tier) | RLS enforced; Realtime via Postgres replication; do **not** use Neon despite stale references in older PLAN.md sections |
| ORM | Drizzle | Type-safe queries; migrations are hand-authored SQL because Drizzle does not emit RLS policies |
| DB driver | `postgres` (postgres-js) | Drizzle-recommended for Supabase pooled connections (port 6543); session-mode (port 5432) for migrations only |
| Auth | **Custom invite-link sessions** | No NextAuth, no email/Resend, no OAuth, no passwords. 1-year HttpOnly cookies, sha256-hashed tokens |
| Validation | Zod | Same schema validates HTTP body, Drizzle insert, and Siri payload |
| UI | **Tailwind CSS 4** + shadcn/ui | Mobile-first; default dark-mode follows iOS system setting. Tailwind 4 uses CSS-first config (`@theme` block in `globals.css`); no `tailwind.config.ts` file. shadcn's Tailwind 4 path is the supported setup. |
| Forms | react-hook-form + `@hookform/resolvers/zod` | Zod schema shared with the wire |
| Charts | Recharts (Phase 2+) | Donut, stacked bar, growth-curve overlay |
| Date math | `date-fns-tz` | DST-safe America/Chicago handling |
| PWA | `@serwist/next` (Phase 3) | Workbox fork for App Router |
| PDF | `@react-pdf/renderer` (Phase 2) | Pediatrician export only |
| Testing | Vitest (unit); manual + agent-driven E2E in Phase 1 | No Playwright in Phase 1; add only if a regression demands it |
| Errors | Sentry (free tier) | `@sentry/nextjs`; tag every event with `household_id`, never PII |

**Explicitly NOT in the stack** (and why):
- NextAuth / Auth.js — we have no email / OAuth path
- Prisma — Drizzle's bundle size matters on Vercel
- Redis — no cache need at this scale; rate-limiting is Postgres-backed
- Inngest — scaffolded `event_outbox` only; no consumer until there's a real job
- `next-pwa` — superseded by `@serwist/next`
- `@neondatabase/serverless` — Supabase is the decision; ignore lingering Neon refs in older docs
- Any analytics SDK (GA, Mixpanel, Segment) — privacy promise; **do not add**

---

## 3. Architecture

```
/Users/aradhnasahni/Documents/Coding/Pregnancy Journal/
├── PLAN.md, TECHNICAL_SPEC.md, PRD.md   # planning artifacts (do not delete)
├── plans/phase-N-*.md                    # per-phase implementation plans
├── shortcuts/*.shortcut.md               # Siri Shortcut recipes (Phase 2)
├── src/
│   ├── app/                              # Next.js App Router
│   │   ├── (app)/                        # auth-required group
│   │   ├── api/                          # route handlers
│   │   ├── i/[token]/                    # invite-accept landing
│   │   ├── recover/                      # recovery-code redemption
│   │   ├── onboarding/                   # first-visit flow
│   │   ├── layout.tsx, page.tsx          # root + dashboard
│   │   ├── manifest.ts, sw.ts            # Phase 3 PWA
│   ├── components/                       # UI components (no business logic)
│   ├── lib/
│   │   ├── db/                           # schema, client, admin, migrations, seed
│   │   ├── record-event.ts               # THE service function — every write goes through this
│   │   ├── voice-parser.ts               # Zod InboundEvent
│   │   ├── targets.ts, day-window.ts     # intake math; tests required
│   │   ├── insights.ts                   # WHO-aligned dashboard signals
│   │   ├── who-growth.ts                 # WHO LMS reference data (Phase 3)
│   │   ├── session.ts, api-token.ts      # auth helpers
│   │   ├── with-auth.ts, with-user-context.ts  # request scoping + RLS
│   │   ├── audit.ts, outbox.ts           # cross-cutting
│   │   ├── offline-queue.ts              # IndexedDB queue (Phase 3)
│   ├── middleware.ts                     # CSRF + Origin + session resolve
├── public/icons/                         # PWA icons (Phase 3)
└── drizzle.config.ts, next.config.ts, tailwind.config.ts, package.json, .env.example
```

### Load-bearing architecture rules

1. **`recordEvent(ctx, inbound)` is the single write path.** Every HTTP route (`/api/events`, `/api/feeds`, `/api/diapers`, `/api/voice`, future Alexa/WhatsApp adapters) translates its input into an `InboundEvent` and calls one function. Do **not** INSERT directly into `feed_events` / `diaper_events` / `mom_events` from a route handler. PATCH/DELETE on a specific row may bypass `recordEvent` but must set `locked_at` so the merge window skips it, and must call `writeAudit`.
2. **RLS is enforced by Postgres, not the app.** Every Drizzle query against an app table must run inside a `withUserContext(userId, fn)` transaction that issues `SET LOCAL request.user_id = '<uuid>'`. Bypassing this is a P0 bug. `SUPABASE_SERVICE_ROLE_KEY` is referenced in **exactly two files**: `src/lib/db/admin.ts` and `src/app/api/onboarding/create-household/route.ts`. Adding a third requires explicit user discussion.
3. **TodayCard is a React Server Component.** First paint on mobile 4G must be a single round-trip. Client components are the exception (forms, optimistic UI, Realtime subscription, install prompt).
4. **Realtime triggers `router.refresh()`** — server components re-fetch. The browser does not maintain a client-side cache of feed/diaper rows.
5. **`client_uuid` is the idempotency key.** Generate it on the client before submit. Server enforces `(source, client_uuid) UNIQUE` on `inbound_events`. Replay is always safe.

---

## 4. Domain model

The data model **is** the product. All tables live in `src/lib/db/schema.ts` and the initial migration (Drizzle-generated `0000_*.sql` with the hand-authored RLS block appended; older docs call this `0001_initial.sql` — same artifact, the drizzle-kit tag won). RLS policies are part of that migration.

**Core entities (read PLAN.md §"Data Model" + TECHNICAL_SPEC §3 for full DDL):**

```ts
// Auth
users            { id, display_name, created_at }
sessions         { id, user_id, token_hash, device_label, expires_at, last_seen_at }
recovery_codes   { id, user_id, household_id, code_hash, rotated_at, used_at, used_from_ip }

// Household scope
households         { id, name, day_start_hour, timezone, created_at }
household_members  { household_id, user_id, role: 'owner' | 'caregiver', display_name }
invites            { id, household_id, token_hash, role, display_name, target_user_id?,
                     expires_at, accepted_at, accepted_by, created_by, created_at }
api_tokens         { id, user_id, household_id, token_hash, label, last_used_at, revoked_at }

// Baby + events
babies        { id, household_id, name, birth_date, birth_weight_oz, current_weight_oz, weight_updated_at }
weight_events { id, baby_id, occurred_at, weight_oz, note, source, logged_by }
feed_events   { id, baby_id, logged_by, occurred_at,
                kind: 'nursing' | 'pumped' | 'formula',
                side?, duration_min?, volume_oz?, wasted_oz?,
                estimated_oz,                            -- computed on insert; daily totals sum this
                note, source, client_uuid UNIQUE,
                corroborating_sources jsonb, locked_at }
diaper_events { id, baby_id, logged_by, occurred_at, pee, poop, note, source, client_uuid UNIQUE }
mom_events    { id, user_id, household_id, occurred_at,
                kind: 'medication' | 'mood' | 'note' | 'pump_only',
                payload jsonb, source, client_uuid UNIQUE }

// Cross-cutting
inbound_events  { source, client_uuid UNIQUE, household_id, user_id, raw,
                  resulting_event_id, resulting_table, status, error, received_at }
event_outbox    { id, topic, payload, processed_at, failed_at, attempts, created_at }
event_audit     { id, actor_user_id, household_id, kind, entity_table, entity_id,
                  before jsonb, after jsonb, ip, created_at }
```

**Locked-in seed (do not change without user confirmation):**

- Baby: **Anay Srivastava**, DOB **2026-04-23**, birth weight **109 oz** (6 lb 13 oz)
- Owner: **"Mom" (Aradhna Sahni)**; pre-invited caregiver: **"Dad" (Ashesh Srivastava)**
- Household: **"My Family"**
- Timezone: **America/Chicago**; day-start hour: **4** (4am rollover)

---

## 5. API contracts

### 5.1 The canonical `InboundEvent` (Zod)

Defined in `src/lib/voice-parser.ts`. Every integration converges on this shape.

```ts
type InboundEvent = {
  client_uuid: string;                          // UUID v4
  source: 'pwa' | 'siri_shortcut' | 'apple_watch' | 'web' | 'health_bridge';
  source_event_id?: string;
  occurred_at: string;                          // ISO 8601
  baby_id?: string;                             // resolved server-side if absent
  event:
    | { type: 'feed'; kind: 'nursing'; side: 'left' | 'right' | 'both'; duration_min: number }
    | { type: 'feed'; kind: 'pumped' | 'formula'; volume_oz: number; wasted_oz?: number }
    | { type: 'diaper'; pee: boolean; poop: boolean }   // refined: at least one true
    | { type: 'mom'; kind: 'medication' | 'mood' | 'note' | 'pump_only'; payload: Record<string, unknown> };
  raw?: Record<string, unknown>;
  note?: string;
};
```

### 5.2 `AuthContext` + `recordEvent`

```ts
type AuthContext = {
  user_id: string;
  household_id: string;
  source: InboundEvent['source'];
  auth_method: 'session' | 'bearer';
};

type RecordResult =
  | { status: 'accepted'; event_id: string; say: string }
  | { status: 'duplicate'; event_id: string; say: string }
  | { status: 'merged'; event_id: string; say: string };

async function recordEvent(ctx: AuthContext, inbound: InboundEvent): Promise<RecordResult>;
```

### 5.3 Response shape

Success: `{ ok: true, event_id, say }` where `say` is the Siri-readable readout (always present).
Error: `{ ok: false, error: "<code>", details?, say: "Sorry, that didn't work." }` — `say` always present so Siri can read something useful.

### 5.4 Route inventory

See `TECHNICAL_SPEC.md §5.3` for the complete table. The canonical entry points:
- `POST /api/events` (bearer) — Siri, Watch, future channels
- `POST /api/feeds`, `/api/diapers`, `/api/weights`, `/api/mom-events` (session) — PWA CRUD; each calls `recordEvent`
- `POST /api/voice` (bearer) — legacy adapter into `/api/events`

---

## 6. Cross-browser support

**Phase 1 logging works in modern Chrome (desktop + Android), Safari (macOS + iOS), Edge, and Firefox.** Only the Siri Shortcuts integration in Phase 2 is iPhone-only.

- Browserslist target in `package.json`: `last 2 Chrome versions`, `last 2 Safari versions`, `last 2 Edge versions`, `last 2 Firefox versions`, `last 2 iOS versions`, `last 2 ChromeAndroid versions`
- Do not use Safari-only or Chrome-only Web APIs without explicit cross-browser fallback
- Verified safe to use: `crypto.randomUUID()`, `fetch`, `IndexedDB`, service workers (Phase 3), standard CSS / HTML5 forms
- Manual cross-browser smoke is part of every Phase 1 task DoD

---

## 7. Project-specific naming conventions

| Layer | Convention | Example |
|---|---|---|
| DB columns | `snake_case` | `current_weight_oz`, `logged_by`, `occurred_at`, `client_uuid` |
| DB tables | `snake_case`, plural | `feed_events`, `household_members` |
| TS types / interfaces | `PascalCase` | `InboundEvent`, `AuthContext`, `Insight` |
| TS functions / vars | `camelCase`, **verbose** | `recordEvent`, `dailyTargetRange`, `nursingRateOzPerMin` |
| TS booleans | predicate-style verbose | `hasOutstandingInvite`, `isFormulaShareHigh`, `shouldRevokePriorSessions` |
| Constants | `SCREAMING_SNAKE_CASE` | `DAY_START_HOUR_DEFAULT`, `RECOVERY_CODE_LENGTH` |
| Outbox topics | dotted past-tense | `event.feed.recorded`, `goal.daily_feeds.reached`, `household.caregiver.joined` |
| Audit kinds | dotted past-tense | `feed.created`, `access_link.redeemed`, `recovery_code.rotated`, `ownership.transferred` |
| Insight kinds | `snake_case` | `low_intake`, `low_pee`, `formula_share`, `long_gap`, `offline_queue_pending` |
| Files | kebab-case | `src/lib/record-event.ts`, `src/components/TodayCard.tsx` (components are PascalCase) |
| Branches | `phase-N-task-N-short-slug` | `phase-1-task-2-schema-rls` |
| Migrations | `NNNN_lowercase_snake.sql` | `0001_initial.sql`, `0002_rate_limits.sql` — never edit a merged migration |

**Verbose naming:** prefer `estimatedOuncesPerMinute` over `epm`; `withholdRevocationForAdditiveLink` over `keepSessions`. Optimize for the reader two months from now.

---

## 8. Environment variables

Required, named exactly as listed. Document in `.env.example`; never commit `.env.local`.

```bash
# Public (safe to expose to client)
NEXT_PUBLIC_APP_URL=http://localhost:3000          # prod: https://<domain-tbd>
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# Server-only
DATABASE_URL=postgres://app_runtime...pooled:6543/postgres?pgbouncer=true   # runtime, RLS-enforced; non-owner app_runtime role — NEVER postgres
DATABASE_URL_DIRECT=postgres://postgres...:5432/postgres                     # migrations + seed only
DATABASE_URL_ADMIN=postgres://postgres...pooled:6543/postgres?pgbouncer=true # onboarding bypass only (src/lib/db/admin.ts)
SUPABASE_SERVICE_ROLE_KEY=eyJ...                   # bypasses RLS; allowed in 2 files only
SENTRY_DSN=https://...
SENTRY_AUTH_TOKEN=...
```

The Supabase service role key bypasses RLS. Only `src/lib/db/admin.ts` and `src/app/api/onboarding/create-household/route.ts` may reference it. All other code paths use `SET LOCAL request.user_id` via `withUserContext`.

**RLS enforcement model (load-bearing — read before touching DB connection config).** RLS is `ENABLE`d, not `FORCE`d, and the Supabase `postgres` role both owns every table and has `BYPASSRLS=true`. Enforcement therefore depends entirely on the runtime connecting as the non-owner `app_runtime` role (LOGIN, NOBYPASSRLS). Pointing `DATABASE_URL` at `postgres` silently disables every policy with no error. The `app_runtime` role + its GRANTs are created out-of-band against the live DB (Supabase `postgres` cannot `ALTER ROLE`); the exact SQL is in `.env.example`. `admin.ts` uses `DATABASE_URL_ADMIN` (the `postgres` role) because `app_runtime` deliberately cannot `SET ROLE service_role`.

---

## 9. Development commands

Run from project root. Package manager is **pnpm**.

```bash
# Install
pnpm install

# Dev
pnpm dev                  # http://localhost:3000

# Quality gates (run before every commit / PR)
pnpm typecheck            # tsc --noEmit
pnpm lint                 # ESLint (Next.js default; extend with stricter rules over time)
pnpm test                 # Vitest unit suite
pnpm build                # production build sanity

# Database
pnpm db:generate          # drizzle-kit generate (DDL only — RLS policies hand-written)
pnpm db:migrate           # apply pending SQL migrations from src/lib/db/migrations/
pnpm db:seed              # idempotent seed for local dev (Aradhna + Anay)

# One-off
pnpm test src/lib/day-window.test.ts        # the highest-priority test in the project (DST fixtures)
```

---

## 10. Core development principles (non-negotiable)

These apply project-wide. Most reviews bounce on violations of these — internalize them.

### 10.1 TypeScript strict, never `any`

- `strict: true` in `tsconfig.json` is enforced. Use `unknown` and narrow with type guards, never `any`.
- Discriminated unions for variant data (e.g., `InboundEvent.event.type`). Pattern-match exhaustively.
- Prefer Zod-inferred types (`z.infer<typeof Schema>`) over hand-rolled types when a schema exists.

### 10.2 Verbose naming

- Function and variable names read like sentences: `estimateOuncesFromNursingMinutes`, `revokePriorSessionsIfOwnerIssuedLink`.
- Boolean predicates start with `is`, `has`, `should`, `can`, `did`. Inverse predicates exist if both the affirmative and negative are used (`isOffline` and `isOnline`, not just one).
- Avoid abbreviations except for industry-standard ones (`id`, `url`, `oz`, `lb`).

### 10.3 Structured JSON logging with `fix_suggestion`

Every `/api/*` route handler logs a single structured line per request. Every caught error logs a `fix_suggestion` field that tells the next operator what to check.

```ts
log.info({
  event: 'record_event',
  status: 'accepted',
  route: '/api/events',
  method: 'POST',
  user_id: ctx.user_id,
  household_id: ctx.household_id,
  source: ctx.source,
  duration_ms: 87,
});

log.error({
  event: 'record_event_failed',
  error: error.message,
  stack: error.stack,
  user_id: ctx.user_id,
  fix_suggestion: 'Check that withUserContext is called before this query; RLS will reject SELECTs without request.user_id GUC.',
});
```

No `console.log` in committed code (allowed during local debugging; strip before commit). No PII in logs ever — names, codes, tokens, raw bodies all stripped.

### 10.4 JSDoc for non-obvious functions

- `recordEvent`, `withUserContext`, `withAuth`, `dailyTargetRange`, `getDayWindow`, `weightPercentile`, the `acceptInvite` transaction — each gets a JSDoc block stating the invariant, parameters with units, return values, and any side effects (cookie set, audit row written, etc.).
- Trivial helpers (one-line utilities, pure formatters) do not need JSDoc — the verbose name carries the meaning.

### 10.5 Linting / formatting

- ESLint (Next.js default) plus Prettier with these settings: `printWidth: 120`, `singleQuote: false` (double quotes), `trailingComma: "all"`, `semi: true`, `arrowParens: "always"`.
- Run `pnpm lint` and `pnpm typecheck` before every commit. CI blocks on either.

### 10.6 Easy debugging

- **Flat structures over deep nesting.** Early-return on validation failures; avoid pyramid `if` chains.
- **Async/await over `.then()` chains.** A single `await` line is debuggable; a Promise chain is not.
- **Pattern-match on discriminators.** `switch (event.type) { case 'feed': ... case 'diaper': ... }` with an exhaustive default that throws. No nested ternaries.
- **One return path per pure function** where it makes sense, but never at the cost of an unguarded edge case. Readability > dogma.
- **Comments are for WHY, not WHAT.** Default to writing no comments. Only add one when the *why* is non-obvious (a hidden constraint, a workaround, an asymmetric authority invariant). Never narrate the code.

---

## 11. Common patterns

### 11.1 RLS-bound DB query

```ts
import { withUserContext } from "@/lib/with-user-context";
import { feedEvents } from "@/lib/db/schema";

export async function listTodaysFeeds(userId: string, babyId: string, dayWindow: { start: Date; end: Date }) {
  return withUserContext(userId, async (tx) =>
    tx
      .select()
      .from(feedEvents)
      .where(/* baby_id = $1 AND occurred_at BETWEEN start AND end */)
  );
}
```

### 11.2 Route handler skeleton

```ts
import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/with-auth";
import { recordEvent } from "@/lib/record-event";
import { InboundEvent } from "@/lib/voice-parser";

export async function POST(req: NextRequest) {
  const ctx = await withAuth(req);
  if (!ctx) {
    return NextResponse.json(
      { ok: false, error: "unauthorized", say: "Sorry, that didn't work." },
      { status: 401 },
    );
  }

  const parsed = InboundEvent.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "validation_failed", details: parsed.error.issues, say: "Sorry, that didn't work." },
      { status: 400 },
    );
  }

  const result = await recordEvent(ctx, parsed.data);
  return NextResponse.json({ ok: true, event_id: result.event_id, say: result.say });
}
```

### 11.3 Insight-banner messaging tone (non-negotiable)

When surfacing WHO-aligned signals on the dashboard:

- **Never** use the words: "alert", "warning", "error", "wrong", "problem", "bad", "concerning".
- **Never** use red. Use Tailwind `bg-amber-50` for muted info; `bg-stone-50` for purely neutral status.
- **Always** end with: *"Not medical advice. Call your pediatrician if you're worried."*
- **Always** time-gate: low-intake banner suppresses before 18:00; low-pee suppresses before 20:00. Avoid mid-day false alarms.
- **Never** show a popup, modal, toast, push, or email for these signals. Inline-dashboard-only.
- The formula-share insight is conditioned on `pumped_oz + nursing_oz > 0` so an intentionally formula-only family is not nagged.

### 11.4 Audit on every mutation

```ts
import { writeAudit } from "@/lib/audit";

await writeAudit(tx, {
  actor_user_id: ctx.user_id,
  household_id: ctx.household_id,
  kind: "feed.created",
  entity_table: "feed_events",
  entity_id: insertedRow.id,
  before: null,
  after: insertedRow,
});
```

PATCH writes `{ before: previousRow, after: nextRow }`. DELETE writes `{ before: previousRow, after: null }`.

### 11.5 Asymmetric authority for peer-recovery links

The rule from `TECHNICAL_SPEC §4.5.1` reduces to one expression:

```ts
const shouldRevokePriorSessions =
  issuer.role === "owner" || issuer.user_id === target.user_id;
```

A caregiver-issued link to *any* member is **additive only**. Only the owner — or a user re-linking themselves — revokes prior sessions. This invariant prevents hostile lockout and is covered by an integration test.

---

## 12. Testing strategy

Per `TECHNICAL_SPEC §12`. Phase-1 unit tests are mandatory for the math layer; integration tests are mandatory for the security-critical paths.

| Layer | Tool | What to test | Required |
|---|---|---|---|
| Unit | Vitest | `targets.ts`, `day-window.ts`, `insights.ts`, `who-growth.ts`, Zod schemas in `voice-parser.ts` | **High coverage on these five** — they are the math of the product |
| Integration | Vitest + real Postgres (Supabase dev project or Docker) | RLS isolation between two households; `/api/events` idempotency; peer-recovery asymmetric authority; recovery-code redeem flow | One happy path + one isolation test per security-critical endpoint |
| Manual | Real iPhone + desktop Chrome + desktop Safari | "Add to Home Screen", standalone mode, airplane-mode + reconnect, "Hey Siri, log a pee" | Required before sharing the domain |

**`day-window.test.ts` DST fixtures are P0** (Risk R2 in TECHNICAL_SPEC §13): 2026-11-01 fall-back and 2027-03-08 spring-forward are explicit test cases. A bug here corrupts every number on the dashboard.

**RLS isolation test is P0** (Risk R1): an integration test signs in as User A, asserts a SELECT cannot see User B's `feed_events` or `mom_events`. Required green before any Phase 2 work.

---

## 13. Security & privacy non-negotiables

These are checklist items, not aspirations. Every PR is reviewed against them.

- RLS enabled on every app table. App code may only query app tables through `withUserContext`.
- Session cookies are `HttpOnly`, `Secure` (in prod), `SameSite=Lax`, host-only, name `nt_session`.
- Every state-changing route requires `X-Requested-With: fetch` AND a same-origin `Origin` header. Bearer-token routes are exempted from the CSRF check.
- Invite, API, and recovery-code tokens are sha256-hashed at rest. Raw value shown to the user exactly once.
- Caregiver-issued peer-recovery links are **additive only** (see §11.5). An integration test verifies this.
- Rate limits: `/api/events` (per token), `/api/invites/[token]/accept`, `/api/access-links` (10/hour/user), `/api/recovery/redeem` (5/hour/IP + 24-hour soft block).
- `SUPABASE_SERVICE_ROLE_KEY` referenced in **exactly two files**. Adding a third requires explicit discussion with the user.
- No PII in URLs, error messages, log lines, or Sentry events. `household_id` is acceptable; display names, real names, tokens, codes are not.
- No third-party analytics (GA / Mixpanel / Segment / similar). Sentry is errors-only.
- `mom_events` is private from the partner via the `mom_events_self` RLS policy. UI also surfaces this on the `/mom` page footer.
- `.env.local`, `.env`, and any `*.shortcut` files containing tokens are in `.gitignore`.

---

## 14. What "done" looks like — Phase 1 exit criteria

Phase 1 is shippable when every box in `TECHNICAL_SPEC §14` is checked. The summary that matters day-to-day:

- Aradhna can log feeds (all three kinds) and diapers from her iPhone in Safari **and** from a Chrome browser.
- TodayCard answers "is baby getting enough today?" with target band, pee/poop count, time-since-last-feed.
- Ashesh can join via invite link and log independently on his own iPhone. No kickouts.
- Peer recovery works both ways with the asymmetric authority invariant honored.
- Recovery-code redemption works at `/recover`, auto-rotates the code on success.
- All six Siri Shortcuts create rows and Siri reads back the daily total + target.
- Pediatrician PDF renders correctly for the last 7 days.
- `/growth` plots Anay against WHO percentile curves with the current percentile in the header.
- Postpartum mom tab logs c-section meds, mood, notes — visible only to the author.
- PWA installs to Home Screen; offline queue replays after airplane-mode logs.
- DST-transition test in `day-window.test.ts` passes. RLS isolation integration test passes.

---

## 15. When in doubt

- For *what* and *why*: read `PLAN.md`.
- For *how* (architecture, contracts): read `TECHNICAL_SPEC.md`.
- For *user stories + acceptance bars*: read `PRD.md`.
- For *the specific task in front of you*: read `plans/phase-N-*.md`.
- For *a fact in conflict* (DOB, weight, locked-in decisions): PLAN/SPEC win.
- For *a convention in conflict*: this file wins.
- For *a question this file does not answer*: ask the user before guessing.
