/**
 * `POST /api/import` (session) — bulk backfill of a parent's free-form daily
 * notes into feed & diaper rows.
 *
 * The messy text → events translation lives in the pure {@link parseNotes}
 * (lib/notes-import.ts), so this route is thin: it resolves the baby's
 * timezone/DOB/weights, parses, and — on commit — feeds each parsed event
 * through the ONE write path {@link recordEvent} (CLAUDE.md §3). It never
 * INSERTs domain rows directly.
 *
 * Two modes, same parser (so the preview can never disagree with the commit):
 *   - `commit: false` → preview: per-day rollup + skipped/warnings, no writes.
 *   - `commit: true`  → writes via recordEvent. Idempotent: client_uuid is a
 *     deterministic UUIDv5 of each event's dedupeKey, so re-importing the same
 *     notes is a no-op (recordEvent returns `duplicate`).
 *
 * Source channel is `import` (added to the InboundEvent enum); it is stored on
 * every resulting row so an import is auditable and distinguishable from PWA
 * entries.
 */
import { createHash } from "node:crypto";

import { asc, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { isAiNormalizeConfigured, normalizeNotesWithAi } from "@/lib/ai-notes-normalize";
import { babies, households } from "@/lib/db/schema";
import { parseNotes, type ImportEvent } from "@/lib/notes-import";
import { recordEvent, type AuthContext } from "@/lib/record-event";
import { InboundEvent } from "@/lib/voice-parser";
import { getSessionAuthContext } from "@/lib/with-auth";
import { withUserContext } from "@/lib/with-user-context";

const MAX_RAW_CHARS = 200_000;
const UUID_NAMESPACE_HEX = "a3f1e2d45b6c47899abcde0123456789"; // fixed namespace for import dedupe
const MAX_FIXES = 1_000;

/**
 * Trust-boundary scrub for the `fixes` body — drop anything that isn't a plain
 * object of string→positive-finite-number. The parser ignores invalid entries
 * anyway, but pruning here keeps the size bounded and the log line truthful.
 */
function sanitizeFixes(raw: unknown): Record<string, number> | undefined {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0) return undefined;
  const clean: Record<string, number> = {};
  let kept = 0;
  for (const [key, value] of entries) {
    if (kept >= MAX_FIXES) break;
    if (typeof key !== "string" || key === "") continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
    clean[key] = value;
    kept += 1;
  }
  return kept > 0 ? clean : undefined;
}

/** Deterministic UUIDv5 of `name` — same notes ⇒ same client_uuid ⇒ idempotent re-import. */
function deterministicUuid(name: string): string {
  const hash = createHash("sha1")
    .update(Buffer.from(UUID_NAMESPACE_HEX, "hex"))
    .update(Buffer.from(name, "utf8"))
    .digest();
  const b = Uint8Array.prototype.slice.call(hash, 0, 16);
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // RFC variant
  const hex = Buffer.from(b).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Decide the text to hand the deterministic parser.
 *  - `provided` (the AI-normalized text echoed from a prior preview) is reused
 *    verbatim so commit/recalculate parse EXACTLY what was previewed — same
 *    dedupe keys, same skip keys, no second LLM call, no drift.
 *  - Otherwise, when an LLM is configured (GROQ_API_KEY set), the model
 *    normalizes the raw free-form notes into the canonical format.
 *  - With no key — or if the LLM call fails — fall back to parsing the raw text
 *    with the rule parser, so import never hard-breaks.
 */
async function resolveNotesText(
  rawText: string,
  defaultYear: number,
  provided: string | undefined,
  userId: string,
): Promise<{ text: string; aiUsed: boolean }> {
  if (provided !== undefined && provided.trim() !== "") {
    return { text: provided, aiUsed: true };
  }
  if (!isAiNormalizeConfigured()) {
    return { text: rawText, aiUsed: false };
  }
  try {
    const normalized = await normalizeNotesWithAi(rawText, defaultYear);
    return normalized.trim() === "" ? { text: rawText, aiUsed: false } : { text: normalized, aiUsed: true };
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "import_ai_normalize_failed",
        route: "/api/import",
        error: error instanceof Error ? error.message : String(error),
        user_id: userId,
        fix_suggestion:
          "LLM normalization failed — falling back to the rule parser. Check GEMINI_API_KEY validity, the GEMINI_MODEL id, and Gemini free-tier rate limits (a 429 means quota hit; chunk large pastes).",
      }),
    );
    return { text: rawText, aiUsed: false };
  }
}

/** Lift one parsed import event into the canonical wire shape for recordEvent. */
function toInbound(e: ImportEvent): unknown {
  const base = {
    client_uuid: deterministicUuid(e.dedupeKey),
    source: "import" as const,
    occurred_at: e.occurredAtIso,
    note: e.rawLine.slice(0, 500),
  };
  if (e.type === "feed") {
    // Breast feeds carry the user's exact converted ounces, so they are stored
    // as a measured (pumped) volume rather than a duration the app would re-estimate.
    return { ...base, event: { type: "feed", kind: e.kind === "breast" ? "pumped" : "formula", volume_oz: e.amount.oz } };
  }
  return { ...base, event: { type: "diaper", pee: e.pee, poop: e.poop } };
}

