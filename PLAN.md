# Newborn Tracker — MVP Plan (v2, post-research)

> **Where this lives:** `~/.claude/plans/i-want-to-know-structured-pillow.md` so Claude can reference it across sessions. Step 1 of implementation is copying it to `/Users/aradhnasahni/Documents/Coding/Pregnancy Journal/PLAN.md` so it lives in the repo too.

---

## Context

A new mother (baby ~19 days old as of 2026-05-11) currently tracks her newborn's feeds, pees, and poops on paper. She wants a platform where she — and her partner, family, and nanny — can log all of these from their phones, including hands-free voice logging via **Siri** on iPhone, with end-of-day summaries that compare total intake to age-appropriate target ranges. The goal is to make new motherhood less anxious by giving a clear, real-time answer to *"is the baby getting enough?"* without being preachy or pretending to be medical advice. The platform should ultimately serve other new moms too.

**Confirmed scope decisions (user-chosen):**
- **Platform:** PWA (web app installed to home screen) + iOS Shortcuts for Siri voice
- **Users:** Multi-caregiver from day one (mom, partner, family, nanny) in a single shared household
- **Feeding types:** Direct nursing (minutes/side), pumped breast milk (oz), formula (oz), and combos
- **Devices:** iPhone-only for v1 (Siri is iPhone-only; web app works on Android but Siri features won't)
- **"Day" boundary:** Configurable, defaults to **4am-to-3:59am** (a midnight rollover would split nighttime feeds)

---

## CURRENT STATE (2026-05-11, ~54 min into setup)

Dev env install is **stuck on step 1**: background script PID `17003` is in an infinite poll waiting for Xcode CLT to be installed, but the user never clicked "Install" on the Apple dialog. None of the tools are present yet (`xcode-select -p` errors, no `brew`, no `node`, no `pnpm`). Script will self-abort at the 60-minute mark.

**Next action for the user:** click Install on the Xcode dialog (or re-run `xcode-select --install` if the dialog was dismissed). The rest of the script (Homebrew + Node + pnpm) auto-continues once `git` becomes available.

**Next action for Claude after install completes:**
1. Confirm `node --version`, `pnpm --version`, `git --version` all return cleanly.
2. `cd "/Users/aradhnasahni/Documents/Coding/Pregnancy Journal"` and `git init`.
3. `pnpm create next-app@latest .` with TypeScript + Tailwind + App Router + `src/` directory.
4. Install: `pnpm add drizzle-orm postgres zod`, `pnpm add -D drizzle-kit`, `pnpm add @serwist/next`, `pnpm dlx shadcn@latest init`. (PLAN.md formerly listed `@neondatabase/serverless`; SPEC §2 supersedes — we use `postgres` against Supabase's pooled connection.)
5. Write the Drizzle schema (`src/lib/db/schema.ts`) per the **Data Model** section of this plan, with the locked-in seed for Anay Srivastava (DOB 2026-04-23, 99 oz birth weight) and the "My Family" household with Aradhna as owner + Ashesh pre-invited.
6. Stand up local Postgres via `brew install postgresql@16` or use Docker; defer Neon setup until production deploy is needed.
7. Build the **TodayCard** first — it's the entire product's value prop. Manual-log flow comes second. Voice + Shortcuts come in Week 2 per the plan.

---

## DECISIONS LOCKED IN (2026-05-11)

These override anything earlier in the plan if they conflict. Listed here so future-Claude (or a future contributor) sees them first.

| Decision | Value |
|---|---|
| **Auth (Phase 1)** | **No email.** Use invite-link sessions: owner generates per-caregiver URL → caregiver opens it once → device stays signed in via HTTP-only cookie. No Resend, no SMS, no passwords, no Apple/Google OAuth. |
| **Timezone** | **`America/Chicago`** (CDT/CST, Houston, TX). Handles DST automatically. The 4am rollover means a "day" runs 4:00 AM CDT → 3:59 AM CDT next day. |
| **Baby DOB** | **2026-04-23** |
| **Baby birth weight** | **6 lb 13 oz** = **109 oz** (corrected 2026-05-11, supersedes earlier 6 lb 3 oz) |
| **Baby name** | **Anay Srivastava** |
| **Household name** | **"My Family"** (default) |
| **Caregivers (Phase 1 seed)** | Owner display_name = **"Mom"** (real user: Aradhna Sahni). Pre-invited caregiver display_name = **"Dad"** (real user: Ashesh Srivastava). Role labels in UI, not first names. Override per-caregiver in settings later. |
| **Pricing** | **Free forever in Phase 1.** No payment integration, no plan tiers, no paywall. Possible freemium in v2 (user said). |
| **Database platform** | **Supabase** (managed Postgres, free tier). Which Supabase features (Realtime, RLS, Storage, Auth) to enable in MVP — TBD; decide closer to implementation. |
| **Alerts in Phase 1** | **In-app dashboard banners only.** No email alerts, no push notifications. The "low pee / low intake" signal renders inline on the today screen, nowhere else. |
| **Testing strategy** | **Agent-driven E2E.** At the end of each week, launch a Claude Code sub-agent that drives the running PWA against the Verification checklist. Vitest unit tests only on `lib/targets.ts` and `lib/day-window.ts` (math is easy to get wrong). No hand-rolled Playwright suite, no CI pipeline in Phase 1. |
| **Edit audit trail** | **Every mutation logged.** Create/edit/delete on feed/diaper/weight/mom events writes an `event_audit` row with actor, action, before+after payloads. UI shows "logged by Mom, edited by Dad 2h ago" attribution. |
| **Weight tracking** | **Event-sourced.** `weight_events` table holds every reading (birth weight, pediatrician visits, home scale). `babies.current_weight_oz` is a denormalized cache of the latest event, auto-updated on insert. `TodayCard` target band refreshes whenever any caregiver logs a new weight. |
| **Pediatrician PDF export** | **Deferred** to a post-MVP phase per user request. Data is captured throughout Phase 1; only the renderer is missing. |

### Knock-on changes from these decisions
1. **Drop Resend** from the tech stack. Drop the `(auth)/signin/page.tsx` (no signin form needed). Drop `AUTH_URL` and `RESEND_API_KEY` from `.env`.
2. **Auth tables shift:** instead of NextAuth's `users / accounts / sessions / verification_tokens`, we only need a tiny `users` table (id, display_name, created_at) and a `sessions` table (id, user_id, token_hash, expires_at, device_label, revoked_at). No verification tokens, no accounts.
3. **Onboarding flow:** first visitor with no session creates a household → becomes owner → gets their own bookmark URL → from settings, generates invite links for partner / nanny. Each invite link is one-time-use; opening it mints a `user` + `session` row and sets a 1-year HTTP-only cookie.
4. **Session revocation (lost phone / departing caregiver):** owner opens `/settings/caregivers`, taps "Revoke" next to a caregiver → all of that user's sessions get `revoked_at = now()`, cookie is rejected on the next request. Any caregiver can also revoke their *own* other-device sessions from settings (sign out everywhere). Revoked users can be re-invited fresh — invite is a new one-time-use link, the old cookie stays dead.
5. **Peer recovery (lost phone, can't get back in — *the gap in #4*):** if Mom loses her phone, the existing flow leaves her stranded because only the owner can issue invites — and she *is* the owner. Fix: **any active household member can mint a fresh single-use access link for any *other* member** from `/settings/caregivers`. UI shows each member with a "Send new access link" button next to "Revoke". Mechanically: `POST /api/access-links { for_user_id }` → inserts an `invites` row with `accepted_by` **pre-set to the target's existing `user_id`** (so all of Anay's prior logs stay attributed correctly — no new user is created), returns the URL to share over iMessage/AirDrop. **Asymmetric authority** (to prevent hostile lockout): a caregiver-issued link to *any* member is **additive only** — it does NOT revoke the target's existing sessions, just creates one more way in. Only an **owner**-issued link, or a user issuing one to themselves, revokes the target's old sessions. So Ashesh can hand Aradhna a working device back without ever being able to lock her out, and vice versa. Every mint writes an `event_audit` row (`access_link.issued_by`, `for_user_id`). **Solo-caregiver case (one member, lose your phone, nobody to issue a link)** is NOT covered in Phase 1 — explicit Phase 1 mitigation is "invite your partner immediately so peer recovery is available." Phase 2 may add a printable offline recovery code generated at household creation.
6. **Owner transfer:** from `/settings/caregivers`, current owner taps "Transfer ownership" next to a caregiver → confirm prompt ("You'll become a caregiver and lose owner privileges — continue?") → single transaction swaps both `household_members.role` rows (target becomes `owner`, current owner becomes `caregiver`). Only an owner can initiate (prevents hostile takeover). The schema's existing `role check ('owner','caregiver')` already supports this — no migration needed. Common use: Aradhna pre-emptively transfers to Ashesh before a long trip, or vice versa.
4. **Daily target for *this* baby:** at 109 oz birth weight (6 lb 13 oz), after day 14 we estimate ~109 + 4 ≈ 113 oz = ~7.06 lb today. So target band ≈ **14–18 oz/day**. The formula updates the target automatically as `current_weight_oz` is set in settings.
5. **Domain:** user has **already purchased a domain**; name pending. Once shared, drop it into `.env.local` as `APP_URL` and use it for Shortcuts URL bases and (eventually) Vercel deployment. Until then, dev runs on `http://localhost:3000`.

---

## Competitive Landscape (research-derived)

The most important finding from research: **Siri/voice logging is no longer a differentiator.** Multiple apps already ship it.

### Apps with Siri voice logging today
| App | Siri / Watch | Multi-caregiver | Daily intake target | Pricing | Notes |
|---|---|---|---|---|---|
| **Mango Baby** | ✅ Siri Shortcuts + Live Activities + Dynamic Island | ✅ iCloud sharing, no signup | ❌ | Paid (undisclosed) | Pure iOS-native, privacy-first ("no servers") |
| **littlefeed** | ✅ Siri ("Hey Siri, breastfeed left") + Watch | ✅ Server-less partner sync | ❌ | Paid (undisclosed) | One-handed optimized, privacy-first |
| **Baby Tracker (Sprout)** | ✅ Siri + Watch + Live Activities | Limited | ❌ | Freemium | Mature, broad feature set |
| **Baby Tracker Pro (Nighp)** | ✅ via Pro IAP | Limited (shared login) | ❌ | Free + Pro IAP | 4.9★ Google Play (68.8K reviews), no cloud backup in free |
| **Baby Daybook** | ✅ Siri Shortcuts | ✅ | ❌ | $4.99/mo | 20+ activities, PDF export |

### Apps competing on multi-caregiver sync
| App | Strength | Weakness |
|---|---|---|
| **Huckleberry** (5M+ families) | "SweetSpot" sleep prediction is mythic ($9.99/mo) | Multi-user shared login kicks people out (recurring complaint); recent UI redesign feels "rudimentary 1.0"; mixed-diaper option was removed |
| **BabyConnect** | Real-time sync to babysitter/nanny/daycare; trends + weekly reports | Subscription required after trial; "not exactly cheapest" |
| **Nara Baby** | Truly free, no ads/paywall; partner gets own login (Huckleberry weak point) | Smaller feature set than Huck/BabyConnect |
| **ParentLove** | **Unlimited caregiver sharing free forever** + one-time fee, no subscription | Lower brand awareness |
| **Le Baby** | Account-less private sync between partners | Smaller feature set |
| **Onoco** | Real-time activity hand-off mid-event (start timer on one device, stop on partner's) | Niche |

### Hardware / device adjacents (not direct competitors but worth knowing)
- **Hatch Baby** — sleep machine + app, certified sleep consultants
- **Cubtale** — beautiful design + CubAI + optional hardware
- **Talli** — physical one-button logger + app

### Where Huckleberry is genuinely weak (mom-voiced from Reddit & reviews)
1. **Multi-user login boots people out** when the household shares one account
2. **Paywall on basics** — $9.99–$14.99/mo; free tier limited history, ads
3. **No partner-with-own-login** flow (Nara explicitly wins on this)
4. **Recent UI regression** ("looks like a 1.0," sloppy)
5. **Mixed-diaper option removed** — now requires two taps for both pee+poop

### Where Baby Tracker (Nighp) is genuinely weak
1. **Scrollwheel time picker** is slow
2. **Nursing timer doesn't keep screen awake** — phone locks, requires password re-entry
3. **No cloud backup** in free version — phone switch = data loss
4. **No "wasted breastmilk" option** (common Reddit ask)

---

## What Moms Actually Say They Want (Reddit + review synthesis)

### Recurring complaints
1. **Sharing-login kickouts** — Huckleberry's #1 sync complaint
2. **Subscription paywalls on basics** — generates active "what's the free alternative?" threads
3. **Slow time-picker UI** — the scrollwheel pattern is broadly hated
4. **Phone-sleep corrupts breast-side data** — switching apps or letting phone sleep flips L/R
5. **Data loss on phone switch** — apps without cloud backup
6. **Notes per feed missing** — moms want to flag "drowsy" or "didn't eat well" on a feed
7. **Can't reorder activity buttons** — every mom uses a different subset

### Unmet feature wishes (from r/NewParents, r/beyondthebump, etc.)
1. **Partner with own login, free** (Nara wins here; Huckleberry loses)
2. **Hands-free / one-handed logging in the dark** (3am one-handed reality)
3. **"Am I doing okay?" daily intake signal** that's free and not gated behind premium
4. **Pediatrician-shareable summary** for the 1-week / 2-week / 1-month visits
5. **Postpartum mom tracking** in same app — c-section pain meds, mood, recovery notes
6. **"Wasted breastmilk" / "spit-up"** event types
7. **Real-time sync** that doesn't lag or require manual refresh

### Emotional / UX patterns
- **3am, one-handed, in the dark, baby crying, partner asleep.** The app is reached for when she has the least cognitive bandwidth.
- **Anxious second-guessing** — "Is he eating enough? Why fewer wet diapers today? Should I call the pediatrician?"
- **Multiple caregivers across time zones / shifts** — "I need to know if the nanny fed him at 2pm without texting her"
- **Implication:** dashboard must answer the question on first glance, with no taps. Logging must be reachable in <2 seconds from lock screen.

---

## Our Real Differentiation (post-research repositioning)

Voice was always going to be commoditized. The genuinely uncrowded territory:

### Killer feature #1: "Is baby getting enough today?" — real-time intake intelligence
No major competitor surfaces a **live, age-adjusted intake range** with breast/formula split, target progress, and gentle informational alerts (low pee count, low total intake). Huckleberry has sleep prediction (SweetSpot, paywalled); nobody owns the *feeding-adequacy* equivalent.

### Killer feature #2: Free, bulletproof multi-caregiver sync — each person has their own login
Huckleberry's biggest weakness. Nara/ParentLove/Le Baby compete here but are simple-feature-only. We do this AND the intake intelligence.

### Killer feature #3: Combo-feeding unified view (direct nursing + pumped + formula)
Every existing app makes you mentally add the three. We show one daily total, split by source, against the target range. For moms doing all three (the user herself), this is the single most useful screen.

### Killer feature #4: Pediatrician 1-pager export
Free. PDF or shareable link. Last 7 days of feed totals, diaper counts, sleep — the exact data the pediatrician asks for at the 1-week, 2-week, 1-month visit.

### Killer feature #5: Postpartum-mom-included
Light maternal tracking in the same app: c-section pain meds, mood, recovery notes. Strong Reddit demand; no competitor includes it well.

### Voice (Siri Shortcuts) — important, but table stakes
We still ship it, and it has to be great (better than Mango Baby and littlefeed), but it's not the headline.

---

## Recommended Tech Stack

| Layer | Pick | Why (one line) |
|---|---|---|
| Framework | **Next.js 15 (App Router) + React + TypeScript** | One repo serves the PWA UI and the JSON API that Shortcuts will POST to |
| Hosting | **Vercel** | Zero-config Next.js, free tier easily covers a family of 5 caregivers |
| Database | **Supabase (managed Postgres) + Drizzle ORM** | Postgres + Realtime + RLS + future Storage in one platform. Realtime replaces polling for live multi-caregiver sync. Free tier: 500MB DB, 50K MAU. Drizzle on top for typed queries. |
| Auth | **Invite-link sessions** (custom, no email) | User chose no email in Phase 1. Owner generates per-caregiver URLs; tap once on phone, HTTP-only cookie keeps device signed in. No Resend, no SMS, no passwords. Same UX as Mango Baby / Le Baby. |
| Charts | **Recharts** | Donut + stacked bar in ~20 lines |
| PWA | **`@serwist/next`** | Maintained Workbox fork built for App Router; manifest + service worker + offline cache |
| Validation | **Zod** | Same schema validates Shortcut POST body and DB insert |
| Styling | **Tailwind + shadcn/ui** | Mobile-first, no design bikeshedding |
| Background jobs | **Inngest** (free tier) | Daily summary digests, retries, observability; defer wiring until we have a real consumer |
| Voice auth | **Per-caregiver long-lived API token** (sha256-hashed) | Shortcuts can't refresh OAuth — bearer in header, revocable from PWA |

---

## Data Model

Designed for the multi-caregiver use case AND the integration-architecture seam (Section: Integration Architecture). One household = one baby for v1, but generalizes without migration.

```sql
-- Auth.js owns users, accounts, sessions, verification_tokens.
-- App-level tables reference auth.users.id.

households (
  id              uuid pk,
  name            text not null,
  day_start_hour  smallint not null default 4,    -- 0-23, the "4am rollover"
  timezone        text not null default 'America/Chicago',  -- CDT (Houston, TX); handles DST
  created_at      timestamptz default now()
)

household_members (
  household_id  uuid fk -> households,
  user_id       uuid fk -> users,
  role          text check (role in ('owner','caregiver')),
  display_name  text,                              -- "Mom", "Dad", "Nanny Maria"
  primary key (household_id, user_id)
)

invites (
  id            uuid pk,
  household_id  uuid fk,
  email         text,
  token         text unique not null,              -- random 32 bytes, base64url
  role          text default 'caregiver',
  expires_at    timestamptz not null,
  accepted_at   timestamptz,
  created_by    uuid fk -> users
)

babies (
  id                  uuid pk,
  household_id        uuid fk,
  name                text not null,
  birth_date          date not null,
  birth_weight_oz     numeric(5,1),
  current_weight_oz   numeric(5,1),
  weight_updated_at   timestamptz,
  created_at          timestamptz default now()
)

-- One feed table, discriminated by `kind`. Beats 3 tables for query simplicity.
feed_events (
  id             uuid pk,
  baby_id        uuid fk,
  logged_by      uuid fk -> users,
  occurred_at    timestamptz not null,
  kind           text not null check (kind in ('nursing','pumped','formula')),
  -- nursing only:
  side           text check (side in ('left','right','both')),
  duration_min   smallint,
  -- pumped + formula:
  volume_oz      numeric(4,1),
  -- spit-up / wasted milk discriminator (Reddit ask):
  wasted_oz      numeric(4,1),                    -- nullable
  -- computed by the app on insert, used for daily totals:
  estimated_oz   numeric(4,1) not null,
  note           text,
  source         text default 'app',              -- 'app' | 'voice' | 'siri_shortcut' | 'apple_watch' | ...
  client_uuid    uuid unique,                     -- idempotency
  corroborating_sources jsonb,                    -- for multi-source merges (smart bottle + Siri)
  locked_at      timestamptz,                     -- prevent auto-merge after manual edit
  created_at     timestamptz default now()
)
CREATE INDEX feed_events_baby_time ON feed_events(baby_id, occurred_at DESC);

diaper_events (
  id            uuid pk,
  baby_id       uuid fk,
  logged_by     uuid fk -> users,
  occurred_at   timestamptz not null,
  pee           boolean not null default false,
  poop          boolean not null default false,
  note          text,
  source        text default 'app',
  client_uuid   uuid unique,
  created_at    timestamptz default now()
)
CREATE INDEX diaper_events_baby_time ON diaper_events(baby_id, occurred_at DESC);

-- Postpartum mom tracking (light; Reddit ask)
mom_events (
  id            uuid pk,
  user_id       uuid fk,
  household_id  uuid fk,
  occurred_at   timestamptz not null,
  kind          text check (kind in ('medication','mood','note','pump_only')),
  payload       jsonb,                            -- med name + dose, mood scale, etc.
  source        text default 'app',
  client_uuid   uuid unique,
  created_at    timestamptz default now()
)

api_tokens (                                       -- for iOS Shortcuts
  id             uuid pk,
  user_id        uuid fk,
  household_id   uuid fk,
  token_hash     text not null,                   -- sha256(token)
  label          text,                            -- "Mom's iPhone"
  last_used_at   timestamptz,
  revoked_at     timestamptz,
  created_at     timestamptz default now()
)
```

**Key decisions:**
- One `feed_events` table with `kind` discriminator + precomputed `estimated_oz`. Daily totals = `SUM(estimated_oz) GROUP BY kind` — trivially fast.
- `wasted_oz` column directly addresses a recurring Reddit complaint (no app supports it cleanly).
- `corroborating_sources jsonb` + `locked_at` enable future multi-source dedupe (smart bottle + Siri logging same feed) without schema migration.
- `mom_events` is a separate table because the access rules differ (mom can see her own; partner doesn't see mom's medication).

---

## Daily Target & Nursing-Minutes Estimation

### Daily intake target (a range, framed informationally)

- **Days 1–6 (ramp):** `target_low = day_num * 0.5 oz/feed * 8 feeds`, `target_high = day_num * 1 oz/feed * 8 feeds`. Saturates near the newborn rule below.
- **Day 7 through ~2 months:** `2.0–2.5 oz per pound of current body weight per day`, capped at 32 oz/day.
  - `target_low_oz  = weight_lb * 2.0`
  - `target_high_oz = min(weight_lb * 2.5, 32)`
- **If `current_weight_oz` is null:** estimate weight = birth weight + `~7 oz/week` after day 14 (≈200g/week).

For a 19-day-old at ~7.5 lb, target ≈ **15–19 oz/day**.

### Estimating ounces from direct nursing

```
estimated_oz = duration_min * rate_oz_per_min

rate_oz_per_min defaults:
  age <  7 days   -> 0.10   (~1 oz per 10 min)
  age  7-30 days  -> 0.15   (~1.5 oz per 10 min)
  age 30-60 days  -> 0.20
  age 60+ days    -> 0.25
```

Persist resolved `estimated_oz` on the row. Future: tunable "nursing efficiency" slider per household.

### "Today" boundary query (4am rollover)

```sql
WITH bounds AS (
  SELECT
    date_trunc('day', (now() AT TIME ZONE $tz) - interval '4 hours')
      + interval '4 hours' AS day_start
)
SELECT kind, SUM(estimated_oz)
FROM feed_events, bounds
WHERE baby_id = $1
  AND occurred_at >= (day_start AT TIME ZONE $tz)
  AND occurred_at <  (day_start AT TIME ZONE $tz) + interval '24 hours'
GROUP BY kind;
```

### Expected pee count (informational alert)

- Days 1–5: at least `day_number` wet diapers
- Day 6+: at least 6/day

If by 8pm local count is `< 4`, show a banner:
> *"Heads up — 3 wet diapers logged today so far. Healthy babies usually have 6+ by end of day. Not medical advice. If you're worried, please call your pediatrician."*

---

## Integration Architecture (the seam)

So Siri today doesn't lock us out of Alexa, Google Assistant, Apple Watch, Apple Health, WhatsApp, or smart-bottle webhooks tomorrow.

### Single canonical ingestion: `POST /api/events`

Every integration funnels through one endpoint with a discriminated Zod schema:

```ts
InboundEvent = {
  client_uuid: string                    // client-generated, dedupe key
  source: 'siri_shortcut' | 'alexa' | 'google_assistant'
        | 'apple_watch' | 'whatsapp' | 'sms' | 'webhook_hardware'
        | 'web' | 'pwa' | 'health_bridge'
  source_event_id?: string               // vendor's ID if any
  occurred_at: ISO8601
  baby_id?: uuid                         // resolved server-side if absent
  event: Feed | Diaper | Sleep | Pump | Weight | Temperature | Medication | Note
  raw?: jsonb                            // original payload, audit/replay
}
```

The current `/api/voice` becomes a 50-line shim mapping the old `{action: 'feed'}` payload to the new schema. New Shortcuts call `/api/events` directly.

### Auth — one middleware, multiple resolvers

| Source | Mechanism | Resolver |
|---|---|---|
| Siri Shortcuts, Watch | Bearer token (sha256-hashed) | `api_tokens` table |
| Alexa, Google Action | OAuth2 account linking → JWT | `oauth_clients`, `oauth_grants` (future) |
| Hardware webhooks | HMAC-SHA256, per-device secret | `device_secrets` (future) |
| WhatsApp / SMS | Twilio signature + phone match | `caregiver_phones` (future) |
| Apple Health | No token (on-device via Shortcuts bridge) | Bearer (reads from `/api/health-export`) |
| PWA | Auth.js session cookie | Existing |

A `withAuth(req)` middleware tries each resolver in order based on header shape and returns a unified `AuthContext = { caregiver_id, household_id, source, auth_method }`. Route handlers stay clean.

### Idempotency: two layers

1. **Exact dedupe:** `(source, client_uuid)` unique constraint on `inbound_events`. Retries are no-ops returning the original `event_id`.
2. **Semantic dedupe:** If Siri logs a feed at 14:32 and a smart bottle posts the same at 14:33, run a `merge_window` check (feed=5min, diaper=2min, sleep=10min) before insert. On match: keep original, append new source to `corroborating_sources`, prefer the more-precise source's values. No human cleanup.

### Outbound (the trigger seam)

DB-backed outbox + Inngest worker. Every state-changing service function writes to `event_outbox(topic, payload)` in the *same transaction*. Inngest subscribers fan out: Slack webhook, Apple Health sync, daily digest, etc. Topics are flat dotted past-tense: `event.feed.recorded`, `event.diaper.recorded`, `goal.daily_feeds.reached`, `household.caregiver.joined`.

### Voice abstraction across channels

Keep `/api/events` canonical, add per-channel adapter routes for protocols that demand specific response shapes:

```
/api/events                  ← PWA, Siri, Watch (canonical)
/api/integrations/alexa      ← Alexa Skill format → adapter → recordEvent()
/api/integrations/google     ← Google Action Dialogflow → adapter → recordEvent()
/api/integrations/whatsapp   ← Twilio webhook → NLU → adapter → recordEvent()
/api/voice                   ← deprecated alias, kept for in-the-wild Shortcuts
```

Each adapter does 3 things: verify channel auth/signature, translate to canonical `InboundEvent`, call shared `recordEvent(ctx, inbound)`. The service function is the only thing integrations need to call.

### Apple Health bridge (without a native app)

PWAs can't write to HealthKit. Until we ship a native iOS wrapper:
- Read-only `GET /api/health-export?since=...&types=feed,diaper,weight`
- User-installable Shortcut "Sync Baby to Health" runs on a 6-hour Personal Automation, loops, writes via "Log Health Sample" actions.
- `health_sync_cursor(device_id, last_synced_event_id)` table tracks deltas per device.
- Safe to write: `dietaryWater` (bottle feeds in mL), `bodyMass` (weight), `bodyTemperature`. **Don't** write diapers (no HK type), don't write derived/estimated data, don't write to caregiver's profile.

### Scaffold now vs. defer

**Scaffold now** (expensive to retrofit):
1. `/api/events` canonical endpoint + Zod discriminated union
2. `inbound_events` table + `(source, client_uuid)` unique index
3. `event_outbox` table + transactional write (no consumers yet — that's fine)
4. `AuthContext` middleware + bearer resolver (stubs for the rest)
5. `recordEvent(ctx, inbound)` service function — all routes go through it
6. `corroborating_sources` + `locked_at` columns + merge logic

**Defer cleanly:** Inngest wiring (just keep the outbox), Alexa/Google adapters, WhatsApp NLU (paid Twilio), HMAC for hardware, native HealthKit, calendar ICS, PDF export — all pure additions.

---

## Siri / iOS Shortcuts Integration (must beat Mango Baby + littlefeed)

### Six Shortcuts to start

| Siri phrase | Body |
|---|---|
| "Hey Siri, log a pee" | `{action:"diaper", pee:true}` |
| "Hey Siri, log a poop" | `{action:"diaper", poop:true}` |
| "Hey Siri, log a dirty diaper" | `{action:"diaper", pee:true, poop:true}` |
| "Hey Siri, log N ounces formula" | `{action:"feed", kind:"formula", volume_oz:N}` |
| "Hey Siri, log N ounces pumped" | `{action:"feed", kind:"pumped", volume_oz:N}` |
| "Hey Siri, log breastfeeding N minutes [left/right/both]" | `{action:"feed", kind:"nursing", duration_min:N, side:S}` |

### One Shortcut per phrase — not one "smart" parser

Siri's natural-language parameter extraction is unreliable in 2026. Six fixed-shape Shortcuts with one `Ask for Input` prompt for the variable are rock-solid. No backend LLM needed → free, fast, retry-safe.

### Response shape (Siri reads aloud)

```json
{ "ok": true, "say": "Logged. 14 ounces today, target 15 to 19." }
```

The `say` field is the differentiator — it answers *"is baby getting enough?"* in the same breath as the log. Mango Baby and littlefeed don't do this.

### Auth flow

In the PWA at `/settings/voice`: generate API token, show **once**, provide six `shortcuts://import-shortcut/?url=...` deep links to iCloud-hosted `.shortcut` files. Server validates `sha256(bearer)` against `api_tokens.token_hash`.

### Idempotency

`client_uuid` is `UNIQUE` on insert; duplicates return 200 + same `say`.

---

## File / Project Structure

```
/Users/aradhnasahni/Documents/Coding/Pregnancy Journal/
├── PLAN.md                              # copy of this plan, committed
├── app/                                 # Next.js App Router
│   ├── (auth)/
│   │   ├── signin/page.tsx              # magic link form
│   │   ├── invite/[token]/page.tsx      # accept invite (new caregiver OR peer-recovery)
│   │   └── recover/page.tsx             # enter recovery code, redeem, show new rotated code
│   ├── (app)/
│   │   ├── layout.tsx
│   │   ├── page.tsx                     # today dashboard — THE home screen
│   │   ├── log/feed/page.tsx
│   │   ├── log/diaper/page.tsx
│   │   ├── mom/page.tsx                 # postpartum tracking (light)
│   │   ├── history/page.tsx
│   │   ├── growth/page.tsx              # weight on WHO percentile curves
│   │   └── settings/
│   │       ├── page.tsx
│   │       ├── caregivers/page.tsx      # invites + "Send new access link" peer recovery
│   │       ├── recovery/page.tsx        # view status, rotate recovery code
│   │       └── voice/page.tsx           # API tokens + Shortcut install
│   ├── api/
│   │   ├── auth/[...nextauth]/route.ts
│   │   ├── events/route.ts              # CANONICAL ingestion
│   │   ├── feeds/route.ts               # PWA CRUD
│   │   ├── feeds/[id]/route.ts
│   │   ├── diapers/route.ts
│   │   ├── diapers/[id]/route.ts
│   │   ├── summary/route.ts             # today's rollup w/ target range
│   │   ├── invites/route.ts
│   │   ├── invites/[token]/accept/route.ts
│   │   ├── access-links/route.ts        # peer-recovery: mint re-link for a co-member
│   │   ├── recovery-code/rotate/route.ts # rotate caller's offline code
│   │   ├── recovery/redeem/route.ts     # public, rate-limited; redeem offline code
│   │   ├── tokens/route.ts              # mint/revoke API tokens
│   │   ├── voice/route.ts               # legacy alias → /api/events
│   │   └── health-export/route.ts       # for Health bridge Shortcut
│   ├── manifest.ts
│   └── sw.ts
├── components/
│   ├── ui/
│   ├── QuickLogBar.tsx
│   ├── FeedForm.tsx                     # 3-tab Nursing/Pumped/Formula + wasted_oz
│   ├── DiaperForm.tsx
│   ├── TodayCard.tsx                    # "is baby getting enough?" — THE differentiator
│   ├── IntakeDonut.tsx
│   ├── EventList.tsx                    # editable, reorderable later
│   └── OfflineBanner.tsx
├── lib/
│   ├── db/
│   │   ├── schema.ts                    # ALL the tables above
│   │   ├── client.ts
│   │   └── migrations/
│   ├── auth.ts                          # NextAuth + Resend
│   ├── targets.ts                       # daily target + nursing estimator
│   ├── day-window.ts                    # 4am-rollover math
│   ├── who-growth.ts                    # WHO LMS reference data + percentile math
│   ├── voice-parser.ts                  # Zod for InboundEvent
│   ├── api-token.ts                     # mint/hash/verify
│   ├── offline-queue.ts                 # IndexedDB queue + replay
│   ├── household.ts                     # active household resolution
│   ├── with-auth.ts                     # multi-resolver auth middleware
│   ├── record-event.ts                  # THE service function all integrations call
│   └── outbox.ts                        # transactional outbox writer
├── shortcuts/                           # iCloud-hosted Shortcut source of truth
│   ├── log-pee.shortcut.md
│   ├── log-poop.shortcut.md
│   ├── log-formula.shortcut.md
│   ├── log-pumped.shortcut.md
│   ├── log-nursing.shortcut.md
│   └── sync-health.shortcut.md          # future
├── public/
│   ├── icons/
│   └── shortcuts/
├── drizzle.config.ts
├── next.config.ts
├── tailwind.config.ts
├── package.json
└── .env.local
```

---

## Implementation Order (revised, 3 weeks solo)

**Goal: paper is dead by end of week 1. "Is baby getting enough?" answer visible from day 5.**

### Week 1 — Core logging + the killer feature
- **Day 1–2:** `pnpm create next-app`, Tailwind, shadcn, Drizzle, Neon, Auth.js + Resend magic links. Deploy "hello world" to Vercel. Confirm magic-link email works on iPhone Safari.
- **Day 3:** Drizzle schema + migrations for ALL tables (including the integration-seam columns: `corroborating_sources`, `locked_at`, `wasted_oz`, `mom_events`, outbox). Seed: one household + one baby.
- **Day 4:** `FeedForm` (3-tab + wasted oz field) + `DiaperForm` + `QuickLogBar`. PWA-style POST to `/api/feeds` and `/api/diapers`. She can log in Safari.
- **Day 5:** `lib/targets.ts` + `lib/day-window.ts`. **`TodayCard` is the entire product's value prop** — "14 oz today / 15–19 oz target / 3 pees / 1 poop / last fed 47 min ago." Ship.

**Milestone 1: paper dead, intake intelligence live.**

### Week 2 — Multi-caregiver (the second killer) + voice
- **Day 6:** Invite flow — `invites` table, `/invite/[token]` page, opening invite mints session + cookie and adds user to household. `/settings/caregivers` page lists active caregivers with **Revoke** (kills all sessions for that user) and **Transfer ownership** (swaps roles in one transaction) actions. Each caregiver has their own login (Huckleberry's biggest weakness, our biggest pro).
- **Day 7:** `api_tokens` + `/api/events` canonical endpoint with Zod + `client_uuid` idempotency + `withAuth` middleware. Test with `curl`.
- **Day 8:** Build 6 Shortcuts on her iPhone, share via iCloud, paste into `/settings/voice`. "Hey Siri, log a pee" → row → Siri speaks back "Logged. 14 oz today, target 15 to 19." (The speak-back is what Mango Baby and littlefeed don't do.)
- **Day 9:** `IntakeDonut` (Recharts) + `EventList` with edit/delete. History page (last 7 days). **Wire Supabase Realtime subscription** to feed/diaper tables → dashboard auto-updates when partner logs from their phone, no polling.
- **Day 10:** Polish day — bug-bash Week 2 features on a second iPhone (invite flow, peer recovery, Siri voice, Realtime sync). Make Milestone 2 demo-ready. Pediatrician PDF is **deferred to Phase 2** per the locked-in decisions table; the data is captured throughout Phase 1, so adding the renderer later is pure additive work.

**Milestone 2: family logging via voice + dashboard answers the question + peer recovery proven on a second device.**

### Week 3 — PWA, offline, polish, postpartum
- **Day 11–12:** `@serwist/next`, manifest, icons. "Add to Home Screen." Verify standalone mode on iPhone.
- **Day 13:** `lib/offline-queue.ts` — IndexedDB queue, replays on `online` event. `OfflineBanner`.
- **Day 14:** End-of-day signal + low-pee alert as inline banners. Informational, not medical.
- **Day 15:** Settings — `day_start_hour`, timezone, current weight (refines target). Token revoke/rotate. **Growth chart at `/growth`** — Recharts line chart plotting Anay's `weight_events` on top of WHO boys' weight-for-age percentile curves (P3 / P15 / P50 / P85 / P97, 0–24 months). Static WHO LMS reference data lives in `lib/who-growth.ts` (~50 rows, sex-segmented). Header reads current percentile inline ("Anay is currently at the 42nd percentile for weight"). Length-for-age and head-circumference curves are scaffolded in the same module but not surfaced until length/HC capture is added (post-MVP).
- **Day 16:** **Postpartum mom tab** — `mom_events` UI for c-section meds, mood (5-point), notes. The "no competitor does this" feature.
- **Day 17–18:** Bug bash with actual user.
- **Day 19–21:** Buffer.

---

## Trendy Domain Name Shortlist (HISTORICAL — user has purchased a domain; name pending)

> **Status:** Superseded. User confirmed they've already purchased a domain. Once they share the name, replace this entire section with the chosen domain + DNS plan. The shortlist below is kept for record.

### Reality check
Every dictionary 4–5 letter `.com` is taken (verified for `numa.com`, `loomi.com`, `lior.ai`). The realistic TLD strategy is `.baby`, `.app`, `.ai`, `.co`, or a coined / longer name on `.com`. **The user should grab the domain at the moment one resonates** — availability changes hourly. I have NOT verified live availability on most of these; treat the list as starting points to check on Cloudflare/Namecheap immediately.

### 12 candidates (modern SaaS / AI-era vibe, NOT baby-cliché)

| Name | Vibe / meaning | Likely-good TLD |
|---|---|---|
| **Numa** | Latin/Greek root, mythic, short | `.baby`, `.app`, `.co` (`.com` taken since 1995) |
| **Brio** | Italian "vivacity, energy" | `.baby`, `.app`, `.ai` |
| **Cova** | Spanish "cove, nest" — warm not cutesy | `.baby`, `.app` |
| **Lior** | Hebrew "my light" — distinctive | `.baby`, `.app` (`.ai` taken) |
| **Tide** | Daily rhythm / ebb and flow | `.baby`, `.app` (`.com` is detergent) |
| **Loomi** | Coined; warmth, light | `.baby`, `.app` (`.com` taken since 2000) |
| **Yuva** | Sanskrit "youth" — fresh in English market | `.baby`, `.app`, `.ai` |
| **Rune** | Symbol, ancient knowing, very on-trend | `.baby`, `.app` |
| **Plume** | Soft, light, distinctive | `.baby`, `.app` |
| **Halo** | Gentle protection (used a lot — check carefully) | `.baby` |
| **Sonio** | Coined; soft/sound (warning: prenatal startup uses this) | only if `.baby` is genuinely free |
| **Reflo** | Coined; flow, rhythm | `.baby`, `.app`, `.ai` |

### Top 3 recommendations (subjective)

1. **Numa.baby** — *"Numa. Know your newborn."* — Short, mythic, easy to spell, not a baby cliché, the `.baby` TLD reinforces what it is without the name doing it.
2. **Cova.baby** — *"Your baby's cove."* — Warm meaning ("nest/cove"), feels protective, modern lowercase.
3. **Brio.baby** — *"Every day, with brio."* — Energy/vivacity is the *opposite* of new-mom exhaustion; the name itself is a small affirmation.

### Caveats
- "Available on whois" ≠ cheap to register — premium TLDs (`.ai`, `.baby`) often cost $50–$200/year.
- Real trademark clearance needs an attorney before logo/spend. Some Reddit-search-flagged conflicts: Bobbie, Hatch, Owlet, Nanit, Huckleberry, Nara, Pebbi all in the baby/maternal space.
- Skip `-y` / `-ie` suffix names (per user preference: "babyzzz / sproutling" cliché).

---

## Critical Files (the ones that carry the product)

- `lib/db/schema.ts` — the data model **is** the product.
- `lib/record-event.ts` — the service function all integrations call.
- `app/api/events/route.ts` — the canonical ingestion seam.
- `lib/targets.ts` — daily oz target + nursing estimator; the "intelligence" of the app.
- `lib/day-window.ts` — 4am-rollover math; a bug here corrupts every number on the dashboard.
- `components/TodayCard.tsx` — the "is baby getting enough?" screen; the differentiator.
- `app/(app)/page.tsx` — the today dashboard.

---

## Verification (end-to-end)

### After Week 1
- Log a feed + diaper via web UI on iPhone Safari → both in `EventList` → `TodayCard` total + target range updates.
- Cross the 4am boundary → yesterday's total stops rolling into today's.
- Log a wasted-oz pumped event → counts against `wasted_oz`, not against intake target.

### After Week 2
- `curl -X POST /api/events` with bearer token → `{ok:true, say:"..."}`, row tagged `source='siri_shortcut'`.
- "Hey Siri, log a pee" → row in `diaper_events`, Siri speaks the daily count.
- "Hey Siri, log 2 ounces formula" → row with `kind=formula`, Siri speaks updated total **with target context** ("Logged. 14 oz today, target 15 to 19").
- Send same `client_uuid` twice → one row, second response is no-op `say`.
- Partner accepts invite on a different iPhone with their own email → sees the same baby's events, can log independently, **no kickout** even with both phones active simultaneously.
- Owner taps **Revoke** on Ashesh in `/settings/caregivers` → Ashesh's next request is rejected (session row has `revoked_at` set); owner re-issues a fresh invite link; Ashesh accepts → new session row, back in.
- **Peer recovery — caregiver re-links the owner.** Aradhna "loses" her phone (clear cookies in Safari). On Ashesh's phone, he taps "Send new access link" next to Mom in `/settings/caregivers` → URL shared via iMessage → Aradhna opens it on a new device → lands on `/` signed in as Mom, sees all of Anay's prior logs. **Asymmetric check:** if Aradhna's old phone's cookie were still alive, it would *still* work (caregiver-issued links are additive).
- **Peer recovery — owner re-links the caregiver.** Ashesh "loses" his phone. Aradhna taps "Send new access link" next to Dad → Ashesh opens on a new device → signed in as Dad, his old sessions are revoked (owner-issued = revoking).
- **Recovery code.** At onboarding, the "save this code" card showed a 16-char code like `K3HM-7TPN-Q9XR-4FBC`. With Aradhna's phone wiped *and* no other member, she opens `/recover` on a new device, enters the code → lands signed in, and the next page shows a *new* rotated code (old code is now dead).
- Owner taps **Transfer ownership** to Ashesh → confirmation prompt → after confirm, Ashesh's role becomes `owner`, Aradhna's becomes `caregiver`, both rows updated in one transaction; Ashesh's settings page now shows owner-only actions, Aradhna's no longer does.

### After Week 3
- Airplane-mode → log a feed → bring online → row syncs from `offline-queue`.
- Add to Home Screen → fullscreen with correct icon and theme.
- Set `current_weight_oz` in settings → `TodayCard` target updates.
- 8pm with only 3 pees logged → informational banner appears.
- Mom tab → log c-section pain med → appears in her view only (partner doesn't see it).

---

## Explicitly Deferred (don't build in v1)

- Sleep tracking (third pillar; v1.1)
- Photo attach for unusual diapers
- Push notifications (PWA push on iOS is partial — use inline banners + email)
- "Smart" LLM voice parser (6 fixed Shortcuts cover ~95% of intents)
- ~~Realtime sync~~ — **moved into MVP** via Supabase Realtime (replaces the planned 5-second poll, free, ~50 lines of frontend code)
- Android support (Siri is the killer feature path)
- Alexa / Google Assistant Skill (architecture is ready — see Integration section)
- Smart bottle / hardware webhooks (architecture ready)
- Multi-tenant signup for other families (v2)

---

## Open Questions to Resolve at Implementation Start — RESOLVED

1. **Domain** — user has **already purchased a domain**, name pending. **Action: paste the domain into chat so I can update `.env.local` + Shortcuts URLs.**
2. ~~Resend / email alerts~~ — dropped from Phase 1; **revisit in Phase 2** for email-based alerts (low intake, low pee count, daily digest)
3. ~~Timezone~~ — **America/Chicago** (CDT/CST, Houston TX); 4 AM rollover
4. ~~Baby DOB + birth weight~~ — **2026-04-23, 6 lb 13 oz = 109 oz**, baby is **Anay Srivastava**
5. ~~Pricing~~ — **free forever in Phase 1**, possible freemium in v2 once value is proven for other moms
