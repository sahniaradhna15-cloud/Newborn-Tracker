CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"label" text,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "babies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"birth_date" timestamp NOT NULL,
	"birth_weight_oz" numeric(5, 1),
	"current_weight_oz" numeric(5, 1),
	"weight_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diaper_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"baby_id" uuid NOT NULL,
	"logged_by" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"pee" boolean DEFAULT false NOT NULL,
	"poop" boolean DEFAULT false NOT NULL,
	"note" text,
	"source" text DEFAULT 'app' NOT NULL,
	"client_uuid" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diaper_events_presence_chk" CHECK ("diaper_events"."pee" OR "diaper_events"."poop")
);
--> statement-breakpoint
CREATE TABLE "event_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"household_id" uuid,
	"kind" text NOT NULL,
	"entity_table" text,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_outbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"topic" text NOT NULL,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"failure_reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feed_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"baby_id" uuid NOT NULL,
	"logged_by" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"side" text,
	"duration_min" smallint,
	"volume_oz" numeric(4, 1),
	"wasted_oz" numeric(4, 1),
	"estimated_oz" numeric(4, 1) NOT NULL,
	"note" text,
	"source" text DEFAULT 'app' NOT NULL,
	"client_uuid" uuid,
	"corroborating_sources" jsonb,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feed_events_kind_chk" CHECK ("feed_events"."kind" IN ('nursing', 'pumped', 'formula')),
	CONSTRAINT "feed_events_side_chk" CHECK ("feed_events"."side" IS NULL OR "feed_events"."side" IN ('left', 'right', 'both')),
	CONSTRAINT "feed_events_variant_chk" CHECK (("feed_events"."kind" = 'nursing' AND "feed_events"."duration_min" IS NOT NULL AND "feed_events"."side" IS NOT NULL) OR ("feed_events"."kind" IN ('pumped', 'formula') AND "feed_events"."volume_oz" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "household_members" (
	"household_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'caregiver' NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_members_household_id_user_id_pk" PRIMARY KEY("household_id","user_id"),
	CONSTRAINT "household_members_role_chk" CHECK ("household_members"."role" IN ('owner', 'caregiver'))
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"day_start_hour" smallint DEFAULT 4 NOT NULL,
	"timezone" text DEFAULT 'America/Chicago' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbound_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"client_uuid" uuid NOT NULL,
	"source_event_id" text,
	"household_id" uuid,
	"user_id" uuid,
	"resulting_event_id" uuid,
	"resulting_table" text,
	"raw" jsonb NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbound_events_status_chk" CHECK ("inbound_events"."status" IN ('accepted', 'duplicate', 'merged', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"role" text DEFAULT 'caregiver' NOT NULL,
	"display_name" text,
	"target_user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_role_chk" CHECK ("invites"."role" IN ('owner', 'caregiver'))
);
--> statement-breakpoint
CREATE TABLE "mom_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb,
	"source" text DEFAULT 'app' NOT NULL,
	"client_uuid" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mom_events_kind_chk" CHECK ("mom_events"."kind" IN ('medication', 'mood', 'note', 'pump_only'))
);
--> statement-breakpoint
CREATE TABLE "recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	"used_from_ip" text
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"device_label" text,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weight_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"baby_id" uuid NOT NULL,
	"logged_by" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"weight_oz" numeric(5, 1) NOT NULL,
	"note" text,
	"source" text DEFAULT 'app' NOT NULL,
	"client_uuid" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "babies" ADD CONSTRAINT "babies_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diaper_events" ADD CONSTRAINT "diaper_events_baby_id_babies_id_fk" FOREIGN KEY ("baby_id") REFERENCES "public"."babies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diaper_events" ADD CONSTRAINT "diaper_events_logged_by_users_id_fk" FOREIGN KEY ("logged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_audit" ADD CONSTRAINT "event_audit_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_audit" ADD CONSTRAINT "event_audit_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_events" ADD CONSTRAINT "feed_events_baby_id_babies_id_fk" FOREIGN KEY ("baby_id") REFERENCES "public"."babies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_events" ADD CONSTRAINT "feed_events_logged_by_users_id_fk" FOREIGN KEY ("logged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_events" ADD CONSTRAINT "inbound_events_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_events" ADD CONSTRAINT "inbound_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mom_events" ADD CONSTRAINT "mom_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mom_events" ADD CONSTRAINT "mom_events_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weight_events" ADD CONSTRAINT "weight_events_baby_id_babies_id_fk" FOREIGN KEY ("baby_id") REFERENCES "public"."babies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weight_events" ADD CONSTRAINT "weight_events_logged_by_users_id_fk" FOREIGN KEY ("logged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_tokens_token_hash_idx" ON "api_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "api_tokens_user_idx" ON "api_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "diaper_events_client_uuid_idx" ON "diaper_events" USING btree ("client_uuid") WHERE "diaper_events"."client_uuid" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "diaper_events_baby_time_idx" ON "diaper_events" USING btree ("baby_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "event_audit_household_time_idx" ON "event_audit" USING btree ("household_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "event_outbox_unprocessed_idx" ON "event_outbox" USING btree ("created_at") WHERE "event_outbox"."processed_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "feed_events_client_uuid_idx" ON "feed_events" USING btree ("client_uuid") WHERE "feed_events"."client_uuid" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "feed_events_baby_time_idx" ON "feed_events" USING btree ("baby_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "household_members_user_idx" ON "household_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_events_dedupe_idx" ON "inbound_events" USING btree ("source","client_uuid");--> statement-breakpoint
CREATE UNIQUE INDEX "invites_token_hash_idx" ON "invites" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "invites_active_target_idx" ON "invites" USING btree ("target_user_id") WHERE "invites"."target_user_id" IS NOT NULL AND "invites"."accepted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "mom_events_client_uuid_idx" ON "mom_events" USING btree ("client_uuid") WHERE "mom_events"."client_uuid" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "mom_events_user_time_idx" ON "mom_events" USING btree ("user_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_codes_code_hash_idx" ON "recovery_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_codes_active_user_idx" ON "recovery_codes" USING btree ("user_id") WHERE "recovery_codes"."rotated_at" IS NULL AND "recovery_codes"."used_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_idx" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "weight_events_client_uuid_idx" ON "weight_events" USING btree ("client_uuid") WHERE "weight_events"."client_uuid" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "weight_events_baby_time_idx" ON "weight_events" USING btree ("baby_id","occurred_at" DESC NULLS LAST);
--> statement-breakpoint

-- ============================================================
-- Row Level Security  (hand-authored — drizzle-kit does not emit RLS)
-- Mirrors the reviewed reference plans/drafts/0001_initial.sql and
-- TECHNICAL_SPEC §3.4, both corrected 2026-05-17.
--
-- request.user_id is a GUC bound per transaction by withUserContext():
--   SELECT set_config('request.user_id', '<uuid>', true)
-- Unset/empty GUC → NULL → every predicate is false (correct default
-- for an unauthenticated query).
--
-- VERIFICATION GATE (Task 1.2 / Task #11): whether these ENABLE-only
-- policies are actually enforced depends on the role the runtime
-- connection uses. If the Supabase pooled connection role owns the
-- tables, owner RLS-bypass would make policies a no-op — the RLS
-- isolation test (User A cannot SELECT User B's household) MUST be run
-- against the real project and pass before Task 1.2 is closed. If it
-- fails, the fix is a dedicated non-owner app role (preferred) — do
-- NOT reintroduce FORCE together with an owner-defined SECURITY DEFINER
-- helper, which would re-trip the recursion bug below.
-- ============================================================

CREATE OR REPLACE FUNCTION current_user_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('request.user_id', true), '')::uuid;
  $$;--> statement-breakpoint

-- MUST be SECURITY DEFINER. household_members has RLS enabled and its
-- own policy is expressed via this function. An invoker-rights version
-- would have its internal SELECT on household_members filtered by that
-- same policy, resolve to the empty set, and make every household-scoped
-- policy deny ALL rows — the app loads, user is logged in, but no data
-- ever appears (silent + catastrophic). SECURITY DEFINER makes this one
-- membership read bypass RLS and breaks the cycle. search_path pinned +
-- identifiers schema-qualified = standard hardening. DO NOT remove.
CREATE OR REPLACE FUNCTION current_user_households() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT household_id FROM public.household_members
    WHERE user_id = public.current_user_id();
  $$;--> statement-breakpoint

-- RLS ENABLED on every household-scoped or per-user app table.
-- Intentionally NOT RLS'd: users, sessions (read pre-auth to resolve
-- identity), event_outbox (worker-only, never app-read). Those three
-- are instead REVOKEd from Supabase's anon/authenticated roles at the
-- end so the auto PostgREST/Realtime API cannot expose token hashes or
-- raw payloads.

ALTER TABLE "households" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "household_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "babies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "weight_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "feed_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "diaper_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mom_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "api_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "recovery_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inbound_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_audit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- ---- household scope ----------------------------------------------
CREATE POLICY "households_member" ON "households" FOR ALL
  USING ("id" IN (SELECT current_user_households()))
  WITH CHECK ("id" IN (SELECT current_user_households()));--> statement-breakpoint

-- Safe via the helper ONLY because current_user_households() is
-- SECURITY DEFINER (no re-entrancy into this table's own policy). A
-- member sees all co-members of their household — needed for
-- /settings/caregivers + "logged by" attribution.
CREATE POLICY "household_members_member" ON "household_members" FOR ALL
  USING ("household_id" IN (SELECT current_user_households()))
  WITH CHECK ("household_id" IN (SELECT current_user_households()));--> statement-breakpoint

CREATE POLICY "babies_member" ON "babies" FOR ALL
  USING ("household_id" IN (SELECT current_user_households()))
  WITH CHECK ("household_id" IN (SELECT current_user_households()));--> statement-breakpoint

-- ---- baby event tables --------------------------------------------
CREATE POLICY "weight_events_household" ON "weight_events" FOR ALL
  USING ("baby_id" IN (SELECT "id" FROM "babies" WHERE "household_id" IN (SELECT current_user_households())))
  WITH CHECK ("baby_id" IN (SELECT "id" FROM "babies" WHERE "household_id" IN (SELECT current_user_households())));--> statement-breakpoint

CREATE POLICY "feed_events_household" ON "feed_events" FOR ALL
  USING ("baby_id" IN (SELECT "id" FROM "babies" WHERE "household_id" IN (SELECT current_user_households())))
  WITH CHECK ("baby_id" IN (SELECT "id" FROM "babies" WHERE "household_id" IN (SELECT current_user_households())));--> statement-breakpoint

CREATE POLICY "diaper_events_household" ON "diaper_events" FOR ALL
  USING ("baby_id" IN (SELECT "id" FROM "babies" WHERE "household_id" IN (SELECT current_user_households())))
  WITH CHECK ("baby_id" IN (SELECT "id" FROM "babies" WHERE "household_id" IN (SELECT current_user_households())));--> statement-breakpoint

-- mom_events: STRICTLY self. Partner cannot see mom's medication.
-- WITH CHECK on insert prevents caregiver A forging a row for B.
CREATE POLICY "mom_events_self" ON "mom_events" FOR ALL
  USING ("user_id" = current_user_id())
  WITH CHECK ("user_id" = current_user_id());--> statement-breakpoint

-- ---- invites ------------------------------------------------------
-- SELECT/UPDATE/DELETE: any household member. INSERT is two PERMISSIVE
-- (OR'd) policies: (a) peer-recovery — any member may mint a link for a
-- co-member; (b) new-caregiver — only the owner may mint a target-less
-- invite. Matches the asymmetric-authority invariant (the additive-only
-- half lives in the Phase 2 accept handler, not here).
CREATE POLICY "invites_household_read" ON "invites" FOR SELECT
  USING ("household_id" IN (SELECT current_user_households()));--> statement-breakpoint

CREATE POLICY "invites_household_update" ON "invites" FOR UPDATE
  USING ("household_id" IN (SELECT current_user_households()))
  WITH CHECK ("household_id" IN (SELECT current_user_households()));--> statement-breakpoint

CREATE POLICY "invites_household_delete" ON "invites" FOR DELETE
  USING ("household_id" IN (SELECT current_user_households()));--> statement-breakpoint

CREATE POLICY "invites_peer_recovery_insert" ON "invites" FOR INSERT
  WITH CHECK (
    "target_user_id" IS NOT NULL
    AND "household_id" IN (SELECT current_user_households())
    AND "target_user_id" IN (
      SELECT user_id FROM "household_members"
      WHERE "household_id" IN (SELECT current_user_households())
    )
  );--> statement-breakpoint

CREATE POLICY "invites_owner_new_caregiver_insert" ON "invites" FOR INSERT
  WITH CHECK (
    "target_user_id" IS NULL
    AND "household_id" IN (
      SELECT household_id FROM "household_members"
      WHERE user_id = current_user_id() AND role = 'owner'
    )
  );--> statement-breakpoint

-- ---- per-user secrets ---------------------------------------------
CREATE POLICY "api_tokens_self" ON "api_tokens" FOR ALL
  USING ("user_id" = current_user_id())
  WITH CHECK ("user_id" = current_user_id());--> statement-breakpoint

CREATE POLICY "recovery_codes_self" ON "recovery_codes" FOR ALL
  USING ("user_id" = current_user_id())
  WITH CHECK ("user_id" = current_user_id());--> statement-breakpoint

-- ---- cross-cutting ------------------------------------------------
-- Scoped by user_id, NOT the nullable household_id. recordEvent INSERTs
-- the inbound_events row before household_id is necessarily resolved;
-- a household predicate would fail WITH CHECK (NULL IN (...) => NULL =>
-- reject) and also block the (source, client_uuid) idempotency read.
-- user_id is always known at write time and makes same-user replay safe.
CREATE POLICY "inbound_events_self" ON "inbound_events" FOR ALL
  USING ("user_id" = current_user_id())
  WITH CHECK ("user_id" = current_user_id());--> statement-breakpoint

CREATE POLICY "event_audit_household_read" ON "event_audit" FOR SELECT
  USING ("household_id" IN (SELECT current_user_households()));--> statement-breakpoint

CREATE POLICY "event_audit_household_insert" ON "event_audit" FOR INSERT
  WITH CHECK ("household_id" IN (SELECT current_user_households()));--> statement-breakpoint

-- event_audit is append-only by contract — no UPDATE/DELETE policies on
-- purpose. A correction is a new row (kind = 'audit.corrected').

-- ---- Supabase exposure hardening ----------------------------------
-- users/sessions/event_outbox have no RLS by design (pre-auth lookups /
-- worker-only). Every public-schema table is otherwise reachable via
-- Supabase's auto PostgREST + Realtime using the anon key, so revoke
-- those roles entirely. The app's own pooled connection (table-owning
-- role) is unaffected.
REVOKE ALL ON "users" FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON "sessions" FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON "event_outbox" FROM anon, authenticated;
