# Plan: Phase 3 — PWA, Offline, Growth, Postpartum

> **Phase:** 3 of 3 from PLAN.md (Week 3)
> **Tasks:** 4 (max 4)
> **Overall Progress: 0%**
> **Status:** Not Started
> **Task Token Budget:** Each task ≤ 150K tokens

## TLDR

Finish the MVP: turn the web app into an installable PWA on iOS Safari + Android Chrome, make it survive airplane mode with an IndexedDB offline queue that replays on reconnect, ship the `/growth` page that plots Anay against WHO percentile curves, expose general settings (timezone, day-start hour, current weight, token rotate), and add the postpartum mom tab that no competitor does well. After this phase the Phase 1 exit criteria in TECHNICAL_SPEC §14 are fully met.

## Critical Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | PWA toolkit | `@serwist/next` (Workbox fork maintained for App Router) | Better-maintained than `next-pwa`; first-class App Router support per TECHNICAL_SPEC §2. |
| 2 | Offline queue storage | IndexedDB via a small typed wrapper (no `idb` library; ~80 lines hand-rolled) | One queue store, four operations (enqueue, peek, ack, list). External lib is overkill; tree-shake matters on iOS Safari. |
| 3 | Insight banners scope | **Already shipped in Phase 1** as `InsightBanner` under TodayCard | Decision from 2026-05-14: WHO-aligned messaging (low intake, low pee, high formula share, long gap) is inline-dashboard-only and was moved into Phase 1 Task 4. Phase 3 does NOT re-implement; only adds offline-aware banners. |
| 4 | Growth chart percentile source | Static WHO LMS reference data shipped in `lib/who-growth.ts`; weight-for-age boys 0–24mo (P3/P15/P50/P85/P97). Length-for-age + HC scaffolded but not surfaced | Avoid a runtime API dependency; ~50 rows of LMS coefficients are tiny. PLAN.md Day 15 spec. |
| 5 | Mom-tab privacy | `mom_events` RLS policy `mom_events_self` (only author sees their rows) — established in Phase 1's migration 0001 | Partner does not see Mom's medication / mood data. Validated by RLS isolation test. |

## Relevant Files

| File | Action | Purpose |
|------|--------|---------|
| `src/app/manifest.ts` | CREATE | Web app manifest (name, icons, theme, display=standalone) |
| `src/app/sw.ts` | CREATE | Serwist service worker entry |
| `next.config.ts` | MODIFY | Wrap with `withSerwist({...})` |
| `public/icons/icon-192.png` | CREATE | 192px app icon |
| `public/icons/icon-512.png` | CREATE | 512px app icon |
| `public/icons/icon-512-maskable.png` | CREATE | Maskable variant for Android adaptive icons |
| `public/icons/apple-touch-icon.png` | CREATE | 180px for iOS home screen |
| `src/components/InstallPrompt.tsx` | CREATE | Cross-platform install hint (`beforeinstallprompt` on Android, instructional sheet on iOS) |
| `src/lib/offline-queue.ts` | CREATE | IndexedDB-backed pending-event queue |
| `src/components/OfflineBanner.tsx` | CREATE | "You're offline — logging will sync when you reconnect" |
| `src/components/QueueReplayProvider.tsx` | CREATE | Listens to `online` event, drains queue to `/api/events` |
| `src/components/FeedForm.tsx` | MODIFY | Enqueue on offline, optimistic UI |
| `src/components/DiaperForm.tsx` | MODIFY | Same |
| `src/components/QuickLogBar.tsx` | MODIFY | Same |
| `src/components/InsightBanner.tsx` | MODIFY | Add `offline` variant (renders a calm "Some entries are queued and will sync" line when queue is non-empty) |
| `src/lib/who-growth.ts` | CREATE | WHO LMS reference data + percentile math |
| `src/lib/who-growth.test.ts` | CREATE | Unit test: known weight-for-age → known percentile |
| `src/app/(app)/growth/page.tsx` | CREATE | Recharts overlay |
| `src/components/GrowthChart.tsx` | CREATE | Recharts client component |
| `src/components/WeightLogForm.tsx` | CREATE | Quick form to log a weight reading |
| `src/app/api/weights/route.ts` | CREATE | POST weight event |
| `src/app/api/weights/[id]/route.ts` | CREATE | PATCH/DELETE |
| `src/app/(app)/settings/page.tsx` | MODIFY | Add day_start_hour, timezone, current weight controls (page was created in Phase 2 for caregivers index) |
| `src/app/api/settings/household/route.ts` | CREATE | PATCH day_start_hour, timezone, household name |
| `src/app/api/settings/baby/route.ts` | CREATE | PATCH current_weight_oz (logs a `weight_events` row) |
| `src/app/(app)/mom/page.tsx` | CREATE | Postpartum mom tab |
| `src/components/MomQuickLog.tsx` | CREATE | Three quick-action cards (medication, mood, note) |
| `src/components/MomEventList.tsx` | CREATE | Mom's own history |
| `src/app/api/mom-events/route.ts` | CREATE | POST mom event |
| `src/app/api/mom-events/[id]/route.ts` | CREATE | PATCH/DELETE |

