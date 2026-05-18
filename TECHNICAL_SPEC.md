# Newborn Tracker — Technical Specification

> **Purpose.** This document is the engineering contract for the MVP described in [PLAN.md](./PLAN.md). PLAN.md answers *what* we're building and *why*. This document answers *how*: architecture, interfaces, infra, operational concerns, and the order in which to build them safely.
>
> **Audience.** A competent full-stack engineer (you, or a future contributor) should be able to implement Phase 1 from this document plus PLAN.md alone, with no other context.
>
> **Status.** v0.1 — drafted 2026-05-11, before any code is written. Update as decisions firm up.

---

## 0. TL;DR for the implementer

You are building a **Next.js 15 App Router PWA** backed by **Supabase Postgres + Realtime**, deployed on **Vercel**, with a **custom invite-link session auth** (no email, no OAuth) and a **canonical event-ingestion endpoint** that serves both the PWA and iOS Siri Shortcuts via bearer tokens.

Only three subsystems are load-bearing in Phase 1:

1. **`recordEvent()`** — the service function that every write goes through. Get this right and integrations are cheap forever.
2. **`TodayCard` + `targets.ts` + `day-window.ts`** — the "is baby getting enough?" answer. This is the product.
3. **Auth + RLS** — multi-caregiver sync where each device has its own session and Postgres enforces the household boundary. If a caregiver from another household can ever see this household's rows, the product is broken.

Everything else (Shortcuts, mom tab, offline queue, growth chart) is independently shippable on top of those three.

---

## 1. System architecture

```
┌─────────────────────┐        ┌─────────────────────┐
│  iPhone (PWA)       │        │  iPhone (Shortcuts) │
│  Safari → Home App  │        │  Siri voice         │
└──────────┬──────────┘        └──────────┬──────────┘
           │ HTTPS (cookie)               │ HTTPS (bearer)
           │ Supabase Realtime (WS)       │
           ▼                              ▼
┌─────────────────────────────────────────────────────┐
│  Vercel — Next.js 15 (App Router)                   │
│                                                     │
│   /app/(app)/...     ─── server components, RSC     │
│   /app/api/events    ─── canonical ingestion        │
│   /app/api/feeds     ─── PWA CRUD                   │
│   /app/api/...                                      │
│                                                     │
│   middleware.ts      ─── session cookie resolver    │
│   lib/with-auth.ts   ─── unified AuthContext        │
│   lib/record-event.ts ── THE service function       │
│   lib/outbox.ts      ─── transactional outbox       │
└──────────────────────┬──────────────────────────────┘
                       │ Postgres wire (Drizzle + @neondatabase/serverless
                       │   pooled driver via Supabase connection string)
                       ▼
┌─────────────────────────────────────────────────────┐
│  Supabase                                           │
│   • Postgres (RLS enforced)                         │
│   • Realtime (Postgres replication → WS)            │
│   • [DEFERRED: Storage, Auth, Edge Functions]       │
└─────────────────────────────────────────────────────┘
```

### Request paths

| Path | Auth | Latency budget | Notes |
|---|---|---|---|
| PWA page render (RSC) | session cookie | <500 ms p95 | Server components query DB directly via Drizzle. |
| PWA mutation (POST /api/feeds, /api/diapers) | session cookie + CSRF token | <300 ms p95 | Optimistic UI on the client. |
| Siri Shortcut POST /api/events | bearer token | <800 ms p95 (Siri reads the response aloud — slower hurts UX visibly) | Must be idempotent on `client_uuid`. |
| Realtime push | Supabase JWT (anon key, scoped) | <2 s end-to-end | Browser subscribes to `feed_events` and `diaper_events` filtered by `household_id`. |

### Why this shape

- **Server components do the heavy reads.** No client-side fetch on first paint; the TodayCard renders server-side with full DB access. iOS Safari over 4G appreciates this.
- **One canonical write path** (`recordEvent()`). Every HTTP route — PWA, Siri, future Alexa — translates its input into the same `InboundEvent` shape and calls one function. PLAN.md §"Integration Architecture" is non-negotiable; building it now is cheap, retrofitting is expensive.
- **Realtime instead of polling.** Free tier covers our volume (10s of events per day per household). Replaces the 5-second poll the original plan had.

---

## 2. Tech stack — concrete versions and the *why* per pick

| Layer | Choice | Version (pin in `package.json`) | Why this over the alternative |
|---|---|---|---|
| Runtime | Node.js | 20 LTS | Vercel default; matches Next.js 15 requirements. |
| Framework | Next.js | 15.x (App Router) | Server components let the dashboard render in one round-trip. |
| Language | TypeScript | 5.5+, `strict: true` | Non-negotiable for the discriminated-union event schema. |
| ORM | Drizzle | latest | Type-safe queries against the Zod schemas. Beats Prisma's generation step on edge functions. |
| DB driver | `@supabase/supabase-js` + `postgres-js` | latest | `postgres-js` is what Drizzle recommends for Supabase pooled connections. Do NOT use `@neondatabase/serverless` despite PLAN.md mentioning it — we moved to Supabase. |
| DB | Supabase Postgres | free tier | 500 MB / 50K MAU is ~100× what one household needs. |
| Realtime | Supabase Realtime | bundled | Postgres logical replication → WebSocket. No extra infra. |
| Validation | Zod | latest | Same schema validates HTTP body, Drizzle insert, and Siri payload. |
| UI | Tailwind + shadcn/ui | latest | Mobile-first defaults, no design bikeshedding. |
| Charts | Recharts | latest | Donut + stacked bar in one component each. |
| PWA | `@serwist/next` | latest | Maintained Workbox fork for App Router. |
| Forms | `react-hook-form` + Zod resolver | latest | Same Zod schema on the wire and in the form. |
| Date math | `date-fns-tz` | latest | Handles America/Chicago DST without Luxon's footprint. |
| Testing | Vitest (unit) + Playwright (e2e) | latest | Vitest matches Vite/Next ecosystem; Playwright handles iPhone Safari emulation. |
| Observability | Vercel logs + Sentry (free tier) | latest `@sentry/nextjs` | Error tracking only in Phase 1; no APM. |
| ~~PDF generation~~ | — | — | **Deferred to Phase 2** with the pediatrician export. Re-add `@react-pdf/renderer` when the renderer ships. |

