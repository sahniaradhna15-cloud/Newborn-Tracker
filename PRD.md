# Newborn Tracker — Product Requirements Document

> **Status.** v0.1 — drafted 2026-05-11, alongside PLAN.md and TECHNICAL_SPEC.md, before any code is written.

---

## 1. Document purpose & how this complements PLAN/SPEC

Three docs, one product. [`PLAN.md`](./PLAN.md) is **why** — strategy, competitive research, killer features, weekly scope. [`TECHNICAL_SPEC.md`](./TECHNICAL_SPEC.md) is **how** — architecture, schema, RLS, auth, ops, security. This PRD is **who, what, and how-do-we-know-it's-good** — personas, user stories with testable acceptance criteria, NFRs, success metrics, rollout gates. PLAN/SPEC wins for facts (DOB, weight, locked-in decisions); PRD wins for product intent and acceptance bars. A new PM can read this file alone and know what the product *does*, then drop into PLAN/SPEC for *why* and *how*.

---

## 2. Problem statement

A mother nineteen days postpartum, recovering from a c-section, doing combo feeding, operating at 3 a.m. one-handed in the dark with a crying newborn, currently tracks her baby on **paper**. Huckleberry kicks people out of the shared login, paywalls the answer to her actual question, and adds cognitive load. Voice apps (Mango Baby, littlefeed) log fine but never answer the question that drives every 3 a.m. anxiety: **"Is he getting enough today?"**

The pain (her voice + moms on r/NewParents, r/beyondthebump):

- *"Is he eating enough? Why fewer wet diapers today? Should I call the pediatrician?"* — no app answers without a paywall.
- *"My partner logs from his phone, I log from mine, and one of us keeps getting signed out."*
- *"I'm one-handed in the dark with the baby on me. I can't scroll a time-picker."*
- *"The pediatrician asks 'how many feeds, how many wet diapers' and I'm reading from a smudged paper log."*
- *"Nobody tracks me — c-section meds, mood — and I'm part of this too."*

The product replaces paper, answers the question on first glance, and lets every caregiver log independently with their own session — including hands-free via Siri — in under two seconds from the lock screen. Informational, not medical. Free in Phase 1.

---

## 3. Target users / personas

### 3.1 Primary caregiver — "Mom" (Aradhna Sahni)

The builder. ~19 days postpartum as of 2026-05-11, c-section recovery, on pain meds, doing combo feeding for Anay (DOB 2026-04-23, 6 lb 13 oz). Owner of "My Family". Houston, TX (America/Chicago). Bedside at 2/4/6 a.m. one-handed; couch during cluster feeds; pumping station; pediatrician's waiting room. iPhone in standalone PWA; often Siri because her hands are full.

**Goals.** Replace paper. Know on glance if intake is in range. Show the pediatrician the last 7 days from her phone at well-visits (a polished PDF export is **deferred to Phase 2** — see §7). Track her postpartum (meds, mood) privately.

**Frustrations.** Time-picker scrollwheels; getting signed out when partner logs in; paywalls on the "am I doing okay?" answer; mentally adding nursing-min + pumped-oz + formula-oz.

**Top use cases.** (1) "Hey Siri, log breastfeeding 18 minutes left" while holding the baby. (2) Open PWA → "14 oz / target 15–19 / 3 wet / 1 dirty / last fed 47 min ago" in <500 ms. (3) Open `/history` on her phone in the pediatrician's office and read out the last 7 days.

### 3.2 Co-caregiver — "Dad" (Ashesh Srivastava)

Partner. Joined via single-use invite link minted by Mom. Own session on his own iPhone. Sometimes at work, sometimes on night-shift duty. Expects logs to show on Mom's phone within seconds without her refreshing.

**Goals.** Take a feed shift without texting Mom what he did. Own login that doesn't kick Mom out. Be the recovery path if Mom loses her phone (SPEC §4.5.1).

**Frustrations.** Shared-login apps; email/password setup; UIs without role-named attribution.

**Top use cases.** (1) Log 3 oz formula from work; Mom's TodayCard updates within 2 s. (2) "Hey Siri, log a dirty diaper" one-handed at 5 a.m. (3) "Send new access link" to Mom when her phone died — additive, can't lock her out.

### 3.3 Occasional caregiver — "Nanny / family helper"

