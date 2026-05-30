# Siri Shortcut recipes — source of truth

These markdown files are the **canonical recipe** for the six hand-built iOS
Shortcuts (PLAN.md "One Shortcut per phrase", Phase 2 Task 2). The Shortcuts are
built by hand in the iOS Shortcuts app and exported to the user's iCloud Drive;
the exported `.shortcut` binaries are **not** committed (`.gitignore` excludes
`*.shortcut`). If a recipe here and a built Shortcut disagree, **this file wins**
— rebuild the Shortcut to match.

> Status: Phase 2 deliverable. `who-growth.ts` aside, these are the only other
> parallel-safe artifact written ahead of Phase 2 because they depend solely on
> the **frozen** `InboundEvent` contract (CLAUDE.md §5.1), not on any code.

---

## Common request shape

Every Shortcut makes one `POST` and speaks the response back. The only thing
that differs between Shortcuts is the `event` object in the body.

**Endpoint**

```
POST  {NEXT_PUBLIC_APP_URL}/api/events
```

**Headers** (all six, every time)

| Header | Value |
|---|---|
| `Authorization` | `Bearer {API_TOKEN}` |
| `Content-Type` | `application/json` |
| `X-Requested-With` | `fetch` |

`/api/events` is bearer-authed and therefore **exempt from the CSRF
Origin check** (CLAUDE.md §13) — Shortcuts only need the bearer token.

**Body** (the envelope; `event` is filled in per recipe)

```json
{
  "client_uuid": "<fresh UUID v4 per run>",
  "source": "siri_shortcut",
  "occurred_at": "<ISO 8601, current time>",
  "event": { ... },
  "note": "<optional, omit if empty>"
}
```

`baby_id` is intentionally omitted — the server resolves the active baby from
the token's household.

**Response** — always `{ ok, event_id, say }` (or `{ ok: false, ..., say }`).
The Shortcut's final action shows / speaks the **`say`** string. `say` is
always present, even on error ("Sorry, that didn't work."), so Siri always has
something to read.

---

## One-time setup (the user, on iPhone)

1. Open the app → **Settings → Voice tokens** (`/settings/voice`, Phase 2 Task 2).
2. **Generate new token**, copy the raw value (shown **once**).
3. In each Shortcut, store it in a **Text** action at the top named `API_TOKEN`,
   and a second **Text** action `APP_URL` = your `NEXT_PUBLIC_APP_URL`
   (e.g. `https://<your-domain>`). Reference these in the Get Contents of URL
   action so a token rotation is a one-line edit.
4. Revoking a token in Settings instantly kills every Shortcut using it — by
   design.

---

## The `client_uuid` step (the one fiddly bit)

