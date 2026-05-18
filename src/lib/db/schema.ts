/**
 * Drizzle schema for the Newborn Tracker.
 *
 * This file is the source of truth for the TYPED query builder. The authoritative
 * DDL — including Row Level Security policies, which Drizzle does not emit — lives
 * in `src/lib/db/migrations/0001_initial.sql`. Keep the two in sync: when you change
 * a table here, hand-merge the corresponding change into the migration.
 *
 * Conventions (see CLAUDE.md §7):
 * - snake_case columns, plural snake_case tables
 * - uuid PKs default to gen_random_uuid() (pgcrypto)
 * - all timestamps are timestamptz
 * - `kind`/`role`/`status` discriminators are text + CHECK, not pgEnum
 */
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  displayName: text("display_name").notNull(),
  createdAt: tz("created_at").notNull().defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    deviceLabel: text("device_label"),
    expiresAt: tz("expires_at").notNull(),
    lastSeenAt: tz("last_seen_at"),
    revokedAt: tz("revoked_at"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sessions_token_hash_idx").on(t.tokenHash),
    index("sessions_user_id_idx").on(t.userId),
  ],
);

export const recoveryCodes = pgTable(
  "recovery_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    createdAt: tz("created_at").notNull().defaultNow(),
    rotatedAt: tz("rotated_at"),
    usedAt: tz("used_at"),
    usedFromIp: text("used_from_ip"),
  },
  (t) => [
    uniqueIndex("recovery_codes_code_hash_idx").on(t.codeHash),
    // At most one active (not rotated, not used) code per user.
    uniqueIndex("recovery_codes_active_user_idx")
      .on(t.userId)
      .where(sql`${t.rotatedAt} IS NULL AND ${t.usedAt} IS NULL`),
  ],
);

/* ------------------------------------------------------------------ */
/* Household scope                                                     */
/* ------------------------------------------------------------------ */

export const households = pgTable("households", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  dayStartHour: smallint("day_start_hour").notNull().default(4),
  timezone: text("timezone").notNull().default("America/Chicago"),
  createdAt: tz("created_at").notNull().defaultNow(),
});

export const householdMembers = pgTable(
  "household_members",
  {
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("caregiver"),
    displayName: text("display_name"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.householdId, t.userId] }),
    check("household_members_role_chk", sql`${t.role} IN ('owner', 'caregiver')`),
    index("household_members_user_idx").on(t.userId),
  ],
);

export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    role: text("role").notNull().default("caregiver"),
    displayName: text("display_name"),
    // Non-null => peer-recovery re-link (binds to existing user, no new row on accept).
    targetUserId: uuid("target_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    expiresAt: tz("expires_at").notNull(),
    acceptedAt: tz("accepted_at"),
    acceptedBy: uuid("accepted_by").references(() => users.id),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("invites_token_hash_idx").on(t.tokenHash),
    check("invites_role_chk", sql`${t.role} IN ('owner', 'caregiver')`),
    // At most one outstanding peer-recovery invite per target.
    uniqueIndex("invites_active_target_idx")
      .on(t.targetUserId)
      .where(sql`${t.targetUserId} IS NOT NULL AND ${t.acceptedAt} IS NULL`),
  ],
);

export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    label: text("label"),
    lastUsedAt: tz("last_used_at"),
    revokedAt: tz("revoked_at"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("api_tokens_token_hash_idx").on(t.tokenHash),
    index("api_tokens_user_idx").on(t.userId),
  ],
);

/* ------------------------------------------------------------------ */
/* Baby + events                                                       */
/* ------------------------------------------------------------------ */

export const babies = pgTable("babies", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  birthDate: timestamp("birth_date", { mode: "date" }).notNull(),
  birthWeightOz: numeric("birth_weight_oz", { precision: 5, scale: 1 }),
  currentWeightOz: numeric("current_weight_oz", { precision: 5, scale: 1 }),
  weightUpdatedAt: tz("weight_updated_at"),
  createdAt: tz("created_at").notNull().defaultNow(),
});

export const weightEvents = pgTable(
  "weight_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    babyId: uuid("baby_id")
      .notNull()
      .references(() => babies.id, { onDelete: "cascade" }),
    loggedBy: uuid("logged_by").references(() => users.id),
    occurredAt: tz("occurred_at").notNull(),
    weightOz: numeric("weight_oz", { precision: 5, scale: 1 }).notNull(),
    note: text("note"),
    source: text("source").notNull().default("app"),
    clientUuid: uuid("client_uuid"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("weight_events_client_uuid_idx")
      .on(t.clientUuid)
      .where(sql`${t.clientUuid} IS NOT NULL`),
    index("weight_events_baby_time_idx").on(t.babyId, t.occurredAt.desc()),
  ],
);

