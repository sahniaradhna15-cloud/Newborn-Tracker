import { describe, it, expect } from "vitest";

import {
  mlToOz,
  minutesToMl,
  parseDiaperCounts,
  parseTimes,
  parseNotes,
  type ImportOptions,
} from "./notes-import";

const OPTS: ImportOptions = {
  dobIso: "2026-04-23T19:00:00Z", // Anay, 2pm CDT
  timeZone: "America/Chicago",
  dayStartHour: 4,
  defaultYear: 2026,
  birthWeightOz: 109,
  currentWeightOz: null,
};

describe("mlToOz", () => {
  it("converts at ~30 ml = 1 oz, rounded to 0.1", () => {
    expect(mlToOz(30)).toBe(1);
    expect(mlToOz(60)).toBe(2);
    expect(mlToOz(100)).toBe(3.4);
    expect(mlToOz(5)).toBe(0.2);
  });
});

describe("minutesToMl — the user's own table", () => {
  it("maps single durations to her buckets", () => {
    expect(minutesToMl(5)).toBe(5);
    expect(minutesToMl(8)).toBe(12);
    expect(minutesToMl(10)).toBe(20);
    expect(minutesToMl(12)).toBe(20);
    expect(minutesToMl(15)).toBe(20);
    expect(minutesToMl(25)).toBe(30);
  });
  it("collapses ranges via the midpoint", () => {
    expect(minutesToMl(5, 8)).toBe(12);
    expect(minutesToMl(20, 25)).toBe(30);
  });
});

describe("parseDiaperCounts", () => {
  it("counts each substance independently and adjacently", () => {
    expect(parseDiaperCounts("2 pee and 2 poop")).toEqual({ pee: 2, poop: 2 });
    expect(parseDiaperCounts("Pee twice and poop once")).toEqual({ pee: 2, poop: 1 });
    expect(parseDiaperCounts("Peed and poop twice")).toEqual({ pee: 1, poop: 2 });
    expect(parseDiaperCounts("Poop - 4 times")).toEqual({ pee: 0, poop: 4 });
    expect(parseDiaperCounts("Pee and poop")).toEqual({ pee: 1, poop: 1 });
    expect(parseDiaperCounts("Pee")).toEqual({ pee: 1, poop: 0 });
    expect(parseDiaperCounts("10:00 am- 2 pee and poop")).toEqual({ pee: 2, poop: 1 });
    expect(parseDiaperCounts("poty")).toEqual({ pee: 0, poop: 1 });
  });
});

describe("parseTimes", () => {
  it("reads colon/semicolon times and bare hour+meridiem, ignores ml typos", () => {
    expect(parseTimes("9;45- 70ml formula")).toEqual([{ hour: 9, minute: 45, meridiem: null, at: 0 }]);
    expect(parseTimes("3 am- 70ml formula")[0]).toMatchObject({ hour: 3, minute: 0, meridiem: "am" });
    expect(parseTimes("6:30am pee")[0]).toMatchObject({ hour: 6, minute: 30, meridiem: "am" });
    const range = parseTimes("10:24-12:30 pm- formula milk - 60ml");
    expect(range[0]).toMatchObject({ hour: 10, minute: 24 });
  });
});

describe("parseNotes — a clean controlled day", () => {
  const notes = `May 12 2026
- [ ] 6:15am- 80 ml breast milk
- [ ] 9:15am- 100 ml formula milk
- [ ] 1 pm Breast milk -10 mins
- [ ] 2:15 pm-40 ml formula
- [ ] 5:30 pm- 80 ml formula milk
- [ ] Pee and poop
- [ ] 8:00 pm- 67ml formula milk
- [ ] 11:15pm- 60 ml formula milk
- [ ] 2:30 am- 65 ml formula milk`;

  it("rolls all entries (incl. the 2:30am tail) into one logical day with correct totals", () => {
    const { perDay, skipped } = parseNotes(notes, OPTS);
    expect(perDay).toHaveLength(1);
    const day = perDay[0];
    expect(day.formula.oz).toBe(13.9); // 412 ml
    expect(day.breast.oz).toBe(3.4); // 80 ml bottle + 10 min→20 ml
    expect(day.total.oz).toBe(17.3); // 512 ml
    expect(day.feedCount).toBe(8);
    expect(day.pee).toBe(1);
    expect(day.poop).toBe(1);
    expect(skipped).toHaveLength(0);
  });
});

