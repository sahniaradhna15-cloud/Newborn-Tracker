/**
 * ai-notes-normalize — turns a parent's free-form notes (any format) into the
 * strict canonical layout that the deterministic {@link parseNotes} already
 * understands. This is the "accept anything" layer requested for `/import`:
 * Claude rewrites the mess, then the existing pure parser does timestamps,
 * day-windows, dedupe keys, and the per-day preview — so the safety guarantees
 * (preview === commit, idempotent re-import, recordEvent write path) are
 * unchanged. The AI only reformats; it never writes to the database.
 *
 * Model: Haiku 4.5 — cheap and fast, ample for a reformatting task. temp 0 for
 * determinism so the same notes normalize the same way (stable dedupe keys).
 * The static rule block is a cached system prompt; the per-baby default year
 * rides in the user turn so it never invalidates the cache.
 *
 * Callable only when ANTHROPIC_API_KEY is set; the route falls back to parsing
 * the raw text with the rule parser when the key is absent or this throws.
 */
import Anthropic from "@anthropic-ai/sdk";

const NORMALIZER_MODEL = "claude-haiku-4-5";
const MAX_OUTPUT_TOKENS = 16_000;

/**
 * The output contract. Claude must emit ONLY these lines — the exact shapes
 * `parseNotes` recognizes (textual-month date headers, ml volumes, breast
 * minutes, pee/poop counts). No prose, no markdown, no invented data.
 */
const SYSTEM_PROMPT = `You convert a parent's messy, free-form baby feeding-and-diaper notes into ONE strict canonical text format. The notes can be in ANY shape — bullet points, paragraphs, tables, numeric or written dates, oz or ml, shorthand. Your only job is to faithfully re-express what is written into the canonical format below. Do not add, infer, or omit any feed or diaper that the parent actually wrote.

OUTPUT RULES — output ONLY the reformatted notes. No commentary, no explanation, no markdown code fences, no headers other than the date lines.

1. DATE HEADERS: Start each day with a date on its own line, written as "Month D YYYY" (e.g. "June 1 2026"). Interpret numeric dates (6/1/2026, 01-06-26, 2026-06-01), weekday names, and "Day N" relative to the provided default year. If a note has no year at all, use the default year given in the user message. If the day/month order is ambiguous in a numeric date, prefer month-first (US style).

2. FEEDS: Under the date, one feed per line as "<time> - <type> <amount> ml".
   - <type> is exactly "formula" or "breast milk".
   - Convert every volume to MILLILITERS. Ounces to ml at 1 oz = 30 ml (e.g. 2 oz -> 60 ml). Values already in ml stay as-is.
   - If a breast feed is given as a duration, write "<time> - breast milk <N> min" (do NOT convert minutes to ml).
   - If a feed truly has no amount written, output it with no number: "<time> - formula" or "<time> - breast milk".

3. DIAPERS: One line as "<time> - <N> pee and <M> poop". Use the words "pee" and "poop". Include only what was mentioned (e.g. just "<time> - 1 poop"). A line can be both a feed and a diaper if the note combined them.

4. TIMES: Use "h:mm am/pm" or "h am/pm". If no time is given for an entry, omit the time and the dash and just write the entry (e.g. "formula 60 ml").

5. ORDER: keep entries in chronological order within each day.

EXAMPLE INPUT:
6/1 — woke 3am, gave 2oz formula. 7:30 breast 15 min. pooped twice, 1 wet. evening 70ml breastmilk

EXAMPLE OUTPUT:
June 1 2026
3 am - formula 60 ml
7:30 am - breast milk 15 min
2 poop and 1 pee
7 pm - breast milk 70 ml`;

/**
 * Reformat `rawText` into canonical notes via Claude. Returns the normalized
 * text (trimmed). Throws on API failure so the caller can fall back to the
 * rule parser.
 *
 * @param rawText   the parent's original free-form notes
 * @param defaultYear year to assume for date headers that omit one (baby's birth year)
 */
export async function normalizeNotesWithAi(rawText: string, defaultYear: number): Promise<string> {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

  const stream = client.messages.stream({
    model: NORMALIZER_MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    temperature: 0,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: `Default year for dates without one: ${defaultYear}\n\nNotes to convert:\n${rawText}`,
      },
    ],
  });

  const message = await stream.finalMessage();
  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  return text;
}