`client_uuid` **must be a fresh UUID v4 on every run** — it is the idempotency
key (CLAUDE.md §3.5). The server enforces `(source, client_uuid)` UNIQUE, so a
re-run with the same value returns `status: duplicate` with the *same* `say`
(safe, but it won't log twice). A constant UUID (e.g. device ID) would make
**every** call after the first a no-op — do not do that.

iOS Shortcuts has no first-class "Generate UUID" action. Recommended, in order:

1. **Run JavaScript on Web Page** (if your Shortcut already opens a web view):
   `completion(crypto.randomUUID())`. Most reliable.
2. **Composed v4** with native actions only (offline, private): concatenate
   `Random Number` hex segments into the `8-4-4-4-12` shape with the version
   nibble set to `4` and the variant nibble to `8/9/a/b`. More actions, no
   dependency.
3. **Fallback:** POST to `/api/voice` instead of `/api/events` — the legacy
   adapter (Phase 2 Task 2) generates a `client_uuid` server-side if absent.
   You lose client-side replay safety on flaky cell connections; acceptable for
   a low-frequency manual Shortcut.

Validate the chosen method on-device when the Shortcuts are actually built in
Phase 2 — these docs are the recipe, not an on-device guarantee.

---

## Reliability: "network connection was lost" (-1005)

Symptom: a Shortcut occasionally fails with **"The network connection was
lost"** even though the URL and token are correct.

**Cause — cold start, not a broken setup.** Vercel's free tier idles the
serverless function after a few minutes. The next call pays a cold start
(function boot + a fresh TLS connection to the Supabase pooler), which on a
flaky cell signal can exceed iOS's patience — Shortcuts reports `-1005`. Two
things make this confusing:

- **The write usually still succeeds server-side.** The server finishes and
  inserts the row; only the *response* fails to reach the phone. So a log can
  land even when Siri says it failed.
- iOS Shortcuts has **no try/catch**, so a Shortcut cannot catch `-1005` and
  auto-retry. The only retry is re-running by hand — which is a fresh run with
  a fresh `client_uuid`, so it would log a **second** row.

**Habit:** if you see `-1005`, glance at the dashboard before re-running. The
log probably went through.

**Fix — keep the function warm.** `GET /api/health`
(`src/app/api/health/route.ts`) runs a trivial `select 1` on the same runtime
pool a real write uses. Point a free uptime pinger at it every ~5 minutes so
the function and DB connection never go cold:

```
GET  {NEXT_PUBLIC_APP_URL}/api/health   →   { "ok": true, "db": "up" }
```

- Free pingers: [cron-job.org](https://cron-job.org) or
  [UptimeRobot](https://uptimerobot.com) — 5-minute interval, GET, no auth.
- Vercel Cron is **not** a fit on the free (Hobby) tier — it's capped at
  roughly one run per day, too infrequent to keep anything warm.

Measured locally: a cold call took 6.5s, every warm call after ~0.05s — that
gap is the whole problem, and keep-warm closes it.

---

## Per-run testing (curl)

Swap in a real token + URL. Reuse the same `client_uuid` twice to prove
idempotency (second call → `status: duplicate`, identical `say`).

```bash
curl -X POST "$APP_URL/api/events" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Requested-With: fetch" \
  -d '{"client_uuid":"'"$(uuidgen)"'","source":"siri_shortcut","occurred_at":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","event":{"type":"diaper","pee":true,"poop":false}}'
# → { "ok": true, "event_id": "...", "say": "Logged. 3 wet diapers today." }
```

---

## Recommended: one hands-free Shortcut

Before building the six per-phrase Shortcuts below, consider the single
[`log-baby.shortcut.md`](./log-baby.shortcut.md): one Shortcut, you say
"Hey Siri, Log baby" then speak the phrase ("poop", "two ounces of
formula"). The server parses it (`src/lib/spoken-log-parser.ts`) and
generates the `client_uuid` for you, so there is **no UUID step** and no
per-event Dictionary — it posts `{ "text": "<what you said>" }` to
`/api/voice`. The six dedicated phrases below remain valid if you'd rather
say "Log a poop" directly.

## The six Shortcuts

| File | Siri phrase (suggested) | `event` payload |
|---|---|---|
| [`log-pee.shortcut.md`](./log-pee.shortcut.md) | "Log a pee" | diaper, pee only |
| [`log-poop.shortcut.md`](./log-poop.shortcut.md) | "Log a poop" | diaper, poop only |
| [`log-dirty-diaper.shortcut.md`](./log-dirty-diaper.shortcut.md) | "Log a dirty diaper" | diaper, pee + poop |
| [`log-formula.shortcut.md`](./log-formula.shortcut.md) | "Log formula" | feed, formula, volume |
| [`log-pumped.shortcut.md`](./log-pumped.shortcut.md) | "Log pumped milk" | feed, pumped, volume |
| [`log-nursing.shortcut.md`](./log-nursing.shortcut.md) | "Log nursing" | feed, nursing, side + minutes |

The `iCloud share URL` slot in each file is filled in by the user after they
upload the built `.shortcut` to iCloud Drive; the Voice settings page
(`/settings/voice`) interpolates these into `shortcuts://import-shortcut/?url=…`
deep links.
