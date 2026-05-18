# Newborn Tracker

A PWA for logging feeds, diapers, and weight for a single newborn, with a dashboard that answers _"is baby getting enough today?"_ using age-adjusted intake targets. Multi-caregiver with per-device sessions. Free in Phase 1.

For product context read [`PLAN.md`](./PLAN.md), for engineering details read [`TECHNICAL_SPEC.md`](./TECHNICAL_SPEC.md), for user stories and acceptance bars read [`PRD.md`](./PRD.md), and for the always-on coding rules read [`CLAUDE.md`](./CLAUDE.md). Per-phase implementation plans live in [`plans/`](./plans/).

## Tech stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript** (strict)
- **Tailwind CSS 4** + **shadcn/ui**
- **Supabase** (Postgres + Realtime + RLS) accessed via **Drizzle ORM** on the `postgres-js` driver
- **Zod** for schema validation, **react-hook-form** for forms
- **Vitest** for unit tests
- **pnpm** (use `pnpm@11` or newer)

## Prerequisites

- macOS / Linux / Windows with WSL
- **Node.js 20 LTS or newer** — install from [nodejs.org](https://nodejs.org)
- **pnpm 11+** — install via `curl -fsSL https://get.pnpm.io/install.sh | sh -`
- **git**
- A free [Supabase](https://supabase.com) account (one project per environment — `newborn-dev` for development)

## Local development

```bash
# 1. Install dependencies
pnpm install

# 2. Copy the env template
cp .env.example .env.local
# Then open .env.local and fill in your Supabase URL + keys
# (Dashboard → Project Settings → API)

# 3. Apply database migrations (once schema lands in Phase 1 Task 2)
pnpm db:migrate

# 4. Seed local data (idempotent)
pnpm db:seed

# 5. Start the dev server
pnpm dev
```

Open <http://localhost:3000>.

## Supported browsers

The web app runs in any modern browser. Phase 1 logging is tested in:

- Latest 2 versions of **Chrome** (desktop + Android)
- Latest 2 versions of **Safari** (macOS + iOS)
- Latest 2 versions of **Edge**
- Latest 2 versions of **Firefox**

Only the Siri Shortcuts integration (Phase 2) is iPhone-only.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Start dev server on http://localhost:3000 |
| `pnpm build` | Production build sanity check |
| `pnpm start` | Run the production build locally |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript without emitting files |
| `pnpm test` | Vitest unit suite |
| `pnpm test:watch` | Vitest in watch mode |
| `pnpm db:generate` | Generate Drizzle migration SQL from `src/lib/db/schema.ts` |
| `pnpm db:migrate` | Apply pending migrations in `src/lib/db/migrations/` |
| `pnpm db:seed` | Seed the database with the locked-in development data |

## Project layout

```
src/
├── app/             # Next.js App Router pages, layouts, API routes
├── components/      # UI components (shadcn primitives under components/ui)
├── lib/             # Domain logic (record-event, targets, day-window, insights, ...)
│   └── db/          # Drizzle schema + client + migrations + seed
├── middleware.ts    # CSRF + session resolve (Phase 1 Task 2)
```

See [`CLAUDE.md` §3](./CLAUDE.md) for the load-bearing architecture rules — particularly that `recordEvent()` is the single write path.

## Enable Supabase Realtime (one-time)

Phase 2 keeps every signed-in device in sync: when one phone logs a feed
or diaper, the others' dashboard/history refresh within ~2 seconds. This
needs the two event tables added to Supabase's Realtime publication.

Run once in the Supabase SQL editor (Dashboard → SQL):

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE feed_events, diaper_events;
```

The browser never receives a Supabase key with table access. It fetches a
short-lived (5-minute), household-scoped JWT from `/api/realtime-token`,
signed server-side with the Supabase **JWT secret**. Add it to
`.env.local`:

```bash
# Supabase Dashboard → Project Settings → API → JWT Settings → JWT secret.
# DISTINCT from SUPABASE_SERVICE_ROLE_KEY; only mints Realtime tokens.
SUPABASE_JWT_SECRET=
```

If `SUPABASE_JWT_SECRET` is unset, the app still works — devices simply
stop auto-refreshing (you can pull-to-refresh / reload). The route fails
cleanly with a log line telling the operator exactly where to find the
value.

## Invite a partner / recover a lost phone / Siri

**Invite a partner.** As the owner, go to **Settings → Caregivers →
Invite a caregiver**, enter a name, and share the one-time link. Your
partner opens it on their own phone, taps Join, and gets their own
session (no shared logins) seeing the same baby.

**Recover a lost phone.** Two ways back in:

- *Someone sends you an access link.* From **Settings → Caregivers**, any
  member taps **Send access link** next to your name and shares the URL.
  Open it on the new device to sign in. A caregiver-issued link is
  *additive* (your old sessions keep working); only an owner-issued — or
  a self-issued — link revokes your prior sessions (this asymmetry
  prevents a hostile lockout).
- *You use your recovery code.* Go to `/recover`, enter the
  `XXXX-XXXX-XXXX-XXXX` code you saved at onboarding (any case/spacing is
  accepted). It signs you in, revokes old sessions, and shows a fresh
  rotated code — save it. Rotate any time at **Settings → Recovery
  code**.

**Add Siri Shortcuts (iPhone only).** At **Settings → Siri voice**,
generate an API token (shown once — paste it into the Shortcuts). The six
hand-built Shortcuts in [`shortcuts/`](./shortcuts/) cover pee, poop,
dirty diaper, formula, pumped, and nursing. Once installed, "Hey Siri,
log a pee" creates the row and Siri reads back today's running total and
the informational target band.

## Pediatrician PDF

**Settings/links → Pediatrician summary** (`/export/pediatrician`) shows
an HTML preview of a single-page report — per-day feeding totals vs. the
informational target band, per-day wet/dirty counts, and any notes — with
a date-range picker and a **Download PDF** button. The PDF is free,
one page, and contains **no private mom notes** and **no caregiver
attribution** by design.

## Security and privacy

- Row Level Security enforced on every app table. App code may only touch app tables through `withUserContext`.
- The Supabase service role key is referenced in **exactly two files**: `src/lib/db/admin.ts` and `src/app/api/onboarding/create-household/route.ts`.
- No third-party analytics. No PII in logs or URLs.
- Postpartum mom events are private via RLS — visible only to their author.

## Deployment

Vercel, region `iad1` (lowest combined latency to Supabase us-east-1 + Houston, TX). See [`TECHNICAL_SPEC.md` §9](./TECHNICAL_SPEC.md) for the full deploy contract.

## Phase status

- **Phase 1** — core logging + cross-browser PWA UI (in progress)
- **Phase 2** — multi-caregiver invites, Siri voice, Realtime, pediatrician PDF (planned)
- **Phase 3** — installable PWA, offline queue, WHO growth chart, postpartum mom tab (planned)