describe("parseNotes — combined feeds on one line", () => {
  it("splits 'X mins breast … along with Y ml formula' into two feeds", () => {
    const { events } = parseNotes(
      `May 13 2026\n- [ ] 8:00 am- 10 mins breast milk along with 97ml formula milk`,
      OPTS,
    );
    const feeds = events.filter((e) => e.type === "feed");
    expect(feeds).toHaveLength(2);
    const breast = feeds.find((f) => f.type === "feed" && f.kind === "breast");
    const formula = feeds.find((f) => f.type === "feed" && f.kind === "formula");
    expect(breast && breast.type === "feed" && breast.amount.ml).toBe(20);
    expect(formula && formula.type === "feed" && formula.amount.ml).toBe(97);
  });
});

describe("parseNotes — breast feeds with no amount are skipped", () => {
  it("skips 'little breast milk' and bare 'breast milk', keeps the formula", () => {
    const { events, skipped } = parseNotes(
      `May 1 2026
- [ ] 11:30-12pm-breast milk
- [ ] 4-6pm-> little breast milk
- [ ] 8:00am- formula milk 60 ml`,
      OPTS,
    );
    const feeds = events.filter((e) => e.type === "feed");
    expect(feeds).toHaveLength(1);
    expect(skipped).toHaveLength(2);
    expect(skipped.every((s) => /no amount/.test(s.reason))).toBe(true);
  });
});

describe("parseNotes — pre-4am first feed lands on the previous logical day", () => {
  it("splits a 3am feed onto the day before, per the 4am day-start", () => {
    const { perDay } = parseNotes(`April 29 2026\n- [ ] 3 am- 70ml formula\n- [ ] 7 am- 80ml formula`, OPTS);
    expect(perDay).toHaveLength(2);
    expect(perDay[0].total.oz).toBe(2.4); // 70 ml → previous logical day (Apr 28)
    expect(perDay[1].total.oz).toBe(2.7); // 80 ml → Apr 29
    expect(perDay[0].label).toContain("Apr 28");
  });
});

describe("parseNotes — out-of-order times stay on the same day", () => {
  it("does not start a new day when an earlier time is logged after a later one", () => {
    // "1:10 pm" logged before "11:00 am" must NOT roll to the next day.
    const { perDay } = parseNotes(
      `May 17 2026
- [ ] 7:30 am- 60 ml formula milk
- [ ] 1:10 pm- 65 ml formula milk
- [ ] 11:00 am- 10 mins breast milk
- [ ] 5:30 pm - 90 ml formula milk`,
      OPTS,
    );
    expect(perDay).toHaveLength(1);
    expect(perDay[0].feedCount).toBe(4);
  });
});

describe("parseNotes — amount written after the time", () => {
  it("captures ml that sits far from the keyword on a single-feed line", () => {
    const { events } = parseNotes(
      `May 18 2026
- [ ] Breast milk at 7 am - 80ml
- [ ] Formula milk at 4:00 pm - 50ml`,
      OPTS,
    );
    const feeds = events.filter((e) => e.type === "feed");
    const breast = feeds.find((f) => f.type === "feed" && f.kind === "breast");
    const formula = feeds.find((f) => f.type === "feed" && f.kind === "formula");
    expect(breast && breast.type === "feed" && breast.amount.ml).toBe(80);
    expect(formula && formula.type === "feed" && formula.amount.ml).toBe(50);
  });
});

describe("parseNotes — real multi-day excerpt", () => {
  const real = `April 30 2026
- [ ] 4:30am- 60 ml formula
- [ ] 8:50am -breast + 55ml formula
- [ ] 8:50am- pee n poop
- [ ] Pee and poty -12pm
- [ ] Breast milk- 25 mins -2pm
- [ ] 4:30 pm - pee n poop
- [ ] 5pm- 50ml formula milk
- [ ] 8:15pm- 35 ml formula
- [ ] 10:15pm- pee and poop
- [ ] 10:20- breast milk ( little bit)
- [ ] Pee and poop
- [ ] 1:05am- 55ml formula milk `;

  it("parses formula + breast(min) and skips the no-amount breast", () => {
    const { perDay, skipped } = parseNotes(real, OPTS);
    // 60+55+50+35+55 = 255 ml formula; breast 25min→30 ml. All on Apr 30 logical day
    // (1:05am tail folds back; 4:30am ≥ 4am start).
    const apr30 = perDay.find((d) => d.label.includes("Apr 30"));
    expect(apr30).toBeDefined();
    expect(apr30!.formula.ml).toBe(255);
    expect(apr30!.breast.ml).toBe(30);
    // "breast + 55ml formula" → breast no amount skipped; "( little bit)" skipped.
    expect(skipped.length).toBeGreaterThanOrEqual(2);
  });
});