## Dependencies

**New packages:**
- `@serwist/next` — PWA toolkit (Workbox fork for App Router)
- `serwist` — runtime (peer of `@serwist/next`)

**Existing utilities to reuse:**
- `src/lib/record-event.ts` — queue replay POSTs to `/api/events`, which calls this
- `src/lib/insights.ts` (Phase 1) — extend with one new offline-queue insight
- `src/lib/with-user-context.ts` — every new mutation route wraps in this
- `src/components/InsightBanner.tsx` — already supports `Insight[]`; just adds one more `kind`
- `recharts` (installed in Phase 2) — used by `GrowthChart`
- `src/lib/audit.ts` (Phase 2) — weight + mom mutations write audit rows

**Configuration changes:**
- Add `serwist` config block to `next.config.ts`
- Generate three PWA icons from one SVG source (the user provides the SVG or accepts a placeholder)
- Service worker is built at `npm run build` to `public/sw.js`

## Tasks

### Task 1: PWA installability — manifest, service worker, icons, install hint

**Estimated scope:** ~6 files (4 created, 2 modified), 0 endpoints, 1 component
**Files touched:**
- `src/app/manifest.ts` (CREATE)
- `src/app/sw.ts` (CREATE)
- `next.config.ts` (MODIFY)
- `public/icons/icon-192.png`, `icon-512.png`, `icon-512-maskable.png`, `apple-touch-icon.png` (CREATE)
- `src/components/InstallPrompt.tsx` (CREATE)
- `src/app/(app)/layout.tsx` (MODIFY — mount `InstallPrompt` once)
- `src/app/layout.tsx` (MODIFY — `<link rel="apple-touch-icon">`, `<meta name="theme-color">`)

**Subtasks:**
- [ ] Install `pnpm add @serwist/next serwist`.
- [ ] `src/app/manifest.ts` exports the manifest object: `name: "Newborn Tracker"`, `short_name: "Newborn"`, `start_url: "/"`, `display: "standalone"`, `background_color: "#fefcf9"`, `theme_color: "#fefcf9"`, `icons` array referencing the three PNGs with `purpose: "any"` and `purpose: "maskable"`.
- [ ] `src/app/sw.ts` — Serwist entry. Cache strategies per TECHNICAL_SPEC §6.4:
  - HTML pages: `NetworkFirst` with 3s timeout
  - `/api/summary`: `StaleWhileRevalidate`
  - Static assets (`/_next/static/*`, `/icons/*`): `CacheFirst`
  - `/api/events`, `/api/feeds`, `/api/diapers`, mutation endpoints: `NetworkOnly` (queue is the client-side fallback, not the SW)
  - Skip waiting + clients claim, so updates ship without an explicit refresh
- [ ] `next.config.ts`: wrap config with `withSerwist({ swSrc: 'src/app/sw.ts', swDest: 'public/sw.js' })`.
- [ ] Generate three PNG icons from one source SVG (the user provides the SVG OR a calm baby-blue rounded-square placeholder is acceptable for now — flag in the README that the design refresh is post-MVP). Use `sharp` CLI or any image tool: `192×192`, `512×512` (square, "any"), `512×512` with a 80% safe-area for `maskable`, `180×180` for `apple-touch-icon`.
- [ ] `src/app/layout.tsx`: add `<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">`, `<meta name="theme-color" content="#fefcf9">`, and `<meta name="apple-mobile-web-app-capable" content="yes">`.
- [ ] `src/components/InstallPrompt.tsx` (client):
  - On Chrome (Android + desktop): listen for `beforeinstallprompt`, stash the event, render a small "Install Newborn Tracker" button in the bottom-right that calls `event.prompt()` and dismisses on `userChoice`.
  - On iOS Safari (detected by user-agent): render a one-time bottom sheet (dismissable, `localStorage` flag to suppress on subsequent visits) with the iOS install steps — "Tap the Share icon, then 'Add to Home Screen'".
  - On already-installed (display-mode: standalone via `window.matchMedia('(display-mode: standalone)').matches`): render nothing.