**Explicitly NOT in the stack (and why):**
- ~~NextAuth / Auth.js~~ — we have no email and no OAuth provider. NextAuth is overhead for a 50-line custom session.
- ~~Prisma~~ — Drizzle's bundle size matters on Vercel functions.
- ~~Redis~~ — we have no cache need at this scale. Rate-limiting uses Postgres or Vercel's built-in.
- ~~Inngest~~ — scaffolded outbox table only. No consumer until there's a real job. Saves a service.

---

## 3. Data model — the canonical version

PLAN.md §"Data Model" is the source of truth for the *what*. This section captures the **deltas and additions** required for the chosen auth model and operational concerns.

### 3.1 Replace the Auth.js auth tables with these

```sql
users (
  id            uuid pk default gen_random_uuid(),
  display_name  text not null,           -- "Mom", "Dad", "Nanny Maria"
  created_at    timestamptz not null default now()
);

sessions (
  id            uuid pk default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  token_hash    text not null,           -- sha256(random 32 bytes, base64url)
  device_label  text,                    -- "Aradhna's iPhone"
  expires_at    timestamptz not null,    -- now() + 1 year
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now()
);
CREATE UNIQUE INDEX sessions_token_hash_idx ON sessions(token_hash);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);

invites (
  id              uuid pk default gen_random_uuid(),
  household_id    uuid not null references households(id) on delete cascade,
  token_hash      text not null,           -- sha256 of the URL token; URL has the raw token
  role            text not null default 'caregiver' check (role in ('owner','caregiver')),
  display_name    text,                    -- pre-filled by inviter; user can change on accept
  target_user_id  uuid references users(id), -- non-null = peer-recovery re-link (binds to existing user, no new row on accept)
  expires_at      timestamptz not null,    -- default now() + 7 days for new invites; now() + 24 hours for peer-recovery
  accepted_at     timestamptz,
  accepted_by     uuid references users(id),
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now()
);
CREATE UNIQUE INDEX invites_token_hash_idx ON invites(token_hash);
-- At most one outstanding peer-recovery invite per target at a time:
CREATE UNIQUE INDEX invites_active_target_idx ON invites(target_user_id)
  WHERE target_user_id IS NOT NULL AND accepted_at IS NULL;

-- Recovery codes for the solo-caregiver case (only member, lost device, no peer available).
-- Generated at household creation and rotatable from /settings. Human-printable.
recovery_codes (
  id            uuid pk default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  household_id  uuid not null references households(id) on delete cascade,
  code_hash     text not null,           -- sha256(raw code); raw code shown to user exactly once
  created_at    timestamptz not null default now(),
  rotated_at    timestamptz,             -- set when this code is superseded by a newer one
  used_at       timestamptz,             -- set on successful redemption; row stays for audit
  used_from_ip  text                     -- best-effort, for audit only
);
CREATE UNIQUE INDEX recovery_codes_code_hash_idx ON recovery_codes(code_hash);
-- At most one active (not rotated, not used) code per user:
CREATE UNIQUE INDEX recovery_codes_active_user_idx ON recovery_codes(user_id)
  WHERE rotated_at IS NULL AND used_at IS NULL;
```

**Drop from PLAN.md schema:** `accounts`, `verification_tokens` (Auth.js artifacts), and the `email` column on `invites`. Add `token_hash`, `accepted_by`, and `target_user_id` to `invites`. Add the new `recovery_codes` table.

**Recovery code format.** 16 characters from Crockford Base32 (`0123456789ABCDEFGHJKMNPQRSTVWXYZ` — no I/L/O/U to dodge handwriting confusion), grouped 4-4-4-4 with hyphens for printing: e.g., `K3HM-7TPN-Q9XR-4FBC`. ~80 bits of entropy. The raw code is shown to the user **exactly once** at mint/rotate time (same pattern as `api_tokens`); only `sha256(code_normalized)` is stored. `code_normalized` strips hyphens and uppercases before hashing, so users can type with or without dashes, in any case.

### 3.2 Add an `inbound_events` audit table

```sql
inbound_events (
  id              uuid pk default gen_random_uuid(),
  source          text not null,
  client_uuid     uuid not null,
  source_event_id text,
  household_id    uuid references households(id),
  user_id         uuid references users(id),
  resulting_event_id uuid,               -- pointer into feed_events/diaper_events/mom_events
  resulting_table text,                  -- 'feed_events' | 'diaper_events' | 'mom_events'
  raw             jsonb not null,
  status          text not null check (status in ('accepted','duplicate','merged','rejected')),
  error           text,
  received_at     timestamptz not null default now()
);
CREATE UNIQUE INDEX inbound_events_dedupe_idx ON inbound_events(source, client_uuid);
```

