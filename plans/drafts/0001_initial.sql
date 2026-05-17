-- =============================================================================
-- DRAFT — Phase 1 Task 2 migration, pre-implementation review copy
-- =============================================================================
--
-- This file is not yet wired into Drizzle. When Task 2 starts, the implementer
-- should review this draft against TECHNICAL_SPEC §3.1–§3.4 and PLAN.md §"Data
-- Model", apply any review feedback, then copy the final file to
-- src/lib/db/migrations/0001_initial.sql.
--
-- Hand-authored because drizzle-kit does not emit RLS policies. The DDL half
-- should round-trip with `pnpm db:generate` (after schema.ts exists); the RLS /
-- index half stays hand-authored forever.
--
-- Apply order: extensions → tables (dep order) → indexes → helpers → RLS.
-- Wrapped in a single transaction so a failure leaves the DB untouched.
--
-- Risks this file is the load-bearing mitigation for:
--   R1 (cross-household data leak): RLS on every household-scoped table. App
--      code bypassing withUserContext is a P0 bug, but Postgres still blocks
--      the read with no GUC set.
--   R5 (peer-recovery hostile lockout): the asymmetric-authority rule lives in
--      app code (accept handler), but the at-most-one-outstanding-invite-per-
--      target invariant lives here as a partial unique index.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

-- =============================================================================
-- 1. AUTH TABLES
-- =============================================================================
-- users and sessions are intentionally NOT RLS'd — cookie/token resolution is
-- a pre-auth lookup (we don't yet know who the user is). The access boundary
-- is the parameterized SELECT by token_hash plus the secret in the cookie.

CREATE TABLE users (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   text NOT NULL,
  device_label text,
  expires_at   timestamptz NOT NULL,
  last_seen_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sessions_token_hash_idx ON sessions(token_hash);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);

-- =============================================================================
-- 2. HOUSEHOLDS, MEMBERSHIP, BABY
-- =============================================================================

CREATE TABLE households (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  day_start_hour smallint NOT NULL DEFAULT 4 CHECK (day_start_hour BETWEEN 0 AND 23),
  timezone       text NOT NULL DEFAULT 'America/Chicago',
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE household_members (
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         text NOT NULL CHECK (role IN ('owner', 'caregiver')),
  display_name text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, user_id)
);
-- current_user_households() filters by user_id on every RLS-evaluated row;
-- this index keeps that lookup O(log n).
CREATE INDEX household_members_user_id_idx ON household_members(user_id);

CREATE TABLE babies (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id      uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name              text NOT NULL,
  birth_date        date NOT NULL,
  birth_weight_oz   numeric(5,1),
  current_weight_oz numeric(5,1),
  weight_updated_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX babies_household_id_idx ON babies(household_id);

-- =============================================================================
-- 3. INVITES, RECOVERY CODES, API TOKENS
-- =============================================================================

CREATE TABLE invites (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id   uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  token_hash     text NOT NULL,
  role           text NOT NULL DEFAULT 'caregiver' CHECK (role IN ('owner', 'caregiver')),
  display_name   text,
  target_user_id uuid REFERENCES users(id),  -- non-null => peer-recovery re-link
  expires_at     timestamptz NOT NULL,
  accepted_at    timestamptz,
  accepted_by    uuid REFERENCES users(id),
  created_by     uuid NOT NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX invites_token_hash_idx ON invites(token_hash);
-- At most one outstanding peer-recovery invite per target user. The Phase 2
-- /api/access-links endpoint relies on this to reject duplicate mints.
CREATE UNIQUE INDEX invites_active_target_idx ON invites(target_user_id)
  WHERE target_user_id IS NOT NULL AND accepted_at IS NULL;

CREATE TABLE recovery_codes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  code_hash    text NOT NULL,
  rotated_at   timestamptz,
  used_at      timestamptz,
  used_from_ip text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX recovery_codes_code_hash_idx ON recovery_codes(code_hash);
-- At most one active recovery code per user. Rotation sets rotated_at;
-- redemption sets used_at — both move the row out of this partial index and
-- free the slot for a fresh code.
CREATE UNIQUE INDEX recovery_codes_active_user_idx ON recovery_codes(user_id)
  WHERE rotated_at IS NULL AND used_at IS NULL;

CREATE TABLE api_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  token_hash   text NOT NULL,
  label        text,
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX api_tokens_token_hash_idx ON api_tokens(token_hash);
CREATE INDEX api_tokens_user_id_idx ON api_tokens(user_id);

-- =============================================================================
-- 4. BABY EVENT TABLES
-- =============================================================================

CREATE TABLE weight_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  baby_id     uuid NOT NULL REFERENCES babies(id) ON DELETE CASCADE,
  logged_by   uuid NOT NULL REFERENCES users(id),
  occurred_at timestamptz NOT NULL,
  weight_oz   numeric(5,1) NOT NULL,
  note        text,
  source      text NOT NULL DEFAULT 'app',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX weight_events_baby_time ON weight_events(baby_id, occurred_at DESC);

CREATE TABLE feed_events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  baby_id               uuid NOT NULL REFERENCES babies(id) ON DELETE CASCADE,
  logged_by             uuid NOT NULL REFERENCES users(id),
  occurred_at           timestamptz NOT NULL,
  kind                  text NOT NULL CHECK (kind IN ('nursing', 'pumped', 'formula')),
  side                  text CHECK (side IN ('left', 'right', 'both')),
  duration_min          smallint,
  volume_oz             numeric(4,1),
  wasted_oz             numeric(4,1),
  estimated_oz          numeric(4,1) NOT NULL,  -- precomputed; daily totals = SUM(estimated_oz)
  note                  text,
  source                text NOT NULL DEFAULT 'app',
  client_uuid           uuid NOT NULL UNIQUE,    -- row-level idempotency
  corroborating_sources jsonb,                   -- multi-source merge (Siri + smart bottle, etc.)
  locked_at             timestamptz,             -- set on manual edit; merge window skips locked rows
  created_at            timestamptz NOT NULL DEFAULT now(),
  -- Variant invariant: nursing rows carry side+duration; bottle rows carry volume.
  CHECK (
    (kind = 'nursing'              AND duration_min IS NOT NULL AND side IS NOT NULL)
    OR (kind IN ('pumped','formula') AND volume_oz    IS NOT NULL)
  )
);
CREATE INDEX feed_events_baby_time ON feed_events(baby_id, occurred_at DESC);

CREATE TABLE diaper_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  baby_id     uuid NOT NULL REFERENCES babies(id) ON DELETE CASCADE,
  logged_by   uuid NOT NULL REFERENCES users(id),
  occurred_at timestamptz NOT NULL,
  pee         boolean NOT NULL DEFAULT false,
  poop        boolean NOT NULL DEFAULT false,
  note        text,
  source      text NOT NULL DEFAULT 'app',
  client_uuid uuid NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Matches the InboundEvent Zod refinement: at least one is true.
  CHECK (pee OR poop)
);
CREATE INDEX diaper_events_baby_time ON diaper_events(baby_id, occurred_at DESC);

CREATE TABLE mom_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  occurred_at  timestamptz NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('medication', 'mood', 'note', 'pump_only')),
  payload      jsonb,
  source       text NOT NULL DEFAULT 'app',
  client_uuid  uuid NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mom_events_user_time ON mom_events(user_id, occurred_at DESC);