Future addition (grandparent, nanny, sitter). Same invite-link mechanism. Drops in for hours, logs 1–3 feeds and a diaper. Less app fluency; may never install to home screen. Daytime when parents are out; possibly older Android (PWA works; Siri does not).

**Goals.** Log without learning a new app. Parents see logs in real time. Get out without leaving anything behind.

**Frustrations.** Account creation; App Store install.

**Top use cases.** (1) Open invite link → `/` signed in. (2) Tap "Wet + Dirty" in QuickLogBar — two taps. (3) Parents revoke her session after the shift; fresh invite next week.

---

## 4. User stories with acceptance criteria

Organized by the killer features in PLAN.md §"Our Real Differentiation," plus two cross-cutting capabilities. Criteria are testable and reference PLAN.md §"Verification" + SPEC §14 where they overlap; they add edge cases (timezone, offline, races) those docs don't pin down.

### 4.1 Killer feature #1 — "Is baby getting enough today?" (intake intelligence)

**Story 1.1.** Home screen answers "is he getting enough?" on glance, at 3 a.m. `TodayCard` is the first element on `/`, a server component — no client fetch on first paint (SPEC §6.1). Shows `estimated_oz` total, target band, wet count, dirty count, time-since-last-feed. Target per PLAN.md §"Daily intake target": days 1–6 ramp; then `2.0–2.5 oz/lb/day` capped at 32 oz — for Anay at ~7 lb, ~**14–18 oz/day**. Renders correctly with `current_weight_oz` NULL (PLAN.md fallback) and with zero events ("0 oz, target X to Y"). Target updates within one render after a new `weight_events` row.

**Story 1.2.** Gentle banner when wet-diaper count is low. Banner on `/` if local time ≥ 20:00 AND today's pee count < 4 (PLAN.md §"Expected pee count"). Copy: *"Not medical advice. If you're worried, please call your pediatrician."* Dismissible per-day. **Never** push, email, or SMS in Phase 1.

**Story 1.3.** Intake rolls over at 4 a.m. local — 2 a.m. feeds don't split across days. "Today" runs `04:00 → 03:59:59 America/Chicago`. DST transitions (2026-11-01 fall-back, 2027-03-08 spring-forward) do not duplicate or drop any event — unit test in `lib/day-window.test.ts` covers both dates (SPEC §12). `03:59` local counts toward *previous* day; `04:01` toward *new*. Changing `households.day_start_hour` updates boundary on next render, no migration.

**Story 1.4.** Wasted pumped milk is tracked but not counted toward intake. `feed_events.wasted_oz` is separate from `volume_oz`; `estimated_oz` (daily totals' source) excludes `wasted_oz`. FeedForm "Pumped" and "Formula" tabs expose "wasted (oz)"; "Nursing" does not. History row shows wasted-oz inline when non-zero.

### 4.2 Killer feature #2 — Free, bulletproof multi-caregiver sync (own login each)

**Story 2.1.** Owner invites a caregiver in one tap; new caregiver is signed in on their phone within a minute, no email/password/app-store. "Invite Dad" in `/settings/caregivers` mints a single-use URL via `POST /api/invites` (SPEC §5.3). Expires 7 days for new caregivers, 24 hours for peer-recovery. Recipient opens URL → `/i/[token]` → "Join" → server mints session, sets `HttpOnly Secure SameSite=Lax` cookie (SPEC §4.2), redirects to `/`. `accepted_at` set; token dead; re-opening shows "This invite has been used." No NextAuth, no email, no Resend, no OAuth.

**Story 2.2.** Both phones stay signed in simultaneously — no kickouts. Both phones hold valid independent `sessions` rows (PLAN.md §"Verification After Week 2"). Race: if Mom and Dad both log within the same 5-minute window with different `client_uuid`s, both rows insert — **not** silently merged. Merge logic is cross-source only (SPEC §5.2).

**Story 2.3.** Revoke a departed caregiver in one tap; re-invite later without resetting others. "Revoke" sets `sessions.revoked_at = now()` for that user; next request returns 401. Other sessions untouched. Fresh invite creates a new one-time token; old cookie stays dead. `event_audit` records actor + target.

**Story 2.4.** Partner-logged feeds appear on Mom's dashboard within 2 s, no refresh. Dad's `POST /api/feeds` triggers Supabase Realtime postgres-changes filtered by `baby_id` (SPEC §6.2); Mom's browser calls `router.refresh()` and re-renders TodayCard. p95 end-to-end **< 2 s** (SPEC §1). If websocket drops, next navigation still shows current state — server-component reads DB directly.

**Story 2.5.** If Mom loses her phone, Dad can send a working link back in — without being able to lock her out. Dad taps "Send new access link" → `POST /api/access-links { for_user_id }` returns single-use URL (SPEC §4.5.1). `target_user_id` pre-bound to Mom's `user_id`; no new user, all logs stay attributed. **Asymmetric authority:** caregiver-issued = **additive** (Mom's existing sessions NOT revoked); owner-issued = revoking. `event_audit` logs issued + redeemed with actor, target, IP.