This is the **idempotency ledger and audit trail** for every write. Required by PLAN.md §"Idempotency: two layers" — make it part of the first migration.

### 3.3 Add the outbox

```sql
event_outbox (
  id            bigserial pk,
  topic         text not null,           -- 'event.feed.recorded', etc.
  payload       jsonb not null,
  processed_at  timestamptz,
  failed_at     timestamptz,
  failure_reason text,
  attempts      int not null default 0,
  created_at    timestamptz not null default now()
);
CREATE INDEX event_outbox_unprocessed_idx ON event_outbox(created_at) WHERE processed_at IS NULL;
```

No consumer in Phase 1 — `recordEvent()` writes rows, nothing reads them. The point is to be ready to add Slack/email/Health-sync workers later without touching the service function.

### 3.4 Row Level Security — non-negotiable

Every app-data table gets RLS enabled. The household boundary is enforced by Postgres, not by application code. The connection sets a `request.user_id` GUC at the start of each query via `set_config()`; policies reference it.

```sql
-- Enable RLS
ALTER TABLE households            ENABLE ROW LEVEL SECURITY;
ALTER TABLE household_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE babies                ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE diaper_events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE mom_events            ENABLE ROW LEVEL SECURITY;
ALTER TABLE invites               ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_tokens            ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_codes        ENABLE ROW LEVEL SECURITY;

-- Peer-issued recovery invites: any active member can INSERT an invite whose
-- target_user_id is a co-member of the same household. Caregivers cannot mint
-- target_user_id = NULL invites (those are "new caregiver" invites, owner-only).
CREATE POLICY invites_peer_recovery_insert ON invites FOR INSERT
  WITH CHECK (
    target_user_id IS NOT NULL
    AND household_id IN (SELECT current_user_households())
    AND target_user_id IN (
      SELECT user_id FROM household_members
      WHERE household_id IN (SELECT current_user_households())
    )
  );

-- A user can only ever see / redeem their own recovery code rows.
CREATE POLICY recovery_codes_self ON recovery_codes
  USING (user_id = NULLIF(current_setting('request.user_id', true), '')::uuid);

-- Helper: current user's households.
-- MUST be SECURITY DEFINER. `household_members` has RLS enabled and its own
-- policy is expressed via this function. An invoker-rights version would have
-- its internal SELECT on household_members filtered by that same policy, the
-- lookup would resolve to the empty set, and EVERY household-scoped policy
-- would then deny all rows — the app loads but shows no data (a silent,
-- catastrophic R1-adjacent failure). SECURITY DEFINER makes this one
-- membership read bypass RLS and breaks the cycle. `search_path` is pinned and
-- identifiers are schema-qualified — the standard SECURITY DEFINER hardening
-- against search-path injection. Do NOT remove SECURITY DEFINER.
CREATE OR REPLACE FUNCTION current_user_households() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT household_id FROM public.household_members
  WHERE user_id = NULLIF(current_setting('request.user_id', true), '')::uuid;
$$;

-- household_members policy. Safe to express via the helper ONLY because the
-- helper is SECURITY DEFINER (no re-entrancy). A member sees all co-members of
-- their household — required by /settings/caregivers and "logged by" attribution.
CREATE POLICY household_members_household ON household_members
  USING (household_id IN (SELECT current_user_households()))
  WITH CHECK (household_id IN (SELECT current_user_households()));

-- Example policy (repeat the pattern for each table). NOTE: every policy on an
-- INSERT/UPDATE-able table needs BOTH `USING` (read/visibility) AND
-- `WITH CHECK` (write guard). A `USING`-only policy lets a caller INSERT or
-- UPDATE rows into another household — a write-side data-leak hole. Pair them.
CREATE POLICY feed_events_household ON feed_events
  USING (baby_id IN (
    SELECT id FROM babies WHERE household_id IN (SELECT current_user_households())
  ))
  WITH CHECK (baby_id IN (
    SELECT id FROM babies WHERE household_id IN (SELECT current_user_households())
  ));

-- mom_events has stricter rules: only the author sees it
CREATE POLICY mom_events_self ON mom_events
  USING (user_id = NULLIF(current_setting('request.user_id', true), '')::uuid);
```

**Application-side contract.** Drizzle queries must run inside a transaction that first issues `SET LOCAL request.user_id = '<uuid>'`. Wrap this in a `withUserContext(userId, fn)` helper. Bypassing it is a P0 bug.

### 3.5 Migrations

- **Tool:** `drizzle-kit` (`drizzle.config.ts`).
- **Location:** `src/lib/db/migrations/`.
- **Process:** migrations are SQL files committed to git. `pnpm db:migrate` applies them. Vercel deploy runs `pnpm db:migrate` as a build step (Supabase pooled connection works for migrations).
- **Naming:** `0001_initial.sql`, `0002_add_wasted_oz.sql`, etc. Never reorder, never edit a merged migration — only add new ones.

---

## 4. Auth & session — implementation contract

### 4.1 The flow

```
┌─────────────────┐
│ First visit     │ — user lands on / with no cookie
│ (no session)    │   → redirect to /onboarding
└────────┬────────┘
         │ POST /api/onboarding/create-household
         │   body: { household_name, baby_name, baby_dob, baby_birth_weight_oz, owner_display_name }
         ▼
┌─────────────────┐
│ Owner created   │ — server inserts users, households, household_members(role=owner), babies
│ Session minted  │   then mints a session, sets HTTP-only cookie, redirects to /
└─────────────────┘

──── inviting a caregiver ────

Owner → /settings/caregivers → "Invite Dad"
  → POST /api/invites { display_name: "Dad" }
  → server creates invites row; returns URL https://app/i/{raw-token}
  → owner shares the URL (text, AirDrop, anything)

Dad opens URL on his iPhone
  → GET /i/{raw-token}
  → server hashes, looks up invites by token_hash, validates expires_at, accepted_at=null
  → renders "Welcome — your role is Dad. Tap to join." (display_name editable here)
  → POST /api/invites/{token}/accept
  → server inserts users + household_members(role=caregiver), marks invite accepted,
    mints session, sets cookie, redirects to /
```