**Details:**
- **Cross-browser:** the manifest works in all Chromium browsers and on Android. iOS Safari uses the `apple-touch-icon` + `apple-mobile-web-app-capable` meta tags instead of the manifest for the home-screen entry (Safari supports manifest partially as of 2026; safe path is to set both). Firefox desktop supports installs from Chrome's manifest too. Edge follows Chrome.
- Confirm in DevTools → Application → Manifest that the icons resolve and the install button appears in Chrome.
- Do NOT cache `/api/realtime-token` — that mints a short-lived JWT and a cached one would be stale. Add it to a `NetworkOnly` rule.

**Depends on:** Phase 2 complete.

**Definition of Done:**
- Chrome on desktop: `chrome://flags`-free install via the address-bar install button → app launches in standalone window with correct icon and theme color
- Chrome on Android: visit the URL → install banner → tap → app on home screen launches standalone
- iOS Safari: visit the URL → bottom sheet shows "Add to Home Screen" instructions → after Add → app launches in standalone mode (no Safari chrome) with the apple-touch-icon
- Already-installed devices do NOT see the InstallPrompt
- Lighthouse PWA audit passes the install criteria (manifest valid, icons valid, served over HTTPS, service worker registered)
- `pnpm typecheck` and `pnpm lint` pass

---

### Task 2: Offline queue + replay + offline-aware insight

**Estimated scope:** ~6 files, 0 endpoints, 2 components
**Files touched:**
- `src/lib/offline-queue.ts` (CREATE)
- `src/components/OfflineBanner.tsx` (CREATE)
- `src/components/QueueReplayProvider.tsx` (CREATE)
- `src/components/FeedForm.tsx` (MODIFY — enqueue on offline)
- `src/components/DiaperForm.tsx` (MODIFY — enqueue on offline)
- `src/components/QuickLogBar.tsx` (MODIFY — enqueue on offline)
- `src/components/WeightLogForm.tsx` (MODIFY — enqueue on offline) *(this file is created in Task 3 — Task 2 should not assume it; Task 3 reuses the helpers from Task 2 instead)*
- `src/lib/insights.ts` (MODIFY — add `kind: 'offline_queue_pending'` insight)
- `src/app/(app)/layout.tsx` (MODIFY — mount `QueueReplayProvider` and `OfflineBanner`)

**Subtasks:**
- [ ] `src/lib/offline-queue.ts`: thin IndexedDB wrapper. Schema: one object store `pending_events`, key `client_uuid`, value `{ client_uuid, endpoint, body, queued_at }`. API:
  - `enqueue(endpoint: string, body: object): Promise<void>` — adds a row
  - `peekAll(): Promise<PendingEvent[]>`
  - `ack(client_uuid: string): Promise<void>` — removes
  - `count(): Promise<number>`
  All operations are awaited; the wrapper opens the DB on first call and reuses the connection. Handle iOS Safari's quota eviction by catching `QuotaExceededError` and surfacing a benign "Storage full — please reconnect" state (no data loss because we still queue in-memory until reload).
