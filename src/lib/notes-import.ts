/**
 * notes-import — turns a parent's free-form daily notes into structured feed &
 * diaper events for the historical backfill behind `/import`.
 *
 * This is the messy-text → clean-data layer. It is deliberately PURE (no DB,
 * no I/O) so it can be unit-tested against real note dumps and so the same
 * function powers both the preview and the commit (server re-parses on commit,
 * so the preview can never disagree with what gets written).
 *
 * Conventions it understands (confirmed with the user — CLAUDE.md domain owner):
 *  - Volumes are in **ml**, converted to oz at ~30 ml = 1 oz.
 *  - "formula milk – X ml" → a formula feed of X ml.
 *  - "breast milk – X ml"  → a breast-milk feed of X ml.
 *  - "breast milk – X min" → a breast-milk feed via the user's OWN minutes→ml
 *    table (much lower than a generic oz/min estimate — see {@link minutesToMl}).
 *  - "1 breast"            → 15 ml.
 *  - "little breast milk" / any breast feed with NO amount → **skipped** with a
 *    stable `skipKey` so the UI can prompt for an amount; supplying one via
 *    {@link ImportOptions.fixes} promotes it back into a counted event.
 *  - "formula milk" with NO readable amount → same treatment as breast (skipped
 *    with a `skipKey`, fixable from the UI). Both kinds surface together so the
 *    parent can review and rescue either.
 *  - "pee" / "poop" / "poty" / counts ("2 pee and 2 poop", "poop 4 times",
 *    "twice"/"once") → diaper changes, tallied per day.
 *  - Times: am/pm (explicit or inferred), typos (`9;45`, `70 am`→ml,
 *    `10 gm`→ml), ranges (use the start), and the after-midnight wrap (1–3am
 *    entries roll onto the next calendar day, which the 4am day-window then
 *    folds back into the same logical day).
 *
 * Each event carries a deterministic {@link ImportEvent.dedupeKey} so the API
 * can mint a stable UUID and re-importing the same notes is a no-op.
 */
import { fromZonedTime } from "date-fns-tz";

import { dailyTargetRange } from "./targets";
import { dayNumberSinceBirth, getDayWindow } from "./day-window";

const ML_PER_OZ = 29.5735;
// A new calendar day is only inferred on a PM → early-AM jump (a real midnight
// crossing). A plain backward step (e.g. "1:10 pm" logged before "11:00 am") is
// just an out-of-order entry on the SAME day, not a new one.
const EARLY_AM_MIN = 5 * 60; // 05:00 — the tail of a night (1–4am entries)
const AFTERNOON_MIN = 12 * 60; // 12:00 — "previous time was afternoon/evening"

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

export type ImportOptions = {
  /** Baby's date of birth (ISO) — for per-day age + target band. */
  dobIso: string;
  timeZone: string;
  dayStartHour: number;
  /** Year to assume for date headers that omit it (the notes' year). */
  defaultYear: number;
  /** Baby weights (oz) for the informational per-day target band. */
  birthWeightOz: number | null;
  currentWeightOz: number | null;
  /**
   * User-supplied amounts (ml) for lines the parser would otherwise skip
   * (breast/formula with no readable amount). Keyed by {@link SkippedLine.skipKey}.
   * A positive value promotes the skipped line into a counted feed event of the
   * matching kind; missing/zero/non-finite values leave it skipped.
   */
  fixes?: Record<string, number>;
};

export type UnitAmount = { ml: number; oz: number };

export type ImportFeed = {
  type: "feed";
  /** "breast" is stored downstream as a measured (pumped) volume so the user's exact oz is honored. */
  kind: "formula" | "breast";
  occurredAtIso: string;
  amount: UnitAmount;
  rawLine: string;
  dedupeKey: string;
};

export type ImportDiaper = {
  type: "diaper";
  occurredAtIso: string;
  pee: boolean;
  poop: boolean;
  rawLine: string;
  dedupeKey: string;
};

export type ImportEvent = ImportFeed | ImportDiaper;

export type SkippedLine = {
  /** Stable key for this skipped slot — used by the UI to round-trip a user fix. */
  skipKey: string;
  rawLine: string;
  reason: string;
  dateLabel: string;
  kind: "formula" | "breast";
  /** The time this line would have used had it had an amount — so a fix lands in the right day window. */
  occurredAtIso: string;
};

export type DayPreview = {
  dayStartIso: string;
  label: string;
  ageDays: number;
  formula: UnitAmount;
  breast: UnitAmount;
  total: UnitAmount;
  targetLowOz: number;
  targetHighOz: number;
  withinTarget: boolean;
  feedCount: number;
  pee: number;
  poop: number;
};