**Story 2.6.** Solo-member fallback. At household creation the response includes a 16-char Crockford Base32 code on a full-screen "Save this somewhere safe" card; cannot dismiss without "I've saved it" tap (SPEC §4.5.2). Raw code never stored server-side. Redemption at `/recover` (rate-limited 5/hour/IP, 24-hour soft block) mints new session, revokes prior sessions, **auto-rotates** the code. Onboarding shows a persistent nudge ("Invite your partner") until a second member exists (SPEC §13 R9).

### 4.3 Killer feature #3 — Combo-feeding unified view

**Story 3.1.** One daily total, split visibly by source — no mental math. `IntakeDonut` shows three wedges (nursing/pumped/formula) summing to the `today_oz` header. Nursing minutes convert to estimated oz per PLAN.md age-banded `oz_per_min`, **persisted on the row** at insert. Changing the rate setting does NOT retro-mutate historical rows. Zero-event wedges hidden.

**Story 3.2.** FeedForm fits one screen and is hittable one-handed in the dark. Three tabs (Nursing/Pumped/Formula); defaults to last-used. Min tap target **44 × 44 pt** iOS (WCAG AA, §5). Validation errors inline. Usable in iOS Safari standalone dark; no white flash on submit. Cold open of `/log/feed` to logged event ≤ **3 taps**.

### 4.4 Killer feature #4 — Voice (Siri Shortcuts)

**Story 4.1.** "Hey Siri, log breastfeeding 18 minutes left" → Siri says "Logged. 14 ounces today, target 15 to 19" — without unlocking. All six Shortcuts (PLAN.md §"Siri Integration") installable from `/settings/voice`; each POSTs to `/api/events` with `Authorization: Bearer <token>` (SPEC §4.4). Response `{ ok: true, say: "..." }`; Siri reads `say` aloud per SPEC §5.2 templates. Voice trigger → Siri starts reading **< 800 ms p95** (SPEC §1). Errors return `{ ok: false, say: "Sorry, that didn't work." }` so Siri always reads something.

**Story 4.2.** Re-issued Siri commands (double-tap, network retry) never duplicate. Every Shortcut generates a fresh `client_uuid`; `inbound_events.(source, client_uuid)` unique constraint enforces single-write (SPEC §3.2). Retry with same `client_uuid` returns `200 { status: 'duplicate', event_id: <original> }` with the original `say`.

**Story 4.3.** Revoke Siri API token in one tap. `/settings/voice` lists tokens with label + `last_used_at` + Revoke. Revoke sets `revoked_at = now()`; next bearer request returns 401. Raw token shown exactly once at mint, not retrievable afterward.

### 4.5 Killer feature #5 — Pediatrician 1-pager export *(Phase 2)*

**Story 5.1.** *Deferred to Phase 2.* The feature remains a product differentiator (Huckleberry paywalls equivalents) but does not ship in MVP. Phase 1 captures all the underlying data; only the renderer is missing — adding it later is pure additive work (no schema changes). For Phase 1 pediatrician visits, Mom uses `/history` on her phone or screenshots the TodayCard.

**Resolution.** The conflict between PLAN.md §"Decisions Locked In" (deferred) and PLAN.md §Day 10 / SPEC §14 (Phase 1) was resolved 2026-05-11 in favor of **deferred**. Day 10 was repurposed as a Week 2 polish day; the exit-criteria checkbox and routes were removed from SPEC.

### 4.6 Killer feature #6 — Growth chart on WHO curves