### 4.2 Session cookie spec

| Property | Value |
|---|---|
| Name | `nt_session` |
| Value | raw token (32 random bytes, base64url) |
| `HttpOnly` | true |
| `Secure` | true (prod), false (localhost) |
| `SameSite` | `Lax` |
| `Path` | `/` |
| `Max-Age` | `31536000` (1 year) |
| Domain | not set (host-only) |

**Server lookup:** `sessions.token_hash = sha256(cookie_value)`, `expires_at > now()`. Update `last_seen_at` opportunistically (debounce to once per hour to avoid write amplification).

### 4.3 CSRF protection

Because we use cookies, not bearer tokens, for PWA mutations, we are vulnerable to CSRF. Mitigations, in order:

1. **`SameSite=Lax`** kills the obvious case but is not sufficient for top-level navigations / GETs.
2. **Custom header check.** All state-changing routes require `X-Requested-With: fetch` header. The PWA sends it; a cross-origin form post cannot.
3. **Origin check.** Middleware rejects POST/PATCH/DELETE if `Origin` header is missing or not in the allowlist (`APP_URL`).

Siri Shortcut routes (`/api/events`) authenticate by bearer token, not cookie — CSRF does not apply.

### 4.4 API token (Siri) spec

- Generated in `/settings/voice` by an authenticated PWA session.
- 32 random bytes, base64url. Shown to the user **once**. Stored as `sha256(token)` in `api_tokens.token_hash`.
- Sent as `Authorization: Bearer <token>` from Shortcut.
- Resolver looks up by `token_hash`, checks `revoked_at IS NULL`, updates `last_used_at`.
- Revoke from `/settings/voice` sets `revoked_at = now()`.

### 4.5 Account recovery — peer link + offline recovery code

PLAN.md §"Knock-on changes #5" locks the decisions. This section specifies the wire-level contract.

**Two recovery paths, in priority order:**

1. **Peer link (primary).** Any active household member mints a fresh single-use link for any *other* member. Re-binds to the existing `user_id`, so all of Anay's prior logs stay attributed correctly.
2. **Recovery code (fallback for solo-caregiver case).** Each user gets one ~80-bit printable code, shown once at household creation (or on rotate from `/settings`). User stores it offline. Redemption from any device mints a new session for that user.

#### 4.5.1 Peer-recovery flow

```
Active member (e.g. Ashesh)
  → /settings/caregivers → next to "Mom (Aradhna)" tap "Send new access link"
  → POST /api/access-links { for_user_id: <aradhna's user_id> }
  → server validates:
      - caller's session is active
      - for_user_id is a co-member of caller's household
      - no outstanding unaccepted peer-recovery invite for this target
        (invites_active_target_idx enforces this)
  → server inserts invites row:
      target_user_id = for_user_id
      expires_at     = now() + 24 hours      -- shorter than new-caregiver 7d
      token_hash     = sha256(raw_token)
      created_by     = caller's user_id
  → server writes event_audit row: { kind: 'access_link.issued',
                                     issued_by: caller, for_user_id, household_id }
  → returns { url: "https://app/i/{raw_token}", expires_at }
  → caller shares URL via iMessage / AirDrop / read aloud over phone

Target (Aradhna) opens URL on her new device
  → GET /i/{raw_token}
  → server hashes, looks up invites by token_hash, validates:
      - expires_at > now()
      - accepted_at IS NULL
      - target_user_id IS NOT NULL  (this is a peer-recovery invite)
  → page renders: "Welcome back, Mom. Tap to sign in on this device."
  → POST /api/invites/{token}/accept
  → server, in one transaction:
      - if caller (issuer) is owner OR target_user_id == created_by  (self-link):
          UPDATE sessions SET revoked_at = now() WHERE user_id = target_user_id
                                                     AND revoked_at IS NULL
      - mints a new session for target_user_id, sets cookie
      - sets invites.accepted_at = now(), accepted_by = target_user_id
      - writes event_audit row: { kind: 'access_link.redeemed', ... }
  → redirects to /
```

**Asymmetric authority** (the lockout-prevention rule). A peer-issued link to a member of *any* role is **additive only** — accepting it adds a new session row but does **not** revoke the target's existing sessions. Only links issued by the **owner**, or by the target themselves, revoke the target's prior sessions. This means a caregiver can hand Mom a working device back without ever being able to lock her out of her own household. The transaction in `/api/invites/{token}/accept` checks `created_by`'s role against `target_user_id` to decide whether to revoke.

#### 4.5.2 Recovery code flow