export type ParseResult = {
  events: ImportEvent[];
  perDay: DayPreview[];
  skipped: SkippedLine[];
  warnings: string[];
};

/* ------------------------------------------------------------------ */
/* small pure helpers (exported for unit tests)                        */
/* ------------------------------------------------------------------ */

export function mlToOz(ml: number): number {
  return Math.round((ml / ML_PER_OZ) * 10) / 10;
}

/** The user's own nursing-minutes → ml table (ranges collapse to a midpoint). */
export function minutesToMl(minStart: number, minEnd?: number): number {
  const m = minEnd != null ? (minStart + minEnd) / 2 : minStart;
  if (m <= 5) return 5;
  if (m <= 8) return 12;
  if (m <= 15) return 20;
  return 30;
}

type ParsedTime = { hour: number; minute: number; meridiem: "am" | "pm" | null; at: number };

/**
 * All time-of-day tokens in a line, in order of appearance. Handles `6:30am`,
 * `9;45`, `7;30 pm`, and bare `1 pm` / `3 am`. Hours are bounded to 1–23 so a
 * stray `70 am` (a typo for 70 ml) is not mistaken for a time.
 */
export function parseTimes(line: string): ParsedTime[] {
  const times: ParsedTime[] = [];
  const masked = line.toLowerCase();
  const taken: boolean[] = new Array(masked.length).fill(false);

  // 1) Colon/semicolon/dot times: 6:30, 9;45, 7;30 pm
  const colon = /(\d{1,2})\s*[:;.]\s*(\d{2})\s*(a\.?m\.?|p\.?m\.?)?/gi;
  for (let mm = colon.exec(masked); mm; mm = colon.exec(masked)) {
    const hour = Number(mm[1]);
    const minute = Number(mm[2]);
    if (hour > 23 || minute > 59) continue;
    times.push({ hour, minute, meridiem: normalizeMeridiem(mm[3]), at: mm.index });
    for (let i = mm.index; i < mm.index + mm[0].length; i++) taken[i] = true;
  }

  // 2) Bare hour + meridiem: "3 am", "1 pm" (skip spans already consumed above)
  const bare = /\b(\d{1,2})\s*(a\.?m\.?|p\.?m\.?)\b/gi;
  for (let mm = bare.exec(masked); mm; mm = bare.exec(masked)) {
    if (taken[mm.index]) continue;
    const hour = Number(mm[1]);
    if (hour < 1 || hour > 12) continue;
    times.push({ hour, minute: 0, meridiem: normalizeMeridiem(mm[2]), at: mm.index });
  }

  return times.sort((a, b) => a.at - b.at);
}

function normalizeMeridiem(raw: string | undefined): "am" | "pm" | null {
  if (!raw) return null;
  return raw.replace(/\./g, "").toLowerCase().startsWith("p") ? "pm" : "am";
}

/** Minutes-of-day for an explicit meridiem, or null when the time is bare. */
function explicitTod(t: ParsedTime): number | null {
  if (t.meridiem === null) return null;
  const h12 = t.hour % 12;
  return (t.meridiem === "pm" ? h12 + 12 : h12) * 60 + t.minute;
}

/** Pick the am/pm reading of a bare time that lands soonest *after* `prevTod`. */
function inferBareTod(t: ParsedTime, prevTod: number): number {
  const base = (t.hour % 12) * 60 + t.minute;
  const am = base;
  const pm = base + 720;
  const forward = (c: number) => (c - prevTod + 1440) % 1440;
  return forward(am) <= forward(pm) ? am : pm;
}

type DiaperCount = { pee: number; poop: number };

const NUMBER_WORDS: Record<string, number> = { once: 1, twice: 2, thrice: 3 };

