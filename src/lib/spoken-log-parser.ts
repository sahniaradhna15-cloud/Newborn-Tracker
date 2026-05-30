/**
 * Natural-language log parser — the Siri "say what happened" path.
 *
 * A single voice Shortcut dictates a phrase ("poop", "wet diaper", "two
 * ounces of formula", "nursed 15 minutes on the left") and posts it as
 * `{ text }` to {@link file://./../app/api/voice/route.ts}. This function
 * turns that free-form transcript into the `event` object of a canonical
 * {@link InboundEvent} — it does NOT build the full envelope or touch the
 * DB. The route adds `client_uuid` / `occurred_at` and re-validates with
 * the one Zod schema before {@link recordEvent}, so this parser is the
 * fuzzy front door, never the source of truth.
 *
 * Design choices that matter when a sleep-deprived caregiver is talking:
 * - Missing nursing side defaults to "both" (the safe catch-all) so a bare
 *   "nursed 15 minutes" still logs instead of nagging for a side.
 * - A feed amount or nursing duration is REQUIRED — we never invent a
 *   number — so a kind-without-amount returns a spoken clarification.
 * - "breast milk" is the user's own word for both a pumped bottle (with
 *   ounces) and nursing (with minutes); we disambiguate on the unit.
 */

/** The `event` object shape, mirroring the InboundEvent union members. */
export type SpokenEvent =
  | { type: "diaper"; pee: boolean; poop: boolean }
  | { type: "feed"; kind: "nursing"; side: "left" | "right" | "both"; duration_min: number }
  | { type: "feed"; kind: "pumped" | "formula"; volume_oz: number };

export type SpokenParseResult =
  | { ok: true; event: SpokenEvent }
  | { ok: false; reason: string; say: string };

const UNRECOGNIZED_SAY =
  "I didn't catch that. Try saying poop, wet diaper, two ounces of formula, or nursed 15 minutes.";

const ONES: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

/**
 * Pull the first spoken quantity out of a phrase. Understands digits
 * ("2", "2.5"), single number words ("two", "fifteen"), tens+ones
 * ("twenty five" → 25), and halves ("half" → 0.5, "two and a half" →
 * 2.5, "an ounce" → 1). Returns null when no quantity is present.
 */
export function extractQuantity(text: string): number | null {
  const normalized = text.toLowerCase();

  const digitMatch = normalized.match(/\d+(?:\.\d+)?/);
  if (digitMatch) {
    let value = parseFloat(digitMatch[0]);
    if (!digitMatch[0].includes(".") && /\band a half\b/.test(normalized)) {
      value += 0.5;
    }
    return value;
  }

  // "and" / "a" / "an" bridge a number run ("two and a half") without
  // contributing or breaking it. They never start a run, so a leading
  // "an ounce" falls through to the explicit unit fallback below.
  const bridges = new Set(["and", "a", "an"]);
  const tokens = normalized.split(/[^a-z]+/).filter(Boolean);
  let sum = 0;
  let sawNumberWord = false;
  let started = false;
  for (const token of tokens) {
    if (token in TENS) {
      sum += TENS[token];
      sawNumberWord = true;
      started = true;
    } else if (token in ONES) {
      sum += ONES[token];
      sawNumberWord = true;
      started = true;
    } else if (token === "half") {
      sum += 0.5;
      sawNumberWord = true;
      started = true;
    } else if (bridges.has(token)) {
      continue;
    } else if (started) {
      break;
    }
  }
  if (sawNumberWord) return sum;

  // "an ounce" / "a minute" → 1 of that unit. Deliberately excludes "a
  // bottle" — that is a count, not a volume, so it stays unspecified.
  if (/\b(a|an)\s+(ounce|ounces|oz|minute|minutes|min|mins)\b/.test(normalized)) {
    return 1;
  }
  return null;
}