**Story 6.1.** Plot Anay's weight against WHO percentile curves, show current percentile. `/growth` plots `weight_events` on Recharts with WHO boys' P3/P15/P50/P85/P97 curves (0–24 mo) behind. WHO LMS data lives in static `lib/who-growth.ts`; no DB tables. Header reads current percentile inline ("Anay is at the 42nd percentile for weight") from latest `weight_events`. New `weight_events` row updates `babies.current_weight_oz` cache and refreshes TodayCard target. Length-for-age and head-circumference are scaffolded in the same module but **not surfaced** in Phase 1.

### 4.7 Killer feature #7 — Postpartum mom tracking

**Story 7.1.** As **Mom**, pain meds, mood, and notes are visible only to me — not to Dad. `/mom` exposes quick-add for `mom_events` (kinds: `medication`, `mood`, `note`, `pump_only`). RLS policy `mom_events_self` restricts SELECT to `user_id = request.user_id` (SPEC §3.4). Integration test signs in as Dad, confirms zero rows. Excluded from realtime broadcast; will also be excluded from the pediatrician PDF when that ships in Phase 2.

### 4.8 Cross-cutting — Offline & durability

**Story 8.1.** An offline-logged feed survives phone restart, syncs on reconnect, never duplicates. Offline submissions enqueue in IndexedDB `pending_events`, keyed by `client_uuid` (SPEC §6.3); queue persists across PWA close and iOS Safari restart. On `online`, flushes to `/api/events`; replay **< 5 s** on normal LTE. If user reconnected before queue flushed and re-logged manually, only **one row** lands in `feed_events` — `client_uuid` idempotency is the guarantee. If iOS evicts IndexedDB (SPEC §13 R5), ≤ 24 h of offline events at risk; documented in help screen.

---

## 5. Non-functional requirements

### 5.1 Performance budgets (per SPEC §1)

| Action | Budget |
|---|---|
| PWA page render (RSC) | < 500 ms p95 |
| PWA mutation (`/api/feeds`, `/api/diapers`) | < 300 ms p95 |
| Siri Shortcut `/api/events` round-trip | < 800 ms p95 |
| Realtime push (Dad → Mom TodayCard) | < 2 s end-to-end p95 |
| Offline-queue replay after reconnect | < 5 s |
| Cold open of `/log/feed` to logged event | ≤ 3 taps |

### 5.2 Accessibility

WCAG 2.1 AA contrast. Min tap target **44 × 44 pt** (iOS HIG) — non-negotiable for 3 a.m. one-handed. Dark mode first-class; default follows iOS system setting; no white-flash transitions on submit. Screen-reader labels on every actionable element; donut chart has a text summary above for VoiceOver. External keyboard not Phase 1.

### 5.3 Reliability

Data durability is non-negotiable. An event at `t` is durable iff `/api/events` returned 2xx OR the `pending_events` IndexedDB txn committed locally — optimistic UI alone does not count. Vercel/Supabase downtime is tolerable for minutes (offline queue covers it); data corruption is not tolerable at any duration. DST correctness (SPEC §13 R2) and RLS isolation (R1) are P0 — `day-window.test.ts` DST fixtures and the RLS integration test (SPEC §12) block merge.

### 5.4 Security (canonical list in SPEC §11)

HTTP-only Secure SameSite=Lax cookies. Invite, API, and recovery-code tokens hashed (sha256) at rest; raw value shown exactly once. CSRF: same-origin `Origin` + `X-Requested-With` on state-changing routes. Caregiver-issued peer-recovery links are **additive only** — design-level lockout prevention. `/api/recovery/redeem` rate-limited 5/hour/IP, 24-hour soft block. Service-role key referenced in ≤ 2 files.

### 5.5 Privacy

Baby data is **hers**. No third-party analytics (no GA, Mixpanel, Segment). Sentry is errors only, tagged with `household_id`, never PII. No PII in URLs, queries, errors, or logs. Display names ("Mom", "Dad") are role labels by default. No trackers, ad SDKs, or affiliate links. Mom's `mom_events` are private from her partner via RLS — a privacy promise, not just an access-control convenience.

---

## 6. Success metrics

Phase 1 is **one family**. No DAU/MAU theater. Metrics measure *use* and *trust*. Rolling 30-day window unless noted.

