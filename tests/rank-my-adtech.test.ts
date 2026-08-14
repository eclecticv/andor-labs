/**
 * Tests for the parts of the ranking pipeline that must not drift.
 *
 * Deliberately not tests of the models. What a model says about a company is
 * not a stable thing to assert on, and pinning it would only tell us the
 * provider changed a checkpoint. What IS worth pinning is everything that
 * decides what happens to a model's answer: the clamps, the fallbacks, and the
 * arithmetic. Those are the places where a quiet change produces a wrong number
 * on a public page rather than a visible failure.
 */
import { describe, expect, it } from "vitest";
import {
  averageScores,
  clampInt,
  normalizeDomain,
  normalizeGate,
  normalizeTake,
  slugify,
  extractJson,
} from "../functions/api/rank-my-adtech";
import { scoreBand } from "../src/lib/rankings";

const gate = (over: Record<string, unknown> = {}) =>
  normalizeGate({ isAdtech: true, name: "Acme", oneLiner: "Ads.", ...over });

describe("the division fallback", () => {
  // This is the bug that shipped once already. Defaulting an unclassifiable
  // company to featherweight drops large companies into the division that
  // exists to protect small ones, which is the exact unfairness divisions were
  // added to prevent.
  it("falls back to middleweight, never featherweight", () => {
    expect(gate({ division: undefined }).division).toBe("middleweight");
    expect(gate({ division: "cruiserweight" }).division).toBe("middleweight");
    expect(gate({ division: "" }).division).toBe("middleweight");
  });

  it("keeps a division the model actually chose", () => {
    expect(gate({ division: "heavyweight" }).division).toBe("heavyweight");
    expect(gate({ division: "featherweight" }).division).toBe("featherweight");
  });
});

describe("founded year", () => {
  it("rejects years that cannot be real", () => {
    expect(gate({ foundedYear: 1723 }).foundedYear).toBeNull();
    expect(gate({ foundedYear: 3000 }).foundedYear).toBeNull();
    expect(gate({ foundedYear: "not a year" }).foundedYear).toBeNull();
  });

  it("keeps a plausible one", () => {
    expect(gate({ foundedYear: 2017 }).foundedYear).toBe(2017);
  });
});

describe("axis clamping", () => {
  // The database enforces these too. Both layers are deliberate: the clamp
  // keeps a non-compliant model from failing the write, and the constraint
  // keeps a broken clamp from publishing 150/100.
  it("holds each axis inside its own maximum", () => {
    const take = normalizeTake(
      { paradigm: 999, nonObviousness: 99, vibeCode: -5, conviction: 14.6 },
      "gemini",
      "m",
      "engineer",
    );
    expect(take.paradigm).toBe(40);
    expect(take.nonObviousness).toBe(25);
    expect(take.vibeCode).toBe(0);
    expect(take.conviction).toBe(15);
  });

  it("treats junk as zero rather than NaN", () => {
    expect(clampInt("banana", 40)).toBe(0);
    expect(clampInt(null, 40)).toBe(0);
    expect(clampInt(undefined, 25)).toBe(0);
  });
});

describe("averaging the panel", () => {
  const take = (p: number, n: number, v: number, c: number, abstained = false) => ({
    provider: "x", modelId: "m", lens: "vc" as const,
    paradigm: p, nonObviousness: n, vibeCode: v, conviction: c,
    quote: "", abstained,
  });

  it("ignores abstaining jurors instead of averaging in their zeroes", () => {
    // The whole point: a dead provider must cost an opinion, not the score.
    // Averaging its zeroes in would silently halve a company's ranking.
    const scores = averageScores([take(40, 25, 20, 15), take(0, 0, 0, 0, true)]);
    expect(scores).toEqual({ paradigm: 40, nonObviousness: 25, vibeCode: 20, conviction: 15 });
  });

  it("never exceeds 100 in total, even at every maximum", () => {
    const s = averageScores([take(40, 25, 20, 15), take(40, 25, 20, 15), take(40, 25, 20, 15)]);
    expect(s.paradigm + s.nonObviousness + s.vibeCode + s.conviction).toBe(100);
  });

  it("returns zeroes rather than NaN when the whole panel abstained", () => {
    const s = averageScores([take(0, 0, 0, 0, true)]);
    expect(s.paradigm).toBe(0);
    expect(Number.isNaN(s.paradigm)).toBe(false);
  });
});

describe("domain normalisation", () => {
  it("reduces any reasonable input to a bare host", () => {
    expect(normalizeDomain("https://www.Magnite.com/products/")).toBe("magnite.com");
    expect(normalizeDomain("id5.io")).toBe("id5.io");
    expect(normalizeDomain("  HTTP://example.co.uk  ")).toBe("example.co.uk");
  });

  it("refuses things that are not domains", () => {
    expect(normalizeDomain("localhost")).toBeNull();
    expect(normalizeDomain("javascript:alert(1)")).toBeNull();
    expect(normalizeDomain("")).toBeNull();
  });
});

describe("slugs", () => {
  it("produces url-safe slugs and drops edge punctuation", () => {
    expect(slugify("The Trade Desk")).toBe("the-trade-desk");
    expect(slugify("!!! Weird & Co. !!!")).toBe("weird-co");
  });
});

describe("reading a model's JSON", () => {
  it("survives fences and surrounding prose", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! Here you go: {"a":2} Hope that helps.')).toEqual({ a: 2 });
  });

  it("throws when there is genuinely no object", () => {
    expect(() => extractJson("no json at all")).toThrow();
  });
});

describe("score bands", () => {
  // Only the top band is a solid glyph, and solid is what renders blue. If this
  // ever returns solid:true lower down, every row on the board turns blue and
  // the emphasis system stops meaning anything.
  it("reserves the solid mark for 85 and above", () => {
    expect(scoreBand(90).solid).toBe(true);
    expect(scoreBand(85).solid).toBe(true);
    expect(scoreBand(84).solid).toBe(false);
    expect(scoreBand(0).solid).toBe(false);
  });

  it("gives the bottom band the mask", () => {
    expect(scoreBand(39).icon).toBe("hockey-mask");
    expect(scoreBand(40).icon).toBe("face-thinking");
  });
});
