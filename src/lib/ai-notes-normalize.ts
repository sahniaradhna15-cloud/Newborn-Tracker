/**
 * ai-notes-normalize — turns a parent's free-form notes (any format) into the
 * strict canonical layout that the deterministic {@link parseNotes} already
 * understands. This is the "accept anything" layer for `/import`: an LLM
 * rewrites the mess, then the existing pure parser does timestamps,
 * day-windows, dedupe keys, and the per-day preview — so the safety guarantees
 * (preview === commit, idempotent re-import, recordEvent write path) are
 * unchanged. The model only reformats; it never writes to the database.
 *
 * Provider: **Google Gemini** (free tier) via its OpenAI-compatible chat
 * endpoint — no SDK, just fetch with a Bearer key. Model is configurable
 * (GEMINI_MODEL) and defaults to the cheapest fast model. temp 0 for
 * determinism so the same notes normalize the same way (stable dedupe keys).
 * Callable only when GEMINI_API_KEY is set; the route falls back to the rule
 * parser when the key is absent or this throws (e.g. a free-tier 429).
 *
 * Privacy note: Google's free tier may use submitted prompts to improve its
 * products (the user accepted this tradeoff). The `/import` disclosure says so.
 */
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const DEFAULT_MODEL = "gemini-2.5-flash-lite";
const MAX_OUTPUT_TOKENS = 8_000;
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * The output contract. The model must emit ONLY these lines — the exact shapes
 * `parseNotes` recognizes — and must never drop information: any extra remark
 * (mood, spit-up, medication, anything else) is kept in parentheses on the
 * entry's line, where the parser preserves it as the event's note.
 */
const SYSTEM_PROMPT = `You convert a parent's messy, free-form baby feeding-and-diaper notes into ONE strict canonical text format. The notes can be in ANY shape — bullet points, paragraphs, tables, numeric or written dates, oz or ml, shorthand. Faithfully re-express what the parent wrote. Never invent data, and never drop anything they wrote.

OUTPUT RULES — output ONLY the reformatted notes. No commentary, no explanation, no markdown code fences.

1. DATE HEADERS: Start each day with a date on its own line, written as "Month D YYYY" (e.g. "June 1 2026"). Interpret numeric dates (6/1/2026, 01-06-26, 2026-06-01), weekday names, and "Day N" relative to the default year given in the user message. If a numeric date's day/month order is ambiguous, prefer month-first (US).

2. FEEDS: One feed per line as "<time> - <type> <amount> ml".
   - <type> is exactly "formula" or "breast milk".
   - Convert every volume to MILLILITERS. Ounces to ml at 1 oz = 30 ml (e.g. 2 oz -> 60 ml). Values already in ml stay as-is.
   - If a breast feed is given as a duration, write "<time> - breast milk <N> min" (do NOT convert minutes).
   - If a feed has no amount, write "<time> - formula" or "<time> - breast milk".

3. DIAPERS: One line as "<time> - <N> pee and <M> poop". Use the words "pee" and "poop". Include only what was mentioned.

4. TIMES: "h:mm am/pm" or "h am/pm". If no time is given, omit the time and the dash.

5. EXTRA REMARKS: If a note has anything beyond feeds/diapers (mood, spit-up, sleep, medication, temperature, a comment), keep it at the END of that entry's line in parentheses, e.g. "8 am - formula 60 ml (fussy, spit up a little)". If a remark stands alone with no feed/diaper, put it on its own line in parentheses under the date.

6. ORDER: keep entries chronological within each day.

EXAMPLE INPUT:
6/1 — woke 3am, gave 2oz formula, seemed gassy. 7:30 breast 15 min. pooped twice, 1 wet. gave vitamin D drops. evening 70ml breastmilk

EXAMPLE OUTPUT:
June 1 2026
3 am - formula 60 ml (seemed gassy)
7:30 am - breast milk 15 min
2 poop and 1 pee
(gave vitamin D drops)
7 pm - breast milk 70 ml`;

/** True when an LLM normalizer is configured (Gemini key present). */
export function isAiNormalizeConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

/** Strip a stray ```fence``` wrapper if the model adds one despite instructions. */
function stripCodeFence(text: string): string {
  const fenced = text.match(/^```[a-z]*\n([\s\S]*?)\n```$/i);
  return (fenced ? fenced[1] : text).trim();
}

/**
 * Reformat `rawText` into canonical notes via Gemini. Returns the normalized
 * text. Throws on missing key, HTTP error, or malformed response so the caller
 * can fall back to the rule parser.
 *
 * @param rawText     the parent's original free-form notes
 * @param defaultYear year to assume for date headers that omit one (baby's birth year)
 */
export async function normalizeNotesWithAi(rawText: string, defaultYear: number): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const res = await fetch(GEMINI_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.GEMINI_MODEL || DEFAULT_MODEL,
      temperature: 0,
      max_tokens: MAX_OUTPUT_TOKENS,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Default year for dates without one: ${defaultYear}\n\nNotes to convert:\n${rawText}`,
        },
      ],
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gemini API ${res.status}: ${detail.slice(0, 200)}`);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("Gemini API returned no message content");

  return stripCodeFence(content);
}
