# Phase Progress: phase-2-multi-caregiver-voice

**Plan:** `plans/phase-2-multi-caregiver-voice.md`
**Started:** 2026-05-18
**Execution mode:** 4 single-pass tasks, no pre-emptive split (user-decided). `⟂ SPLIT` markers are a recovery fallback only.
**Hard gate:** Task 1 `pnpm test:integration` must be green before Task 2. RLS isolation failure ⇒ Phase 1 regression ⇒ STOP + escalate.

## Task Progress

- [x] Task 1: Pre-flight gate — integration harness + P0 RLS isolation — **COMPLETED** (commit `c16655e`, branch `phase-2-task-1-integration-harness`). Gate GREEN: `test:integration` 12 passed (8 RLS R1 + 4 idempotency); unit 57/DB-free; no Phase 1 regression.
- [x] Task 2: Caregiver identity — invites, peer-recovery, recovery codes, settings, audit wiring — **COMPLETED** (commit `7fcfe3b`). `test:integration` 23/23 (incl. R10 peer-recovery 6 + recovery-code 5); unit 57; §11.5 verbatim + fail-safe; service-role cap intact; `0002_rate_limits.sql` applied.

### Orchestration notes
- **Branch strategy:** all Phase 2 tasks commit on `phase-2-task-1-integration-harness` (de-facto phase branch) so the dependency chain (T2 needs T1 harness; T3 needs T2 settings; T4 needs T2 audit) is satisfied. `main` untouched until phase end. Rename/merge to `main` is a phase-exit step.
- **Parallel-tab UI work (DO NOT TOUCH):** ~15 uncommitted working-tree files from another tab's Phase 1 dashboard polish (`page.tsx`, `layout.tsx`, `globals.css`, `QuickLogBar`, `TodayCard`, `FeedForm`, `DiaperForm`, `InsightBanner`, `ui/*`, `onboarding/page.tsx`, `log/*`). Every sub-agent stages ONLY its task's explicit files (`git add <paths>`, never `git add -A`/`.`). Tasks 2–3 have no overlap. **Task 4 collides on `TodayCard.tsx` + `(app)/layout.tsx`** — resolve parallel work before Task 4.
- [x] Task 3: Siri voice — bearer auth + API tokens — **COMPLETED** (commit `6f3b8e3`). `api-token.ts` mint/verify/revoke (verify via `withAdmin` pre-session conduit — no 3rd service-role file; mint/revoke RLS-bound); `with-auth.ts` bearer branch fail-closed (dead bearer ⇒ 401, no cookie fallback); `/api/voice` legacy adapter (server-side `client_uuid` fallback); `/api/tokens` + `/api/tokens/[id]`; `/settings/voice` + `VoiceTokensPanel`. `pnpm typecheck` + `pnpm lint` clean. Manual-only DoD outstanding: live `curl /api/events` fresh/wrong/revoked-token matrix + real-iPhone "Hey Siri" smoke (needs running server + device).
- [ ] Task 4: Realtime + History + IntakeDonut + Pediatrician PDF — IN PROGRESS