| Metric | Phase 1 target | Source |
|---|---|---|
| Time-to-first-log after onboarding | < 60 s | `users.created_at` → first `feed_events.created_at` |
| Days-with-zero-logs (excl. hospital readmits) | **0** | `COUNT(*)` per day window |
| Daily-active-caregiver count | **2** (Mom + Dad) | `COUNT(DISTINCT logged_by)` |
| Sync lag p95 (Dad logs → Mom sees) | < 2 s | aspirational — needs client timing |
| % feeds logged via Siri vs UI | instrumented, no target | `GROUP BY source` |
| Offline-queue dedupe rate | 100% (zero duplicate `client_uuid`) | `inbound_events.status = 'duplicate'` |
| Days since last P0/P1 | > 30 (gates Phase 2) | manual incident log |

**Not Phase 1:** retention curves, signup conversion, NPS, engagement, revenue, churn — all Phase 2.

**Aspirational (Phase 2):** cohort retention, time-to-target-band-on-track, mood trend correlated with intake target hits.

---

## 7. Out of scope for Phase 1

From PLAN.md §"Explicitly Deferred" and SPEC §13. Each line is **why**, not just *what*.

- **Sleep tracking** — own UI complexity (in-progress timer, multi-nap); user's pain is intake, not sleep. v1.1.
- **Photo attach for unusual diapers** — needs Supabase Storage + retention policy; user deferred.
- **Push notifications** — iOS PWA push is partial in 2026; alert model is in-app banners only. Email alerts deferred (Resend dropped).
- **"Smart" LLM voice parser** — six fixed Shortcuts cover ~95% of intents free; LLM adds cost, latency, new failure mode.
- **Android support** — Siri is iPhone-only and is the killer voice path.
- **Alexa / Google Skills, smart-bottle webhooks** — architecture seam built; OAuth + skill submission + hardware aren't Phase 1 effort.
- **Multi-tenant signup for other families** — schema multi-tenant safe; only the onboarding UI gates public signup.
- **Apple Health bridge** — `/api/health-export` scaffolded; "Sync Baby to Health" Shortcut is post-MVP.
- **Premium / paid tier** — free forever Phase 1; freemium considered for v2.
- **Length / head-circumference curves** — `lib/who-growth.ts` scaffolds the LMS data; UI is post-MVP.

**NOTE:** Growth chart (weight-for-age, WHO percentile curves) was moved **into** Phase 1 (PLAN.md §"Day 15"). Do not list as deferred.

---

## 8. Open questions & dependencies

From SPEC §15 plus PRD-process items.

1. **Domain name.** Purchased; name pending. Required for production deploy and Siri Shortcut URL base. Not blocking Week 1.
2. **Supabase project creation.** Not yet created. SPEC §8 recommends a cloud dev project (not local CLI) for Realtime parity. Confirm Day 1.
3. **WHO LMS reference-data.** `lib/who-growth.ts` specified but canonical CSV (WHO 2006 boys 0–24 mo weight-for-age) not yet copied in. Download from `who.int/childgrowth/standards`, convert to typed `WhoLmsRow[]` Day 15.
4. **Sentry adoption.** SPEC §10 recommends free tier; defer if friction. Decide before sharing prod URL with Dad.
5. **iOS Safari ITP eviction in PWA standalone.** SPEC §13 R6 assumes 1-year cookies survive most eviction; peer-recovery is the safety net. Confirm by leaving PWA closed 7+ days during Phase 1.

---

## 9. Release / rollout plan

Phase 1 has no external rollout. The user is the user. Public launch is Phase 2+.

**Phase 1 launch — *"Aradhna replaces paper for 7 consecutive days."*** Trigger: seven consecutive day-windows where every feed and diaper for Anay is logged in the app, zero on paper. Exit: every checkbox in SPEC §14 green. Audience: Aradhna only — Phase 1 success is not gated on Dad's logging volume.

**Phase 1.5 — *"Ashesh logs independently for 3 consecutive days."*** Trigger: Dad logs ≥ 1 event from his own session on three consecutive days, zero kickouts, zero recovery-link issuances. Proves invite flow, second-session durability, and realtime sync hold in real use.

**Phase 2 launch trigger — *"Phase 1 stable for 30 days."*** Thirty days from Phase 1.5 with no P0/P1 (data loss, RLS leak, outage > 5 min) and no emergency peer-recovery or recovery-code redemption that revealed a bug. Only then open public-launch discussion. Phase 2 work starts with the pediatrician PDF renderer (data is already captured in Phase 1) and has its own PRD.

**Phase 1 does NOT do:** public landing page, marketing site, waitlist, App Store submission, second-family onboarding UI, payments, email.