```
At household creation (POST /api/onboarding/create-household):
  → after inserting users/households/household_members, server:
      - generates 16-char Crockford Base32 code (80 bits entropy)
      - INSERTs recovery_codes row with code_hash = sha256(normalized)
      - returns the raw code in the response body, exactly once
  → onboarding UI shows a full-screen "Save this somewhere safe" card with:
      - the formatted code (4-4-4-4 with hyphens)
      - "Copy to clipboard" + "Print this page" buttons
      - explanation: "If you lose your phone before anyone else has joined,
                     this is your only way back in."
  → user must tap "I've saved it" to dismiss; we do not store the raw code anywhere

Rotation from /settings/recovery:
  → POST /api/recovery-code/rotate (session)
  → server, in one transaction:
      - UPDATE existing active recovery_codes row SET rotated_at = now()
      - INSERT new row with new code_hash
      - returns the new raw code, shown once
  → previous code is immediately dead (rotated_at IS NOT NULL)

Redemption (lost phone, no peer available):
  → user opens https://app/recover on a new device
  → enters code into the form
  → POST /api/recovery/redeem { code: "K3HM-7TPN-Q9XR-4FBC" }
  → server:
      - normalize: strip hyphens, uppercase
      - hash, lookup recovery_codes by code_hash
      - require: used_at IS NULL AND rotated_at IS NULL
      - in one transaction:
          UPDATE recovery_codes SET used_at = now(), used_from_ip = req.ip
          UPDATE sessions SET revoked_at = now() WHERE user_id = <code.user_id>
                                                    AND revoked_at IS NULL
          INSERT a new session for <code.user_id>, set cookie
          INSERT a new recovery_codes row (auto-rotate so a single code is never
                 long-lived after redemption; user must re-save the new one)
      - return { ok: true, new_recovery_code: "<new raw code>" }
  → /recover/success page shows the *new* code with the same "save this" UI
```

**Why auto-rotate on redeem.** A redeemed code has likely been written on paper or stored in a password manager that may have been compromised in the loss event. Forcing a new code at redemption time turns "lost phone" into a clean reset.

**Rate-limit `/api/recovery/redeem` aggressively.** 5 attempts per IP per hour, then a 24-hour soft block. Brute-forcing 80 bits is infeasible, but a typo-prone user shouldn't tip into lockout — return clear error messages on bad codes (`"That code wasn't recognized. Recovery codes look like K3HM-7TPN-Q9XR-4FBC."`).

#### 4.5.3 Failure modes covered

| Scenario | Path | Notes |
|---|---|---|
| Mom (owner) loses phone, Ashesh has access | Peer link issued by Ashesh | Additive — Aradhna's old sessions stay alive until she manually revokes from new device. |
| Ashesh (caregiver) loses phone, Mom has access | Peer link issued by Mom | Mom is owner → her link revokes Ashesh's old sessions. |
| Mom loses phone, nobody else has joined yet | Recovery code redemption at `/recover` | Single point of failure if the code is also lost; this is the documented Phase 1 gap. |
| Caregiver attempts to lock the owner out by re-linking | Blocked | Caregiver-issued links are additive only; old owner sessions remain. |
| Stolen phone, attacker has cookie | Owner revokes from `/settings/caregivers` (existing flow), then peer-links a fresh device | Cookie is `HttpOnly` so JS-level theft requires device access. |

---

## 5. The canonical event pipeline

### 5.1 The `InboundEvent` discriminated union (Zod)

```ts
// src/lib/voice-parser.ts
const FeedNursing = z.object({
  kind: z.literal('nursing'),
  side: z.enum(['left','right','both']),
  duration_min: z.number().int().positive().max(180),
});
const FeedBottle = z.object({
  kind: z.enum(['pumped','formula']),
  volume_oz: z.number().positive().max(20),
  wasted_oz: z.number().nonnegative().max(20).optional(),
});
const FeedEvent = z.object({ type: z.literal('feed') })
  .and(z.discriminatedUnion('kind', [FeedNursing, FeedBottle]));

const DiaperEvent = z.object({
  type: z.literal('diaper'),
  pee: z.boolean().default(false),
  poop: z.boolean().default(false),
}).refine(d => d.pee || d.poop, 'diaper must be pee or poop');

const MomEvent = z.object({
  type: z.literal('mom'),
  kind: z.enum(['medication','mood','note','pump_only']),
  payload: z.record(z.unknown()),
});

export const InboundEvent = z.object({
  client_uuid: z.string().uuid(),
  source: z.enum(['pwa','siri_shortcut','apple_watch','web','health_bridge']),
  source_event_id: z.string().optional(),
  occurred_at: z.string().datetime(),
  baby_id: z.string().uuid().optional(),
  event: z.discriminatedUnion('type', [FeedEvent, DiaperEvent, MomEvent]),
  raw: z.record(z.unknown()).optional(),
  note: z.string().max(500).optional(),
});
export type InboundEvent = z.infer<typeof InboundEvent>;
```

### 5.2 `recordEvent(ctx, inbound)` — the contract

```ts
// src/lib/record-event.ts
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

export async function recordEvent(
  ctx: AuthContext,
  inbound: InboundEvent
): Promise<RecordResult>
```

**Required behavior:**