-- =============================================================================
-- 5. CROSS-CUTTING (idempotency ledger, outbox, audit)
-- =============================================================================

CREATE TABLE inbound_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source             text NOT NULL,
  client_uuid        uuid NOT NULL,
  source_event_id    text,
  household_id       uuid REFERENCES households(id) ON DELETE CASCADE,
  user_id            uuid REFERENCES users(id) ON DELETE SET NULL,
  resulting_event_id uuid,
  resulting_table    text CHECK (resulting_table IN ('feed_events', 'diaper_events', 'mom_events', 'weight_events')),
  raw                jsonb NOT NULL,
  status             text NOT NULL CHECK (status IN ('accepted', 'duplicate', 'merged', 'rejected')),
  error              text,
  received_at        timestamptz NOT NULL DEFAULT now()
);
-- THE idempotency contract: a duplicate (source, client_uuid) is replayed as
-- a no-op returning the original resulting_event_id. recordEvent depends on
-- the ON CONFLICT path against this index.
CREATE UNIQUE INDEX inbound_events_dedupe_idx ON inbound_events(source, client_uuid);
CREATE INDEX inbound_events_household_time ON inbound_events(household_id, received_at DESC);

-- event_outbox is worker-only; reached via service role. No RLS, no app reads.
CREATE TABLE event_outbox (
  id             bigserial PRIMARY KEY,
  topic          text NOT NULL,
  payload        jsonb NOT NULL,
  processed_at   timestamptz,
  failed_at      timestamptz,
  failure_reason text,
  attempts       int NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX event_outbox_unprocessed_idx ON event_outbox(created_at) WHERE processed_at IS NULL;

CREATE TABLE event_audit (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  household_id  uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  kind          text NOT NULL,
  entity_table  text,
  entity_id     uuid,
  before        jsonb,
  after         jsonb,
  ip            text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX event_audit_household_time ON event_audit(household_id, created_at DESC);
CREATE INDEX event_audit_entity ON event_audit(entity_table, entity_id);

-- =============================================================================
-- 6. RLS HELPERS
-- =============================================================================
-- The GUC `request.user_id` is set by withUserContext(userId, fn) inside a
-- transaction via set_config('request.user_id', $1, true). An empty/unset GUC
-- resolves to NULL, which makes every RLS predicate false — that's the right
-- default for an unauthenticated query.

CREATE OR REPLACE FUNCTION current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.user_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION current_user_households() RETURNS SETOF uuid
LANGUAGE sql STABLE AS $$
  SELECT household_id FROM household_members
  WHERE user_id = current_user_id();
$$;

-- =============================================================================
-- 7. ROW LEVEL SECURITY
-- =============================================================================
-- RLS is ENABLED on every household-scoped or per-user app table. Intentionally
-- NOT RLS'd: users, sessions (pre-auth lookups), event_outbox (worker-only).

ALTER TABLE households        ENABLE ROW LEVEL SECURITY;
ALTER TABLE household_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE babies            ENABLE ROW LEVEL SECURITY;
ALTER TABLE weight_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE diaper_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE mom_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE invites           ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_tokens        ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_codes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbound_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_audit       ENABLE ROW LEVEL SECURITY;

-- ---- household scope ------------------------------------------------------

CREATE POLICY households_member ON households FOR ALL
  USING      (id IN (SELECT current_user_households()))
  WITH CHECK (id IN (SELECT current_user_households()));

CREATE POLICY household_members_member ON household_members FOR ALL
  USING      (household_id IN (SELECT current_user_households()))
  WITH CHECK (household_id IN (SELECT current_user_households()));

CREATE POLICY babies_member ON babies FOR ALL
  USING      (household_id IN (SELECT current_user_households()))
  WITH CHECK (household_id IN (SELECT current_user_households()));

-- ---- baby event tables ----------------------------------------------------

CREATE POLICY weight_events_household ON weight_events FOR ALL
  USING      (baby_id IN (SELECT id FROM babies WHERE household_id IN (SELECT current_user_households())))
  WITH CHECK (baby_id IN (SELECT id FROM babies WHERE household_id IN (SELECT current_user_households())));

CREATE POLICY feed_events_household ON feed_events FOR ALL
  USING      (baby_id IN (SELECT id FROM babies WHERE household_id IN (SELECT current_user_households())))
  WITH CHECK (baby_id IN (SELECT id FROM babies WHERE household_id IN (SELECT current_user_households())));

CREATE POLICY diaper_events_household ON diaper_events FOR ALL
  USING      (baby_id IN (SELECT id FROM babies WHERE household_id IN (SELECT current_user_households())))
  WITH CHECK (baby_id IN (SELECT id FROM babies WHERE household_id IN (SELECT current_user_households())));

-- mom_events: STRICTLY self. Partner cannot see mom's medication entries.
-- WITH CHECK on insert prevents caregiver A from forging a mom_event for B.
CREATE POLICY mom_events_self ON mom_events FOR ALL
  USING      (user_id = current_user_id())
  WITH CHECK (user_id = current_user_id());

-- ---- invites --------------------------------------------------------------
-- SELECT/UPDATE/DELETE: any household member (needed by /settings/caregivers
-- list + revoke). INSERT is split into two PERMISSIVE policies (OR'd):
--   (a) peer-recovery: any active member can mint a link for a co-member
--   (b) new-caregiver: only the owner can mint a target-less invite
-- This matches the asymmetric-authority invariant (PLAN.md §"Knock-on changes
-- #5"). The "additive-only when caregiver-issued" half of that invariant
-- lives in the accept handler, not here.

CREATE POLICY invites_household_read ON invites FOR SELECT
  USING (household_id IN (SELECT current_user_households()));

CREATE POLICY invites_household_update ON invites FOR UPDATE
  USING      (household_id IN (SELECT current_user_households()))
  WITH CHECK (household_id IN (SELECT current_user_households()));

CREATE POLICY invites_household_delete ON invites FOR DELETE
  USING (household_id IN (SELECT current_user_households()));

CREATE POLICY invites_peer_recovery_insert ON invites FOR INSERT
  WITH CHECK (
    target_user_id IS NOT NULL
    AND household_id IN (SELECT current_user_households())
    AND target_user_id IN (
      SELECT user_id FROM household_members
      WHERE household_id IN (SELECT current_user_households())
    )
  );

CREATE POLICY invites_owner_new_caregiver_insert ON invites FOR INSERT
  WITH CHECK (
    target_user_id IS NULL
    AND household_id IN (
      SELECT household_id FROM household_members
      WHERE user_id = current_user_id() AND role = 'owner'
    )
  );

-- ---- per-user secrets -----------------------------------------------------

CREATE POLICY api_tokens_self ON api_tokens FOR ALL
  USING      (user_id = current_user_id())
  WITH CHECK (user_id = current_user_id());

CREATE POLICY recovery_codes_self ON recovery_codes FOR ALL
  USING      (user_id = current_user_id())
  WITH CHECK (user_id = current_user_id());

-- ---- cross-cutting --------------------------------------------------------

CREATE POLICY inbound_events_household ON inbound_events FOR ALL
  USING      (household_id IN (SELECT current_user_households()))
  WITH CHECK (household_id IN (SELECT current_user_households()));

CREATE POLICY event_audit_household_read ON event_audit FOR SELECT
  USING (household_id IN (SELECT current_user_households()));

CREATE POLICY event_audit_household_insert ON event_audit FOR INSERT
  WITH CHECK (household_id IN (SELECT current_user_households()));

-- event_audit is append-only by contract — no UPDATE/DELETE policies on
-- purpose. App code that needs to "correct" an audit row should insert a new
-- one (e.g. kind = 'audit.corrected').

COMMIT;