export const feedEvents = pgTable(
  "feed_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    babyId: uuid("baby_id")
      .notNull()
      .references(() => babies.id, { onDelete: "cascade" }),
    loggedBy: uuid("logged_by").references(() => users.id),
    occurredAt: tz("occurred_at").notNull(),
    kind: text("kind").notNull(),
    // nursing only
    side: text("side"),
    durationMin: smallint("duration_min"),
    // pumped + formula
    volumeOz: numeric("volume_oz", { precision: 4, scale: 1 }),
    wastedOz: numeric("wasted_oz", { precision: 4, scale: 1 }),
    // computed on insert; daily totals SUM this
    estimatedOz: numeric("estimated_oz", { precision: 4, scale: 1 }).notNull(),
    note: text("note"),
    source: text("source").notNull().default("app"),
    clientUuid: uuid("client_uuid"),
    corroboratingSources: jsonb("corroborating_sources"),
    lockedAt: tz("locked_at"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("feed_events_kind_chk", sql`${t.kind} IN ('nursing', 'pumped', 'formula')`),
    check(
      "feed_events_side_chk",
      sql`${t.side} IS NULL OR ${t.side} IN ('left', 'right', 'both')`,
    ),
    // Variant invariant: nursing rows carry side + duration; bottle rows carry volume.
    check(
      "feed_events_variant_chk",
      sql`(${t.kind} = 'nursing' AND ${t.durationMin} IS NOT NULL AND ${t.side} IS NOT NULL) OR (${t.kind} IN ('pumped', 'formula') AND ${t.volumeOz} IS NOT NULL)`,
    ),
    uniqueIndex("feed_events_client_uuid_idx")
      .on(t.clientUuid)
      .where(sql`${t.clientUuid} IS NOT NULL`),
    index("feed_events_baby_time_idx").on(t.babyId, t.occurredAt.desc()),
  ],
);

export const diaperEvents = pgTable(
  "diaper_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    babyId: uuid("baby_id")
      .notNull()
      .references(() => babies.id, { onDelete: "cascade" }),
    loggedBy: uuid("logged_by").references(() => users.id),
    occurredAt: tz("occurred_at").notNull(),
    pee: boolean("pee").notNull().default(false),
    poop: boolean("poop").notNull().default(false),
    note: text("note"),
    source: text("source").notNull().default("app"),
    clientUuid: uuid("client_uuid"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    // Matches the InboundEvent Zod refinement: at least one of pee/poop is true.
    check("diaper_events_presence_chk", sql`${t.pee} OR ${t.poop}`),
    uniqueIndex("diaper_events_client_uuid_idx")
      .on(t.clientUuid)
      .where(sql`${t.clientUuid} IS NOT NULL`),
    index("diaper_events_baby_time_idx").on(t.babyId, t.occurredAt.desc()),
  ],
);

export const momEvents = pgTable(
  "mom_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    occurredAt: tz("occurred_at").notNull(),
    kind: text("kind").notNull(),
    payload: jsonb("payload"),
    source: text("source").notNull().default("app"),
    clientUuid: uuid("client_uuid"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "mom_events_kind_chk",
      sql`${t.kind} IN ('medication', 'mood', 'note', 'pump_only')`,
    ),
    uniqueIndex("mom_events_client_uuid_idx")
      .on(t.clientUuid)
      .where(sql`${t.clientUuid} IS NOT NULL`),
    index("mom_events_user_time_idx").on(t.userId, t.occurredAt.desc()),
  ],
);

/* ------------------------------------------------------------------ */
/* Cross-cutting: idempotency ledger, outbox, audit                    */
/* ------------------------------------------------------------------ */

export const inboundEvents = pgTable(
  "inbound_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(),
    clientUuid: uuid("client_uuid").notNull(),
    sourceEventId: text("source_event_id"),
    householdId: uuid("household_id").references(() => households.id),
    userId: uuid("user_id").references(() => users.id),
    resultingEventId: uuid("resulting_event_id"),
    resultingTable: text("resulting_table"),
    raw: jsonb("raw").notNull(),
    status: text("status").notNull(),
    error: text("error"),
    receivedAt: tz("received_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("inbound_events_dedupe_idx").on(t.source, t.clientUuid),
    check(
      "inbound_events_status_chk",
      sql`${t.status} IN ('accepted', 'duplicate', 'merged', 'rejected')`,
    ),
  ],
);

export const eventOutbox = pgTable(
  "event_outbox",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    topic: text("topic").notNull(),
    payload: jsonb("payload").notNull(),
    processedAt: tz("processed_at"),
    failedAt: tz("failed_at"),
    failureReason: text("failure_reason"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("event_outbox_unprocessed_idx")
      .on(t.createdAt)
      .where(sql`${t.processedAt} IS NULL`),
  ],
);

export const eventAudit = pgTable(
  "event_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    householdId: uuid("household_id").references(() => households.id),
    kind: text("kind").notNull(),
    entityTable: text("entity_table"),
    entityId: uuid("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: text("ip"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [index("event_audit_household_time_idx").on(t.householdId, t.createdAt.desc())],
);

/**
 * Postgres-backed token-bucket rate limiting (Decision #7 — no Redis in
 * the stack, CLAUDE.md §2). One row per logical key (e.g.
 * `recovery_redeem:<ip>`); `window_start` anchors the current fixed
 * window and `count` is the consumed quota in it. RLS is enabled with
 * NO anon/authenticated grants — it is touched only by server route
 * handlers (some pre-session), never via Supabase's auto API. See the
 * RLS header in migrations/0002_rate_limits.sql.
 */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: tz("window_start").notNull(),
  count: integer("count").notNull(),
});