/** Pee/poop counts on a line (0 when the substance isn't mentioned). */
export function parseDiaperCounts(line: string): DiaperCount {
  const s = line.toLowerCase();
  const hasPee = /\b(pee|peed|wee)\b/.test(s);
  const hasPoop = /\b(poop|pooped|poo|poty|potty)\b/.test(s);
  if (!hasPee && !hasPoop) return { pee: 0, poop: 0 };

  // Counts must sit ADJACENT to their own substance, so "poop twice" doesn't
  // also bump "peed" in "Peed and poop twice".
  const countNear = (subj: string, present: boolean): number => {
    if (!present) return 0;
    const leading = s.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s+(?:${subj})`));
    if (leading) return Math.max(1, Math.floor(Number(leading[1])));
    const times = s.match(new RegExp(`(?:${subj})\\s*[-–]?\\s*(\\d+)\\s*times`));
    if (times) return Math.max(1, Number(times[1]));
    const wordAfter = s.match(new RegExp(`(?:${subj})\\s+(once|twice|thrice)\\b`));
    if (wordAfter) return NUMBER_WORDS[wordAfter[1]];
    const wordBefore = s.match(new RegExp(`\\b(once|twice|thrice)\\s+(?:${subj})`));
    if (wordBefore) return NUMBER_WORDS[wordBefore[1]];
    return 1;
  };

  return {
    pee: countNear("pee|peed|wee", hasPee),
    poop: countNear("poop|pooped|poo|poty|potty", hasPoop),
  };
}

function isDateHeader(line: string, defaultYear: number): { y: number; m: number; d: number } | null {
  const s = line.trim().replace(/[.,]+$/g, "").replace(/,/g, " ").replace(/\s+/g, " ").toLowerCase();
  const monthDay = s.match(/^([a-z]+)\s+(\d{1,2})(?:\s+(\d{4}))?$/);
  if (monthDay && MONTHS[monthDay[1]]) {
    return { y: monthDay[3] ? Number(monthDay[3]) : defaultYear, m: MONTHS[monthDay[1]], d: Number(monthDay[2]) };
  }
  const dayMonth = s.match(/^(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?$/);
  if (dayMonth && MONTHS[dayMonth[2]]) {
    return { y: dayMonth[3] ? Number(dayMonth[3]) : defaultYear, m: MONTHS[dayMonth[2]], d: Number(dayMonth[1]) };
  }
  return null;
}

function stripBullet(line: string): string {
  return line.replace(/^\s*[-*•]?\s*\[[ xX]?\]\s*/, "").replace(/^\s*[-*•]\s*/, "").trim();
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Read a positive, finite ml fix from the user-supplied map; null when absent/invalid. */
function readFix(fixes: Record<string, number> | undefined, skipKey: string): number | null {
  if (!fixes) return null;
  const raw = fixes[skipKey];
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return null;
  return raw;
}

/** A `fromZonedTime`-parseable wall-clock string for a calendar date + minutes. */
function wallClock(y: number, m: number, d: number, todMinutes: number): string {
  // Carry day overflow (dayOffset baked into todMinutes via the caller's date math).
  const hour = Math.floor(todMinutes / 60);
  const minute = todMinutes % 60;
  return `${y}-${pad2(m)}-${pad2(d)}T${pad2(hour)}:${pad2(minute)}:00`;
}

/* ------------------------------------------------------------------ */
/* feed extraction                                                     */
/* ------------------------------------------------------------------ */

type FeedHit = { kind: "formula" | "breast"; ml: number };

/**
 * ml amount tied to a specific feed keyword. Two shapes:
 *  - AFTER:  "formula milk 60 ml", "breast milk - 80ml", "formula -40ml"
 *  - BEFORE: "70 ml formula", "70 am formula" (am = ml typo), "60 milk breast"
 * The BEFORE form requires a unit token AND a `(?<![:;\d])` guard so a clock
 * minute ("8:00 am formula") is never mistaken for a volume.
 */
function amountForKeyword(s: string, keyword: string): number | null {
  const after = new RegExp(`${keyword}(?:\\s*milk)?\\s*[-–:(]*\\s*(\\d+(?:\\.\\d+)?)\\s*(?:ml|mil|gm)?`).exec(s);
  if (after && Number(after[1]) > 0) return Number(after[1]);
  const before = new RegExp(`(?<![:;\\d])(\\d+(?:\\.\\d+)?)\\s*(?:ml|mil|milk|gm|am)\\s*${keyword}`).exec(s);
  if (before && Number(before[1]) > 0) return Number(before[1]);
  return null;
}

/** First explicit "<n> ml" anywhere (the unit guards against grabbing a time). */
function anyExplicitMl(s: string): number | null {
  const m = s.match(/(\d+(?:\.\d+)?)\s*(?:ml|mil|gm)\b/);
  return m && Number(m[1]) > 0 ? Number(m[1]) : null;
}

function extractFeeds(rawLine: string): { feeds: FeedHit[]; breastNoAmount: boolean; formulaNoAmount: boolean } {
  const s = rawLine.toLowerCase();
  const hasFormula = /formula/.test(s);
  const hasBreast = /breast|brest/.test(s);
  const feeds: FeedHit[] = [];
  let breastNoAmount = false;
  let formulaNoAmount = false;

  if (hasFormula) {
    // On a single-feed line the ml may sit far from the word ("Formula milk at
    // 4:00 am - 50ml"); fall back to any explicit ml. On a two-feed line keep
    // the strict keyword-scoped match so the two amounts don't cross over.
    const ml = amountForKeyword(s, "formula") ?? (hasBreast ? null : anyExplicitMl(s));
    if (ml != null) feeds.push({ kind: "formula", ml });
    else formulaNoAmount = true;
  }

  if (hasBreast) {
    if (/\b1\s*breast\b/.test(s)) {
      feeds.push({ kind: "breast", ml: 15 });
    } else {
      const mins = s.match(/(\d+)\s*[-–]\s*(\d+)\s*min/) ?? s.match(/(\d+)\s*min/);
      const breastMl = amountForKeyword(s, "breast") ?? (hasFormula ? null : anyExplicitMl(s));
      if (mins) {
        feeds.push({ kind: "breast", ml: mins[2] ? minutesToMl(Number(mins[1]), Number(mins[2])) : minutesToMl(Number(mins[1])) });
      } else if (breastMl != null) {
        feeds.push({ kind: "breast", ml: breastMl });
      } else {
        breastNoAmount = true; // "little breast milk", bare "breast milk" → skip
      }
    }
  }

  return { feeds, breastNoAmount, formulaNoAmount };
}

/* ------------------------------------------------------------------ */
/* main parser                                                         */
/* ------------------------------------------------------------------ */

export function parseNotes(raw: string, opts: ImportOptions): ParseResult {
  const lines = raw.split(/\r?\n/);
  const events: ImportEvent[] = [];
  const skipped: SkippedLine[] = [];
  const warnings: string[] = [];

  let header: { y: number; m: number; d: number } | null = null;
  let headerLabel = "";
  let dayOffset = 0; // calendar days past the header (midnight crossings)
  let prevTod = 0; // last assigned minutes-of-day
  let lineIndexInDay = 0;
  let sawAnyTime = false;

  const toIso = (todMinutes: number): string => {
    const base = new Date(Date.UTC(header!.y, header!.m - 1, header!.d));
    base.setUTCDate(base.getUTCDate() + dayOffset);
    return zonedWallClockToIso(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), todMinutes, opts.timeZone);
  };

  for (const rawLineFull of lines) {
    const maybeHeader = isDateHeader(rawLineFull, opts.defaultYear);
    if (maybeHeader) {
      header = maybeHeader;
      headerLabel = formatLabel(header, opts.timeZone);
      dayOffset = 0;
      prevTod = 0;
      lineIndexInDay = 0;
      sawAnyTime = false;
      continue;
    }
    if (!header) continue; // preamble before the first date header

    const line = stripBullet(rawLineFull);
    if (line === "") continue;

    const isFeedLine = /formula|breast|brest|milk/.test(line.toLowerCase());
    const isDiaperLine = /pee|peed|wee|poop|pooped|poo|poty|potty/.test(line.toLowerCase());
    if (!isFeedLine && !isDiaperLine) continue;

    // --- resolve this line's timestamp ---
    const times = parseTimes(line);
    let todMinutes: number;
    if (times.length > 0) {
      const first = times[0];
      const explicit = explicitTod(first);
      const tod = explicit ?? inferBareTod(first, sawAnyTime ? prevTod : 0);
      if (sawAnyTime && tod < prevTod && tod < EARLY_AM_MIN && prevTod >= AFTERNOON_MIN) {
        dayOffset += 1; // PM → early-AM = crossed midnight into the next calendar day
      }
      todMinutes = tod;
      prevTod = tod;
      sawAnyTime = true;
    } else {
      // Untimed line: carry just past the previous entry so it stays in this day.
      todMinutes = Math.min(1439, prevTod + 1);
      prevTod = todMinutes;
    }
    const occurredAtIso = toIso(todMinutes);
    const keyBase = `${header.y}-${pad2(header.m)}-${pad2(header.d)}#${lineIndexInDay}`;
    lineIndexInDay += 1;

    // --- feeds ---
    if (isFeedLine) {
      const { feeds, breastNoAmount, formulaNoAmount } = extractFeeds(line);
      const fixOrSkip = (kind: "breast" | "formula", reason: string) => {
        const skipKey = `${keyBase}#skip#${kind}`;
        const fixMl = readFix(opts.fixes, skipKey);
        if (fixMl !== null) {
          events.push({
            type: "feed",
            kind,
            occurredAtIso,
            amount: { ml: fixMl, oz: mlToOz(fixMl) },
            rawLine: line,
            // `#fix` — distinct from inline-parsed feeds so the dedupe key stays
            // stable across re-imports even if the amount is edited.
            dedupeKey: `${keyBase}#feed#${kind}#fix`,
          });
          return;
        }
        skipped.push({ skipKey, rawLine: line, reason, dateLabel: headerLabel, kind, occurredAtIso });
      };
      if (breastNoAmount) fixOrSkip("breast", "breast feed with no amount written");
      if (formulaNoAmount) fixOrSkip("formula", "formula feed with no amount written");
      feeds.forEach((f, i) => {
        events.push({
          type: "feed",
          kind: f.kind,
          occurredAtIso,
          amount: { ml: f.ml, oz: mlToOz(f.ml) },
          rawLine: line,
          dedupeKey: `${keyBase}#feed#${f.kind}#${i}`,
        });
      });
    }

    // --- diapers (a line can be both a feed and a diaper) ---
    if (isDiaperLine) {
      const { pee, poop } = parseDiaperCounts(line);
      const rounded = (n: number) => Math.floor(n);
      const peeN = rounded(pee);
      const poopN = rounded(poop);
      if (!Number.isInteger(pee) || !Number.isInteger(poop)) {
        warnings.push(`${headerLabel}: rounded "${line}" down to ${peeN} wet / ${poopN} dirty`);
      }
      const changes = Math.max(peeN, poopN);
      for (let i = 0; i < changes; i++) {
        const isPee = i < peeN;
        const isPoop = i < poopN;
        if (!isPee && !isPoop) continue;
        events.push({
          type: "diaper",
          occurredAtIso: toIso(Math.min(1439, todMinutes + i)),
          pee: isPee,
          poop: isPoop,
          rawLine: line,
          dedupeKey: `${keyBase}#diaper#${i}`,
        });
      }
    }
  }

  return { events, perDay: buildPerDay(events, opts), skipped, warnings };
}

/* ------------------------------------------------------------------ */
/* per-day rollup (mirrors day-summary's reducer, for the preview)     */
/* ------------------------------------------------------------------ */

function buildPerDay(events: ImportEvent[], opts: ImportOptions): DayPreview[] {
  const dob = new Date(opts.dobIso);
  const groups = new Map<string, ImportEvent[]>();
  for (const e of events) {
    const start = getDayWindow(new Date(e.occurredAtIso), opts.timeZone, opts.dayStartHour).start.toISOString();
    const bucket = groups.get(start) ?? [];
    bucket.push(e);
    groups.set(start, bucket);
  }

  const birthWeightOz = opts.birthWeightOz ?? opts.currentWeightOz ?? 0;
  const days: DayPreview[] = [];
  for (const [dayStartIso, bucket] of groups) {
    let formulaMl = 0;
    let breastMl = 0;
    let feedCount = 0;
    let pee = 0;
    let poop = 0;
    for (const e of bucket) {
      if (e.type === "feed") {
        feedCount += 1;
        if (e.kind === "formula") formulaMl += e.amount.ml;
        else breastMl += e.amount.ml;
      } else {
        if (e.pee) pee += 1;
        if (e.poop) poop += 1;
      }
    }
    const ageDays = dayNumberSinceBirth(new Date(dayStartIso), dob, opts.timeZone, opts.dayStartHour);
    const band = dailyTargetRange({ ageDays, currentWeightOz: opts.currentWeightOz, birthWeightOz });
    const totalOz = mlToOz(formulaMl + breastMl);
    days.push({
      dayStartIso,
      label: new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: opts.timeZone }).format(new Date(dayStartIso)),
      ageDays,
      formula: { ml: formulaMl, oz: mlToOz(formulaMl) },
      breast: { ml: breastMl, oz: mlToOz(breastMl) },
      total: { ml: formulaMl + breastMl, oz: totalOz },
      targetLowOz: band.lowOz,
      targetHighOz: band.highOz,
      withinTarget: totalOz >= band.lowOz && totalOz <= band.highOz,
      feedCount,
      pee,
      poop,
    });
  }

  days.sort((a, b) => a.dayStartIso.localeCompare(b.dayStartIso));
  return days;
}

function formatLabel(h: { y: number; m: number; d: number }, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone }).format(
    new Date(Date.UTC(h.y, h.m - 1, h.d, 12)),
  );
}

/**
 * Convert a wall-clock (calendar date + minutes-of-day) in `timeZone` to a UTC
 * ISO instant — the inverse of how the rest of the app reads days, so an
 * imported event lands in the same logical-day window the dashboard uses.
 */
function zonedWallClockToIso(y: number, m: number, d: number, todMinutes: number, timeZone: string): string {
  return fromZonedTime(wallClock(y, m, d, todMinutes), timeZone).toISOString();
}