export async function POST(req: NextRequest) {
  const ctx = await getSessionAuthContext();
  if (!ctx) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: { rawText?: unknown; commit?: unknown; fixes?: unknown; normalizedText?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const rawText = typeof body.rawText === "string" ? body.rawText : "";
  const commit = body.commit === true;
  const fixes = sanitizeFixes(body.fixes);
  // The AI-normalized text echoed from a prior preview, reused so commit and
  // recalculate parse exactly what was previewed (stable keys, one LLM call).
  const providedNormalized =
    typeof body.normalizedText === "string" && body.normalizedText.length <= MAX_RAW_CHARS
      ? body.normalizedText
      : undefined;
  if (rawText.trim() === "") {
    return NextResponse.json({ ok: false, error: "empty_notes" }, { status: 400 });
  }
  if (rawText.length > MAX_RAW_CHARS) {
    return NextResponse.json({ ok: false, error: "notes_too_large" }, { status: 413 });
  }

  const baby = await withUserContext(ctx.user_id, async (tx) => {
    const [household] = await tx.select().from(households).where(eq(households.id, ctx.household_id)).limit(1);
    const [row] = await tx
      .select()
      .from(babies)
      .where(eq(babies.householdId, ctx.household_id))
      .orderBy(asc(babies.createdAt))
      .limit(1);
    if (!household || !row) return null;
    return {
      dobIso: row.birthDate.toISOString(),
      timeZone: household.timezone,
      dayStartHour: household.dayStartHour,
      defaultYear: row.birthDate.getUTCFullYear(),
      birthWeightOz: row.birthWeightOz === null ? null : Number(row.birthWeightOz),
      currentWeightOz: row.currentWeightOz === null ? null : Number(row.currentWeightOz),
    };
  });

  if (!baby) {
    return NextResponse.json({ ok: false, error: "no_active_baby" }, { status: 404 });
  }

  const { text: notesText } = await resolveNotesText(rawText, baby.defaultYear, providedNormalized, ctx.user_id);

  let parsed: ReturnType<typeof parseNotes>;
  try {
    parsed = parseNotes(notesText, { ...baby, fixes });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "import_parse_failed",
        route: "/api/import",
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        user_id: ctx.user_id,
        fix_suggestion:
          "parseNotes threw on this input — likely an unhandled date-header or time token. Add the offending line shape to notes-import.test.ts and guard it.",
      }),
    );
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }

  const counts = {
    days: parsed.perDay.length,
    feeds: parsed.events.filter((e) => e.type === "feed").length,
    diapers: parsed.events.filter((e) => e.type === "diaper").length,
    skipped: parsed.skipped.length,
  };

  if (!commit) {
    console.info(
      JSON.stringify({
        event: "import_preview",
        route: "/api/import",
        method: "POST",
        status: "ok",
        user_id: ctx.user_id,
        household_id: ctx.household_id,
        ...counts,
      }),
    );
    return NextResponse.json({
      ok: true,
      mode: "preview",
      perDay: parsed.perDay,
      skipped: parsed.skipped,
      warnings: parsed.warnings,
      counts,
      // Echo the exact text the parser saw so commit/recalculate reuse it
      // verbatim (one LLM call per import; preview === commit).
      normalizedText: notesText,
    });
  }

  const importCtx: AuthContext = { ...ctx, source: "import" };
  let accepted = 0;
  let duplicate = 0;
  let failed = 0;

  // Write with bounded concurrency. recordEvent is idempotent on
  // (source, client_uuid), each event is independent, and withUserContext
  // is transaction-scoped — so concurrent writes are safe. Capped below the
  // postgres-js pool size (10) to leave headroom for other requests.
  const CONCURRENCY = 6;
  const queue = [...parsed.events];

  async function drainQueue(): Promise<void> {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      const candidate = toInbound(next);
      const valid = InboundEvent.safeParse(candidate);
      if (!valid.success) {
        failed += 1;
        continue;
      }
      try {
        const result = await recordEvent(importCtx, valid.data, { computeSay: false });
        if (result.status === "duplicate") duplicate += 1;
        else accepted += 1;
      } catch (error) {
        failed += 1;
        console.error(
          JSON.stringify({
            event: "import_event_failed",
            route: "/api/import",
            error: error instanceof Error ? error.message : String(error),
            user_id: importCtx.user_id,
            fix_suggestion:
              "Confirm withUserContext bound request.user_id (RLS), the household has a babies row, and the InboundEvent volume/duration bounds (FeedBottle volume_oz ≤ 20) are satisfied.",
          }),
        );
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => drainQueue()));

  console.info(
    JSON.stringify({
      event: "import_commit",
      route: "/api/import",
      method: "POST",
      status: "ok",
      user_id: ctx.user_id,
      household_id: ctx.household_id,
      accepted,
      duplicate,
      failed,
      ...counts,
    }),
  );

  return NextResponse.json({ ok: true, mode: "commit", accepted, duplicate, failed, counts });
}
