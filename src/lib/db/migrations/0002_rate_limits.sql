CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint

-- ============================================================
-- Row Level Security  (hand-authored — drizzle-kit does not emit RLS)
-- Phase 2 Task 2 — Postgres token-bucket rate limiting (Decision #7,
-- CLAUDE.md §2 "no Redis"; §13 rate-limit list).
--
-- Access model: `rate_limits` is touched ONLY by server route handlers
-- via src/lib/rate-limit.ts. Some of those routes are PRE-SESSION
-- (/api/recovery/redeem has no auth) and run through the `adminDb`
-- service-role conduit. There is intentionally NO USING/WITH CHECK
-- policy that would scope rows to a household: a per-IP / per-user
-- bucket has no household.
--
-- RLS is ENABLEd so the table fails closed for the `app_runtime` role
-- (a policy-less ENABLE'd table denies all rows to a non-owner,
-- non-BYPASSRLS role). The service-role path (adminDb → SET LOCAL ROLE
-- service_role, BYPASSRLS) is the only writer/reader. Supabase's
-- anon/authenticated auto-API roles are REVOKEd entirely so a leaked
-- anon key cannot read or forge buckets. Mirrors the §4-style RLS
-- header on migrations/0000_loud_leech.sql.
-- ============================================================

ALTER TABLE "rate_limits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- No FOR-clause policy on purpose: the only legitimate caller is the
-- BYPASSRLS service_role (pre-session) path. ENABLE with zero policies
-- = deny-all for app_runtime, which is the intended fail-closed posture.

REVOKE ALL ON "rate_limits" FROM anon, authenticated;