const POOP_WORDS = /\b(poop|pooped|poopy|poo|dirty|bowel|stool)\b/;
const PEE_WORDS = /\b(pee|peed|wet|wee|weed|urine|tinkle)\b/;
const FEED_WORDS = /\b(formula|pump|pumped|nurs\w*|breastfed|breastfeed|breast|bottle|ounce|ounces|oz|fed|feed|feeding)\b/;
const MINUTE_WORDS = /\b(minute|minutes|min|mins)\b/;

function parseDiaper(text: string): SpokenParseResult {
  const hasPoop = POOP_WORDS.test(text);
  const hasPee = PEE_WORDS.test(text);
  if (hasPoop || hasPee) {
    return { ok: true, event: { type: "diaper", pee: hasPee, poop: hasPoop } };
  }
  return {
    ok: false,
    reason: "diaper_unspecified",
    say: "Was that wet, dirty, or both?",
  };
}

function detectSide(text: string): "left" | "right" | "both" {
  if (/\bboth\b/.test(text)) return "both";
  const hasLeft = /\bleft\b/.test(text);
  const hasRight = /\bright\b/.test(text);
  if (hasLeft && hasRight) return "both";
  if (hasLeft) return "left";
  if (hasRight) return "right";
  return "both";
}

function parseFeed(text: string): SpokenParseResult {
  const quantity = extractQuantity(text);
  const isFormula = /\bformula\b/.test(text);
  const isPumped = /\b(pump|pumped|expressed)\b/.test(text);
  const isNursing = /\b(nurs\w*|breastfed|breastfeed|latch\w*)\b/.test(text);
  const mentionsBreast = /\bbreast\b/.test(text);
  const hasMinutes = MINUTE_WORDS.test(text);

  // Nursing: explicit verb, OR breast/duration context with no ounces.
  const nursingByContext = (isNursing || (mentionsBreast && hasMinutes)) && !isFormula;
  if (nursingByContext) {
    if (quantity === null || quantity <= 0) {
      return {
        ok: false,
        reason: "nursing_duration_missing",
        say: "How many minutes did you nurse?",
      };
    }
    return {
      ok: true,
      event: {
        type: "feed",
        kind: "nursing",
        side: detectSide(text),
        duration_min: Math.round(quantity),
      },
    };
  }

  // Bottle feeds (formula or pumped) require ounces.
  const kind: "formula" | "pumped" | null = isFormula
    ? "formula"
    : isPumped || mentionsBreast
      ? "pumped"
      : null;

  if (kind === null) {
    return {
      ok: false,
      reason: "feed_kind_unspecified",
      say: "Was that formula or pumped milk?",
    };
  }
  if (quantity === null || quantity <= 0) {
    return {
      ok: false,
      reason: "feed_volume_missing",
      say: "How many ounces?",
    };
  }
  return { ok: true, event: { type: "feed", kind, volume_oz: quantity } };
}

/**
 * Turn a dictated phrase into a canonical `event` object, or a spoken
 * clarification when the phrase is incomplete/ambiguous. Diaper vs. feed
 * is decided by which vocabulary the phrase uses; a feed word wins only
 * when no diaper word is present, so "wet diaper" stays a diaper even if
 * the parser ever broadens its feed lexicon.
 */
export function parseSpokenLog(text: string): SpokenParseResult {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) {
    return { ok: false, reason: "empty", say: UNRECOGNIZED_SAY };
  }

  const looksLikeDiaper = POOP_WORDS.test(normalized) || PEE_WORDS.test(normalized) || /\bdiaper\b/.test(normalized);
  const looksLikeFeed = FEED_WORDS.test(normalized);

  if (looksLikeDiaper && !looksLikeFeed) return parseDiaper(normalized);
  if (looksLikeFeed) return parseFeed(normalized);
  if (looksLikeDiaper) return parseDiaper(normalized);

  return { ok: false, reason: "unrecognized", say: UNRECOGNIZED_SAY };
}
