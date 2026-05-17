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