- [ ] `src/components/QueueReplayProvider.tsx` (client): on mount, register listeners:
  - `window.addEventListener('online', drainQueue)`
  - `setInterval(drainQueue, 60_000)` as a backup (in case `online` event missed)
  - On submit success / after replay → `router.refresh()` so TodayCard updates
  `drainQueue()`: `peekAll()`, then for each entry POST to its `endpoint` with `Content-Type: application/json`, `X-Requested-With: fetch`, the stored body. On 200 or 409 (duplicate `client_uuid`) → `ack(client_uuid)`. On 4xx (validation) → `ack` and log to Sentry (the entry is malformed; retrying won't fix it). On 5xx or network failure → leave queued. Sequential, not parallel — keeps order and avoids hammering on reconnect.
- [ ] `src/components/OfflineBanner.tsx` (client): subscribes to `navigator.onLine` + `online`/`offline` window events. Renders a slim top-of-page banner ("You're offline — entries will sync when you're back online") only when offline. Calm style, no red, no scary icon.
- [ ] Modify `FeedForm`, `DiaperForm`, `QuickLogBar` submit handlers: pre-generate `client_uuid`, optimistically update UI, then:
  - If `navigator.onLine`: POST normally. On network error, fall through to enqueue.
  - Else: `enqueue('/api/feeds', body)` (or `/api/diapers`); show a small "queued" pill on the optimistic row in the EventList (Phase 2 EventList must check both server data and the IndexedDB queue when rendering — extend the EventList in this task).
- [ ] `src/components/EventList.tsx` (Phase 2 component — modify): merge server events with queue entries (deduped by `client_uuid`). Queue entries render with a `queued` badge.
- [ ] `src/lib/insights.ts`: add a new insight kind:
  - `offline_queue_pending`: if `await offlineQueue.count() > 0`, render `"{N} entry pending sync — they'll go through when you're back online."` (computed via a small client-only helper since `insights.ts` is a pure function — the offline insight is composed in the layout, not inside `computeInsights`. Adjust: the offline insight is produced by `QueueReplayProvider` and prepended to the `Insight[]` passed to `InsightBanner`. `insights.ts` stays pure.)

**Details:**
- **Cross-browser:** IndexedDB is supported in all targeted browsers. iOS Safari occasionally evicts storage after 7 days of inactivity ("ITP" — see Risk R5 in TECHNICAL_SPEC). Mitigation: keep queue tiny (cap at 24h of events; older entries are dropped with a Sentry breadcrumb).
- **`navigator.onLine` is a hint, not truth** (it lies on some captive portals). The actual fetch failure is the source of truth; treat `onLine === false` as a fast path to skip the network attempt but always treat a failed POST as "enqueue and retry".
- The QueueReplayProvider replays sequentially. Server-side `client_uuid` idempotency (Phase 1 Task 3 `recordEvent`) means a duplicate replay is safe — it returns `status: 'duplicate'` and the queue acks it.
- iPhone Safari standalone PWA mode: events DO still fire when the user re-launches after being offline; the `online` listener and the 60s interval both cover this.

**Depends on:** Task 1 (the service worker registration is unrelated to the queue, but having the PWA installed makes airplane-mode testing realistic).

**Definition of Done:**
- Airplane-mode → log a feed via FeedForm → optimistic row in EventList with "queued" pill → row in IndexedDB → turn airplane mode off → within 60s (or immediately on the `online` event) the entry POSTs and the pill disappears
- Same flow on Chrome Android, Safari iOS standalone PWA, and desktop Chrome with DevTools "Offline" toggle
- Duplicate replay: artificially POST while offline, then POST the same `client_uuid` again on reconnect → one row in DB, queue acks both
- OfflineBanner shows only while offline, hides immediately on reconnect
- `InsightBanner` shows the "{N} pending sync" line while the queue is non-empty
- iOS Safari quota eviction does not crash the app (manually simulate by filling storage)

---

### Task 3: Settings (day-start / timezone / weight) + Growth chart with WHO percentiles

**Estimated scope:** ~9 files, 4 endpoints, 2 components + 1 page
**Files touched:**
- `src/lib/who-growth.ts` (CREATE)
- `src/lib/who-growth.test.ts` (CREATE)
- `src/app/(app)/growth/page.tsx` (CREATE)
- `src/components/GrowthChart.tsx` (CREATE)
- `src/components/WeightLogForm.tsx` (CREATE)
- `src/app/api/weights/route.ts` (CREATE)
- `src/app/api/weights/[id]/route.ts` (CREATE)
- `src/app/api/settings/household/route.ts` (CREATE)
- `src/app/api/settings/baby/route.ts` (CREATE)
- `src/app/(app)/settings/page.tsx` (MODIFY — replace Phase 2's caregivers-index placeholder with the full settings page; caregivers link stays as a card)

**Subtasks:**
- [ ] `src/lib/who-growth.ts`:
  - Static array `WEIGHT_FOR_AGE_BOYS_0_24M`: ~50 rows of `{ ageMonths: number, L: number, M: number, S: number }` from the WHO Child Growth Standards (publicly available LMS coefficients). Source URL in a top-of-file comment for auditability.
  - Function `weightPercentile(ageMonths: number, weightKg: number, sex: 'boy' | 'girl' = 'boy'): number` — LMS formula: `Z = ((weight / M) ^ L - 1) / (L * S)` when L≠0, else `Z = ln(weight / M) / S`; convert Z to percentile via cumulative normal. For Phase 1 we ship boys only; girls scaffold (constant return `null`) for future.
  - Function `percentileBands(ageMonthsRange: number[], pct: 3 | 15 | 50 | 85 | 97, sex): { age, weightKg }[]` — given an array of ages, return the weight at that percentile (inverse LMS). Used by `GrowthChart` to draw the reference curves.
  - Length-for-age + head-circumference functions: stubs that throw "not implemented" — surfaced post-MVP.
- [ ] `src/lib/who-growth.test.ts` (Vitest):
  - Known checkpoint: a 6.4kg boy at 3 months is approximately the 50th percentile (per WHO published tables) → `weightPercentile(3, 6.4)` ≈ 50 ± 2
  - 0-month boy at 3.3kg → ~50p
  - 24-month boy at 12.5kg → ~50p
  - Edge: age=0 weight=2.5kg → ~3p, age=0 weight=4.4kg → ~97p
  - `percentileBands` for P3/P50/P97 at age 0 returns the corresponding weights from the same LMS row
- [ ] `POST /api/weights` (session): body `{ occurred_at, weight_oz, note? }`. Within `withUserContext` + `withAuth`:
  - INSERT into `weight_events`
  - `UPDATE babies SET current_weight_oz = $1, weight_updated_at = $2` (denormalized cache per PLAN.md)
  - `writeAudit('weight.created', ...)` (Phase 2 util)
  - Return inserted row
- [ ] `PATCH/DELETE /api/weights/[id]`: same pattern + recompute `babies.current_weight_oz` from `max(occurred_at)` if the modified row affects the latest reading.
- [ ] `PATCH /api/settings/household`: body `{ day_start_hour?, timezone?, name? }`. Updates `households`. Owner-only.
- [ ] `PATCH /api/settings/baby`: body `{ name?, birth_date?, birth_weight_oz?, current_weight_oz? }`. Updates `babies`. If `current_weight_oz` is provided, also INSERT a `weight_events` row sourced from this update so the growth chart sees it. Owner only for non-weight fields; any caregiver may log a new weight.
- [ ] `src/components/WeightLogForm.tsx` (client): `react-hook-form` with fields occurred_at (default now), weight_oz, note. Submits to `/api/weights`. Uses the offline queue helper from Task 2 if offline.
- [ ] `src/components/GrowthChart.tsx` (client, Recharts): renders a `<LineChart>` with:
  - X axis: ageMonths 0–24 (continuous)
  - Y axis: weight in kg (toggle to lb in the UI)
  - Five reference curves (P3 / P15 / P50 / P85 / P97) from `percentileBands`, light grey, labeled at the right edge
  - One bold "Anay" series from `weight_events`, dots + line
  - Header subtitle: "Anay is currently at the {pct}th percentile for weight" (computed via `weightPercentile(latestEvent.ageMonths, latestEvent.weightKg)`)
- [ ] `src/app/(app)/growth/page.tsx`: server component — fetch all `weight_events` for the active baby, hand to `GrowthChart`. Renders the chart, the current percentile readout, and a `WeightLogForm` at the bottom for capturing a new reading.
- [ ] `src/app/(app)/settings/page.tsx` (modify Phase 2's index): four cards:
  - "Household" — day-start hour (0–23, default 4), timezone (default America/Chicago), household name → PATCH `/api/settings/household`
  - "Baby (Anay)" — name, DOB, birth weight, current weight → PATCH `/api/settings/baby`
  - "Caregivers" → link to `/settings/caregivers` (Phase 2)
  - "Voice tokens" → link to `/settings/voice` (Phase 2)
  Each save triggers a small toast and `router.refresh()`.

**Details:**
- **Why static WHO LMS coefficients?** A runtime API dependency would add latency, failure modes, and ToS risk. The published WHO Child Growth Standards data is small (~1 KB per table) and stable. Cite source URL in `who-growth.ts` for auditability.
- The percentile readout in the GrowthChart header should round to the nearest whole number ("42nd" not "42.187th"). Below the 1st or above the 99th: render as "below 1st" / "above 99th" rather than a misleading specific number.
- Updating `current_weight_oz` from settings refreshes the TodayCard target band on the next render (no extra plumbing needed — Phase 1's `targets.ts` reads the latest value).
- All times in form inputs use the household timezone; convert with `date-fns-tz`.

**Depends on:** Tasks 1 + 2 (settings + offline queue), Phase 2 audit util.

**Definition of Done:**
- `pnpm test src/lib/who-growth.test.ts` passes with known WHO checkpoints
- `/growth` plots P3/P15/P50/P85/P97 curves over 0–24 months and Anay's weight events as a bold series
- Header reads "Anay is currently at the Nth percentile for weight" (sensible number for a 19-day-old at ~7 lb)
- Logging a new weight via `WeightLogForm` adds a row to `weight_events`, updates `babies.current_weight_oz`, refreshes the chart, AND visibly shifts the TodayCard target band (band recomputes on the dashboard)
- Updating `day_start_hour` from 4 to 6 in settings → next page render uses the new 6am rollover (verify by logging an event at 5:30am local and seeing it count toward the previous day)
- Settings mutations are owner-only where appropriate (caregiver gets 403 attempting to change household name) but any caregiver can log a weight

---

### Task 4: Postpartum mom tab

**Estimated scope:** ~5 files, 2 endpoints, 2 components + 1 page
**Files touched:**
- `src/app/(app)/mom/page.tsx` (CREATE)
- `src/components/MomQuickLog.tsx` (CREATE)
- `src/components/MomEventList.tsx` (CREATE)
- `src/app/api/mom-events/route.ts` (CREATE)
- `src/app/api/mom-events/[id]/route.ts` (CREATE)

**Subtasks:**
- [ ] `POST /api/mom-events` (session): body `{ occurred_at, kind: 'medication' | 'mood' | 'note' | 'pump_only', payload }`. Within `withUserContext`:
  - For `medication`: payload `{ name, dose_mg?, note? }` (validated by Zod)
  - For `mood`: payload `{ score: 1..5, note? }`
  - For `note`: payload `{ text }`
  - For `pump_only`: payload `{ duration_min, volume_oz?, side? }` (this is mom-side pumping data she wants to track separately from baby feeds — does NOT affect baby's intake target)
  - INSERT into `mom_events` with `user_id = caller.user_id`. RLS policy `mom_events_self` ensures only she sees her own rows on subsequent reads. Writes audit row.
- [ ] `PATCH/DELETE /api/mom-events/[id]`: edit / delete own rows only. Audit row on each.
- [ ] `src/components/MomQuickLog.tsx` (client): three large cards (mobile-first):
  - "Pain med" → modal: name (free text or picker for common postpartum meds: Tylenol, ibuprofen, oxycodone, stool softener), dose, time (default now), note
  - "Mood" → 5-button 1-to-5 scale with emoji faces, optional note
  - "Note" → single textarea, time default now
  - Optional 4th: "Pump-only" → minutes, volume_oz, side — for nights when she pumped but baby didn't directly nurse
- [ ] `src/components/MomEventList.tsx` (client): chronological feed of her own events, grouped by day, edit/delete affordances. Same shape as Phase 2 EventList but reads `mom_events`.
- [ ] `src/app/(app)/mom/page.tsx`: server component — fetch `mom_events` for the caller (RLS does the filtering — caller's own rows only). Layout:
  - Heading: "{owner_display_name}'s notes" (e.g., "Mom's notes")
  - `MomQuickLog` quick-action cards at the top
  - `MomEventList` of last 30 days below
  - Small footer: "Only you can see this tab — your partner does not see your entries."

**Details:**
- **Privacy is the headline.** RLS enforces it at the DB level (policy from Phase 1's migration); the UI also surfaces the privacy reassurance in the footer because the user explicitly wanted "no one else sees this."
- **Don't double-count pumping.** `pump_only` events go to `mom_events`, not `feed_events`. If the mom actually fed the baby with that pumped milk later, she logs that separately as a `feed_events kind='pumped'` from FeedForm. Document this distinction in a tooltip on the pump card.
- **No medical interpretation.** Show what she logs back to her, don't suggest dose timings, don't compute "max daily acetaminophen". The product position is data capture, not pharmacology. Keep the same "Not medical advice" disclaimer at page footer.

**Depends on:** Phase 2 audit util.

**Definition of Done:**
- Mom logs a medication → row appears in her `MomEventList` on her phone
- Open the same household as Dad on a separate device → `/mom` shows Dad's own (empty) tab, NOT Mom's medications. RLS verified.
- Edit a mood entry → row updates, audit row written
- Delete a note → row gone, audit row written
- Privacy footer is visible on every load of `/mom`

## Testing Strategy

### Test 1: `who-growth.test.ts` (math correctness)

**File:** `src/lib/who-growth.test.ts` (create)

- [ ] WHO checkpoints at 0, 3, 6, 12, 24 months for boys at P50 within ±2 percentile
- [ ] Extreme inputs (very low / very high weight) return sensible Z-scores
- [ ] `percentileBands` is consistent with `weightPercentile` (inverse round-trip within 1%)

**Approach:** unit, no DB

### Test 2: Offline queue replay

**File:** `src/lib/offline-queue.test.ts` (create)

- [ ] Enqueue 5 entries → `peekAll().length === 5`
- [ ] Ack one → 4 remaining
- [ ] Re-open a fresh DB connection → entries persist
- [ ] Quota-exceeded simulation (mock IDB to throw) → enqueue rejects without losing prior entries

**Approach:** unit with `fake-indexeddb` (dev dep) so the test runs in node

### Test 3: RLS isolation for `mom_events` (security checklist)

Manual integration test against a real test Postgres:

- [ ] As Mom (user_id A), INSERT a mom_event → visible in SELECT
- [ ] As Dad (user_id B, same household), SELECT from mom_events → returns zero rows (NOT Mom's)
- [ ] As Dad, attempt PATCH on Mom's row by id → zero rows affected

### Test 4: Manual PWA smoke (PLAN.md §"Verification — After Week 3")

- [ ] Add to Home Screen on Chrome Android → standalone launch with correct icon and theme color
- [ ] Add to Home Screen on iOS Safari → standalone launch with apple-touch-icon
- [ ] Airplane mode → log a feed → reconnect → row syncs, no duplicates
- [ ] Set `current_weight_oz` in settings → TodayCard target updates
- [ ] Log nothing all day, time = 8pm local → InsightBanner shows low-pee + low-intake (insights from Phase 1 task 4 still working)
- [ ] Log medication in mom tab → visible only in Mom's view; Dad's `/mom` shows empty

## Validation Commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build

# Verify service worker built
ls -lh public/sw.js   # should exist after build

# Verify manifest serves
curl -s http://localhost:3000/manifest.webmanifest | head
```

Lighthouse audit (run against a deployed preview):

```bash
# Chrome DevTools → Lighthouse → PWA category, mobile profile
# Expected: PWA installable ✓, valid icons ✓, valid manifest ✓, service worker ✓
```

## Integration Notes

- **Connects to Phase 1:** `InsightBanner` from Phase 1 Task 4 is reused; Task 2 just composes one additional `kind: 'offline_queue_pending'` insight. No changes to `insights.ts` math.
- **Connects to Phase 2:** Settings page expands the placeholder created in Phase 2 Task 1 (which only had a Caregivers link). Settings/voice link is preserved. EventList from Phase 2 Task 3 is modified to merge IndexedDB queue entries.
- **Breaking changes:** EventList signature changes to accept an optional `queuedEntries` prop. Default is `[]` so existing call sites still work.
- **Documentation updates:** Add three sections to `README.md`:
  - "Installing as an app" — iOS + Android steps
  - "Offline support" — what works offline, what doesn't (read works for cached pages; writes queue; Realtime is dropped while offline and reconnects automatically)
  - "Privacy: Mom tab" — single paragraph clarifying that postpartum entries are visible only to the author
- **Things explicitly NOT in Phase 3 (per PLAN.md "Explicitly Deferred"):**
  - Sleep tracking (v1.1)
  - Push notifications (PWA push on iOS is partial; we use inline insights only — Phase 1 already covers the messaging)
  - Length-for-age + head-circumference growth curves (scaffold in `who-growth.ts` but not surfaced)
  - Health bridge `GET /api/health-export` — deferred post-MVP
  - Android-native, Alexa, Google Assistant, smart bottles, multi-tenant signup
  - Photo attachments on diaper events
  - Reorderable activity buttons
