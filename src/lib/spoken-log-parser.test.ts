import { describe, it, expect } from "vitest";

import { extractQuantity, parseSpokenLog } from "./spoken-log-parser";

describe("extractQuantity", () => {
  it("reads digits, including decimals", () => {
    expect(extractQuantity("2 ounces of formula")).toBe(2);
    expect(extractQuantity("2.5 oz")).toBe(2.5);
    expect(extractQuantity("nursed 15 minutes")).toBe(15);
  });

  it("reads single number words", () => {
    expect(extractQuantity("two ounces")).toBe(2);
    expect(extractQuantity("fifteen minutes")).toBe(15);
    expect(extractQuantity("three")).toBe(3);
  });

  it("composes tens and ones", () => {
    expect(extractQuantity("twenty five minutes")).toBe(25);
    expect(extractQuantity("thirty two")).toBe(32);
  });

  it("handles halves", () => {
    expect(extractQuantity("two and a half ounces")).toBe(2.5);
    expect(extractQuantity("2 and a half")).toBe(2.5);
    expect(extractQuantity("a half ounce")).toBe(0.5);
    expect(extractQuantity("half an ounce")).toBe(0.5);
  });

  it("treats 'an ounce' / 'a minute' as 1, but not 'a bottle'", () => {
    expect(extractQuantity("an ounce of formula")).toBe(1);
    expect(extractQuantity("a minute")).toBe(1);
    expect(extractQuantity("a bottle of formula")).toBeNull();
  });

  it("returns null when there is no quantity", () => {
    expect(extractQuantity("poop")).toBeNull();
    expect(extractQuantity("wet diaper")).toBeNull();
  });
});

describe("parseSpokenLog — diapers", () => {
  it("logs poop-only", () => {
    expect(parseSpokenLog("poop")).toEqual({
      ok: true,
      event: { type: "diaper", pee: false, poop: true },
    });
    expect(parseSpokenLog("dirty diaper")).toMatchObject({
      ok: true,
      event: { type: "diaper", pee: false, poop: true },
    });
  });

  it("logs pee-only", () => {
    expect(parseSpokenLog("pee")).toEqual({
      ok: true,
      event: { type: "diaper", pee: true, poop: false },
    });
    expect(parseSpokenLog("wet diaper")).toMatchObject({
      ok: true,
      event: { type: "diaper", pee: true, poop: false },
    });
  });

  it("logs both when wet and dirty appear together", () => {
    expect(parseSpokenLog("wet and dirty")).toMatchObject({
      ok: true,
      event: { type: "diaper", pee: true, poop: true },
    });
    expect(parseSpokenLog("pee and poop")).toMatchObject({
      ok: true,
      event: { type: "diaper", pee: true, poop: true },
    });
  });

  it("asks for clarification on a bare diaper", () => {
    const result = parseSpokenLog("diaper");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.say).toMatch(/wet, dirty, or both/i);
  });
});

describe("parseSpokenLog — feeds", () => {
  it("logs formula with ounces", () => {
    expect(parseSpokenLog("two ounces of formula")).toEqual({
      ok: true,
      event: { type: "feed", kind: "formula", volume_oz: 2 },
    });
    expect(parseSpokenLog("formula 3 oz")).toEqual({
      ok: true,
      event: { type: "feed", kind: "formula", volume_oz: 3 },
    });
  });

  it("logs pumped milk with ounces", () => {
    expect(parseSpokenLog("pumped 3 ounces")).toEqual({
      ok: true,
      event: { type: "feed", kind: "pumped", volume_oz: 3 },
    });
    expect(parseSpokenLog("three ounces of breast milk")).toEqual({
      ok: true,
      event: { type: "feed", kind: "pumped", volume_oz: 3 },
    });
  });

  it("logs nursing with duration and side", () => {
    expect(parseSpokenLog("nursed 15 minutes on the left")).toEqual({
      ok: true,
      event: { type: "feed", kind: "nursing", side: "left", duration_min: 15 },
    });
    expect(parseSpokenLog("breastfed 20 minutes on both sides")).toEqual({
      ok: true,
      event: { type: "feed", kind: "nursing", side: "both", duration_min: 20 },
    });
  });

  it("defaults nursing side to both when unstated", () => {
    expect(parseSpokenLog("nursed 10 minutes")).toEqual({
      ok: true,
      event: { type: "feed", kind: "nursing", side: "both", duration_min: 10 },
    });
  });

  it("reads 'breast milk' as nursing when minutes are given", () => {
    expect(parseSpokenLog("breast milk 12 minutes")).toEqual({
      ok: true,
      event: { type: "feed", kind: "nursing", side: "both", duration_min: 12 },
    });
  });

  it("asks how many minutes when nursing has no duration", () => {
    const result = parseSpokenLog("nursed on the left");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.say).toMatch(/how many minutes/i);
  });

  it("asks how many ounces when a bottle feed has no volume", () => {
    const result = parseSpokenLog("formula");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.say).toMatch(/how many ounces/i);
  });

  it("asks which kind when a bare bottle has ounces but no kind", () => {
    const result = parseSpokenLog("a bottle of two ounces");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.say).toMatch(/formula or pumped/i);
  });
});

describe("parseSpokenLog — diaper wins over feed lexicon", () => {
  it("keeps 'wet diaper' a diaper even though 'feed' words exist elsewhere", () => {
    expect(parseSpokenLog("wet diaper")).toMatchObject({
      ok: true,
      event: { type: "diaper", pee: true, poop: false },
    });
  });
});

describe("parseSpokenLog — unrecognized", () => {
  it("returns a helpful prompt for empty or off-topic input", () => {
    expect(parseSpokenLog("")).toMatchObject({ ok: false });
    const result = parseSpokenLog("hello there");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.say).toMatch(/try saying/i);
  });
});