1. Inside a single Postgres transaction (with `SET LOCAL request.user_id = ctx.user_id`):
   - INSERT into `inbound_events` with `(source, client_uuid)`. On conflict, return the existing `resulting_event_id` as a `duplicate`.
   - Resolve `baby_id` (default = the household's first baby if absent).
   - Compute `estimated_oz` from `kind`, `duration_min`, baby's age.
   - Run merge-window check (see PLAN.md §"Idempotency: two layers"). If hit, update the existing event's `corroborating_sources` and return `merged`.
   - INSERT into the right domain table (`feed_events`, `diaper_events`, `mom_events`).
   - INSERT into `event_outbox` with topic `event.{feed|diaper|mom}.recorded`.
   - UPDATE the `inbound_events` row with `resulting_event_id`, `resulting_table`, `status`.
2. After transaction commits, compute `say` (the Siri readout) from today's running totals — this is a *separate* read, kept out of the write transaction.

**`say` template** (the differentiator):
- Feed nursing: `"Logged. {today_oz} ounces today, target {low} to {high}."`
- Feed bottle: `"Logged {volume} ounces. {today_oz} total, target {low} to {high}."`
- Diaper pee: `"Logged. {pee_count} wet diapers today."`
- Diaper poop: `"Logged. {poop_count} dirty diapers today."`
- If `today_oz < target_low` AND it's after 8pm: append `" Heads up — you're below today's range."`

### 5.3 HTTP route inventory

| Route | Method | Auth | Body | Returns |
|---|---|---|---|---|
| `/api/events` | POST | bearer | `InboundEvent` | `{ ok, event_id, say }` |
| `/api/voice` | POST | bearer | legacy `{action,...}` | adapter → `/api/events` shape |
| `/api/feeds` | POST | session | `FeedEvent` body | `{ id, ...feed_event row }` |
| `/api/feeds/:id` | PATCH, DELETE | session | partial fields | row or 204 |
| `/api/diapers` | POST | session | `DiaperEvent` | `{ id, ...row }` |
| `/api/diapers/:id` | PATCH, DELETE | session | partial fields | row or 204 |
| `/api/summary` | GET | session | — | today's rollup + target |
| `/api/onboarding/create-household` | POST | none | onboarding form | sets cookie, returns `{ ok }` |
| `/api/invites` | POST | session (owner only) | `{ display_name, role }` | `{ url, expires_at }` |
| `/api/invites/:token/accept` | POST | none | `{ display_name? }` | sets cookie, returns `{ ok }` |
| `/api/access-links` | POST | session (any member) | `{ for_user_id }` | `{ url, expires_at }` — peer-recovery link |
| `/api/recovery-code/rotate` | POST | session | — | `{ code }` — new raw code, shown once |
| `/api/recovery/redeem` | POST | none, rate-limited | `{ code }` | sets cookie, returns `{ ok, new_recovery_code }` |
| `/api/tokens` | POST, DELETE | session | `{ label }` | the token (once) |
| `/api/health-export` | GET | bearer | `?since&types` | JSON for HealthKit Shortcut |

### 5.4 Error response shape

```json
{ "ok": false, "error": "validation_failed", "details": [...], "say": "Sorry, that didn't work." }
```

The `say` field is *always* present so Siri can read something useful when a Shortcut fails.

---

## 6. UI architecture

### 6.1 Page structure

- `/` — TodayCard (server component, no client JS to render). Below it: a `QuickLogBar` (client component, optimistic).
- `/log/feed` — full FeedForm with 3 tabs (Nursing/Pumped/Formula) and wasted-oz field on bottle tabs.
- `/log/diaper` — DiaperForm: two big buttons (Wet / Dirty), tap one or both, submit.
- `/history` — EventList with edit/delete, grouped by day.
- `/growth` — Recharts line chart of `weight_events` on WHO boys' weight-for-age percentile curves (P3/P15/P50/P85/P97, 0–24mo). WHO LMS data ships as a static module (`lib/who-growth.ts`); no extra DB tables.
- `/mom` — MomTab: med, mood, note quick-actions.
- `/settings`, `/settings/caregivers`, `/settings/voice` — admin surfaces.
- `/onboarding` — first-visit flow.
- `/i/[token]` — invite-accept landing.

### 6.2 Realtime wiring

In the root `(app)/layout.tsx` client provider:

```ts
const supabase = createBrowserClient(URL, ANON_KEY);
useEffect(() => {
  const channel = supabase.channel(`household:${householdId}`)
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'feed_events',
          filter: `baby_id=eq.${babyId}` },
        () => router.refresh())
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'diaper_events',
          filter: `baby_id=eq.${babyId}` },
        () => router.refresh())
    .subscribe();
  return () => { channel.unsubscribe() };
}, [householdId, babyId]);
```

`router.refresh()` re-runs the server components, recomputing TodayCard. No client-side fetching needed. RLS on the Realtime channel is enforced by Supabase using a short-lived JWT minted by the server route `/api/realtime-token`.

### 6.3 Offline queue (Week 3)

- IndexedDB store `pending_events`, keyed by `client_uuid`.
- On submit while offline: enqueue + optimistically render. On `online` event: flush queue to `/api/events`.
- Idempotency on `client_uuid` means flush is safe even if the user retried online before we saw the queue.

### 6.4 PWA manifest & service worker

- `app/manifest.ts` exports the manifest object (name, icons, start_url=`/`, display=`standalone`, theme_color).
- `@serwist/next` generates `sw.js` from `app/sw.ts`. Cache strategy: `NetworkFirst` for HTML, `StaleWhileRevalidate` for `/api/summary`, `CacheFirst` for static assets.
- Icons: 192px, 512px, 512px maskable. Generate from one SVG.

---

## 7. Environment & secrets

`.env.local` (development) and Vercel env vars (production). **Never** commit `.env.local`.

```bash
# Public (safe to expose to client)
NEXT_PUBLIC_APP_URL=http://localhost:3000          # prod: https://your-domain
NEXT_PUBLIC_SUPABASE_URL=https://xyz.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...               # row-level-security gated; safe in client

# Server-only
DATABASE_URL=postgres://...pooled.supabase.co:6543/postgres?pgbouncer=true
DATABASE_URL_DIRECT=postgres://...db.supabase.co:5432/postgres    # for migrations only
SUPABASE_SERVICE_ROLE_KEY=eyJ...                   # bypasses RLS — use sparingly
SESSION_COOKIE_SECRET=<32 random bytes base64>     # if we ever sign cookie payloads; not needed today
SENTRY_DSN=https://...
SENTRY_AUTH_TOKEN=...                              # build-time only
```

The Supabase service role key bypasses RLS and must be used **only** in the migration scripts and the `/api/onboarding/create-household` flow (which has to insert before a session exists). All other code paths use the anon key with `SET LOCAL request.user_id`.

---

## 8. Local development setup

Document this in `README.md` once the repo is initialized. Steps:

1. `pnpm install`
2. Copy `.env.example` → `.env.local`, fill in Supabase project URL + keys.
3. `pnpm db:migrate` — runs all SQL files in `src/lib/db/migrations/`.
4. `pnpm db:seed` — inserts the locked-in seed (Aradhna + Anay).
5. `pnpm dev` — starts on `http://localhost:3000`.

**Supabase local CLI vs. cloud dev:** Recommend using a **separate Supabase project** for development (Supabase free tier allows two projects). Cleaner than the local CLI on macOS, and Realtime "just works." Switch via `.env.local`.

---

## 9. Deployment & infrastructure

### 9.1 Vercel

- Connect the GitHub repo (once we push). `main` → production. PRs → preview deployments.
- Build command: `pnpm db:migrate && pnpm build`.
- Output: Next.js standalone.
- Region: `iad1` (us-east-1) — lowest combined latency to Supabase us-east-1 and to Houston, TX.

### 9.2 Supabase

- One project per env (`newborn-dev`, `newborn-prod`).
- PITR (point-in-time recovery) is paid; rely on daily logical backups via a scheduled `pg_dump` to S3 once we leave dev. Phase 1 (one family): manual `pg_dump` weekly is fine.
- Connection pooling: use the **transaction-mode pooler** (port 6543) for Vercel serverless functions, **session-mode** (port 5432) for migrations and long-running scripts.

### 9.3 Domain & DNS

User has purchased a domain; name pending. Once shared:
1. Add CNAME at registrar → `cname.vercel-dns.com`.
2. In Vercel: add the domain to the project, request TLS cert (automatic via Let's Encrypt).
3. Update `NEXT_PUBLIC_APP_URL` in Vercel env to `https://<domain>`.
4. Update Siri Shortcut URL bases (a hand edit in the `.shortcut` source files).

---

## 10. Observability & ops

### 10.1 Logging

- All `/api/*` routes log a single structured line per request:
  `{ level, route, method, status, duration_ms, user_id, household_id, source }`.
- `recordEvent()` logs `{ event: 'record_event', status, kind, dedup_via, duration_ms }`.
- Logs land in Vercel; tail with `vercel logs`.

### 10.2 Errors

- Sentry captures unhandled errors in both server and client (`@sentry/nextjs` auto-instruments).
- Tag every event with `household_id` (set in a request scope, not as user PII).
- Source maps uploaded at build time.

### 10.3 Metrics (Phase 1 — manual)

We do not run Prometheus/Grafana. The Supabase dashboard has rows/day, DB size, Realtime connections, all of which is enough at this scale. Revisit if we onboard more than 100 households.

### 10.4 Alerts

In-app banners only (per PLAN.md). No PagerDuty, no email alerts in Phase 1.

---

## 11. Security checklist

Concrete items to verify before pushing the domain live to people other than the builder.

- [ ] RLS enabled on every app table; manual test: log in as User A, attempt to SELECT a row from User B's household via a crafted query → must return zero rows.
- [ ] Session cookie is `HttpOnly`, `Secure` (in prod), `SameSite=Lax`.
- [ ] CSRF: every state-changing route requires `X-Requested-With` *and* a same-origin `Origin` header.
- [ ] Invite tokens are single-use (`accepted_at` set on first acceptance), expire in 7 days (new caregivers) or 24 hours (peer-recovery), and are hashed at rest.
- [ ] API tokens are hashed at rest; raw value is shown to the user exactly once.
- [ ] Recovery codes are hashed at rest (sha256 of normalized form); raw code shown exactly once at mint/rotate/redeem; auto-rotated on successful redemption.
- [ ] Peer-issued access links are **additive only** — accepting one does NOT revoke the target's existing sessions unless the issuer is the owner or the target themselves. Verified by an integration test ("caregiver mints link to owner; owner's prior session still works").
- [ ] Every `access_link.issued`, `access_link.redeemed`, and `recovery_code.redeemed` event writes to `event_audit` with actor + target + IP.
- [ ] Rate limits on `/api/events`, `/api/invites/{token}/accept`, `/api/access-links` (10/hour/user), and `/api/recovery/redeem` (5/hour/IP, 24-hour soft block after exhaustion) — Vercel's built-in or a Postgres-backed token bucket.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is referenced in at most two files (audit list: `src/lib/db/admin.ts` and onboarding route).
- [ ] No PII in URLs, error messages, or analytics.
- [ ] `.env.local`, `.env`, and any `*.shortcut` files containing tokens are in `.gitignore`.
- [ ] Dependabot / `pnpm audit` clean before launch.

---

## 12. Testing strategy

| Layer | Tool | What to test | Scope in Phase 1 |
|---|---|---|---|
| Unit | Vitest | `targets.ts` (target ranges across ages/weights), `day-window.ts` (DST transitions!), `voice-parser.ts` Zod schemas, `recordEvent()` with mocked DB | High coverage on these four. They are the math of the product. |
| Integration | Vitest + a real Postgres (Supabase dev project or a Docker `postgres:16`) | `/api/events` flows: insert, duplicate, merge; `/api/invites/{token}/accept` flow; RLS isolation between two households | One happy path + one isolation test per endpoint. |
| E2E | Playwright with `iPhone 15` device profile | Onboarding → log feed → see TodayCard update; invite → accept on second browser → both see same data update via Realtime | Two scenarios is enough for v1. |
| Manual | Real iPhone | Add to Home Screen; standalone mode; airplane mode + log + reconnect; "Hey Siri, log a pee" | Required before sharing the domain. |

DST regression test in `day-window.test.ts` is the single most important unit test. Park 2026-11-01 (fall back) and 2027-03-08 (spring forward) into fixtures.

---

## 13. Risks & mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | RLS misconfiguration leaks another household's data | M | Catastrophic | RLS test as a precondition for any merge to `main`. Service role key audit. |
| R2 | Time-zone / 4am-rollover bug corrupts daily totals | H | High (it *is* the dashboard) | Dedicated `day-window.ts` with explicit DST fixtures. |
| R3 | Siri Shortcut `Ask for Input` doesn't pass the number cleanly to URL POST | M | Medium | Test on the user's actual iPhone in week 2. Fallback: pre-set quantities ("log 4 oz formula", "log 5 oz formula"). |
| R4 | Supabase free tier Realtime connection cap (200 concurrent) | L (one family) | Low | Reuse one channel per household; cap clients to ~5. |
| R5 | iOS Safari PWA limitations (no real push, IndexedDB occasional eviction) | M | Medium | In-app banners only for alerts; offline queue stores at most 24h of events. |
| R6 | Loss of session cookie when iOS clears storage after 7 days of inactivity ("ITP") | M | Medium for occasional caregivers | 1-year cookie helps; **peer access link from another member is the documented recovery path** (§4.5.1). |
| R7 | Single-baby v1 schema needs to extend later | L | Low | `baby_id` is already in every event; just need a "switch baby" picker. |
| R8 | Inviter sends the URL via SMS and someone screenshots it / forwards | L | Low | Single-use token mitigates. Future: require a one-time PIN. |
| R9 | Sole caregiver loses both phone *and* printed recovery code before anyone else has joined | L | Catastrophic (no recovery) | Onboarding nudge: "Invite your partner now so peer recovery is available" appears until at least one other member exists. Recovery code save card cannot be dismissed without an explicit "I've saved it" tap. |
| R10 | Caregiver attempts hostile lockout via peer-recovery link | L | High if it worked | Mitigated by design: caregiver-issued links are additive (§4.5.1). Integration test enforces this. |

---

## 14. What "done" looks like — Phase 1 exit criteria

The MVP is shippable when every box below is checked. PLAN.md §"Verification" expands each.

- [ ] Aradhna can log feeds (all 3 kinds) and diapers from her iPhone in Safari.
- [ ] TodayCard shows today's oz total, target range, pee/poop count, time-since-last-feed — updates within 2 s of a partner logging from another phone.
- [ ] Ashesh can join via invite link on his iPhone and log independently. Neither is kicked out.
- [ ] Peer recovery works both ways: Aradhna re-links Ashesh from her phone, Ashesh re-links Aradhna from his — both land on a working session with all prior logs intact. Caregiver-issued link to owner does NOT revoke the owner's prior session.
- [ ] Recovery code is shown once at household creation; redeeming it at `/recover` on a fresh device mints a new session, revokes old ones, and shows the user a new rotated code.
- [ ] All six Siri Shortcuts ("log a pee", "log a poop", "log N oz formula", "log N oz pumped", "log breastfeeding N minutes", "log a dirty diaper") create rows and Siri reads back the daily total + target.
- [ ] `/growth` plots Anay's `weight_events` against WHO percentile curves; current percentile reads correctly in the header.
- [ ] Postpartum mom tab logs c-section meds, mood, notes — visible only to the author.
- [ ] PWA installs to Home Screen; offline queue replays after airplane-mode logs.
- [ ] DST transition test in `day-window.test.ts` passes.
- [ ] RLS isolation test passes (Aradhna's household cannot SELECT from a seeded second household).
- [ ] Sentry receives errors from at least one staged failure.

---

## 15. Decisions still open

Items the builder needs to confirm before or during implementation. None block Week 1.

1. **Domain name.** User has purchased — name pending. Required for production deploy; not for Week 1.
2. **Sentry vs. Vercel-only logs.** Spec recommends Sentry free tier; defer if it adds friction.
3. **Real Supabase dev project vs. Supabase CLI local.** Spec recommends cloud dev project for parity with prod Realtime. Confirm during Day 1.
4. **Phase-2 freemium boundary.** Out of scope for this spec; flagged so the data model doesn't accidentally couple to a single-tenant assumption (it doesn't — every table has `household_id` and we're good).

---

## 16. Glossary

- **PWA** — Progressive Web App; a website that can install to the home screen and run in standalone mode.
- **RLS** — Row Level Security; Postgres feature where row visibility is enforced by SQL policies, not application code.
- **`client_uuid`** — UUID generated on the client (browser or Shortcut) before submit, used as the idempotency key.
- **Day window** — the 4-AM-to-3:59-AM local-time interval that defines "today" for the dashboard.
- **Outbox** — DB table of side-effect events to publish, written in the same transaction as the domain write so no consumer-side step can lose a message.
- **AuthContext** — `{user_id, household_id, source, auth_method}`; what `withAuth(req)` returns and what `recordEvent()` consumes.
