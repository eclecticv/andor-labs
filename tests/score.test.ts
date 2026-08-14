/**
 * The scorer's clamps and fallbacks. Not the model's judgement — that is not a
 * stable thing to assert on — but everything that decides what happens to it.
 */
import { describe, expect, it } from "vitest";
import {
  normalizeScore, assertScoreUsable, buildPrompt, DIMENSIONS, CATEGORY_KEYS,
} from "../functions/_lib/score";

const full = (over: Record<string, unknown> = {}) =>
  normalizeScore({
    eligible: true, name: "Acme", oneLiner: "AI for sales.",
    category: "curation", stage: "seed",
    positioning: { score: 18, reasoning: "x".repeat(120), improve: "Name the buyer." },
    content:     { score: 10, reasoning: "x".repeat(120), improve: "Write for buyers." },
    gtm_stack:   { score: 12, reasoning: "x".repeat(120), improve: "Add analytics." },
    innovation:  { score: 20, reasoning: "x".repeat(120), improve: "Show the hard part." },
    verdict: "y".repeat(80),
    ...over,
  });

describe("totals", () => {
  it("sums the four dimensions in code, never from the model", () => {
    // The model is not asked for a total at all; one asked for prose and a
    // number returns prose arguing for 80 beside a total of 40.
    expect(full().total).toBe(18 + 10 + 12 + 20);
  });

  it("cannot exceed 100 even when every axis is maxed", () => {
    const r = full({
      positioning: { score: 99, reasoning: "x".repeat(120), improve: "a" },
      content:     { score: 99, reasoning: "x".repeat(120), improve: "a" },
      gtm_stack:   { score: 99, reasoning: "x".repeat(120), improve: "a" },
      innovation:  { score: 99, reasoning: "x".repeat(120), improve: "a" },
    });
    expect(r.total).toBe(100);
    for (const d of DIMENSIONS) expect(r.dimensions[d.key].score).toBe(25);
  });

  it("treats junk scores as zero rather than NaN", () => {
    const r = full({ positioning: { score: "banana", reasoning: "x".repeat(120), improve: "a" } });
    expect(r.dimensions.positioning.score).toBe(0);
    expect(Number.isNaN(r.total)).toBe(false);
  });
});

describe("category and stage", () => {
  // Cohorts are category x stage, so a free-text category is the same as no
  // category — two companies doing the same thing would never meet.
  it("forces an unknown category to 'other'", () => {
    expect(full({ category: "AI curation platform" }).category).toBe("other");
    expect(full({ category: "CURATION" }).category).toBe("curation");
  });

  it("accepts every category in the closed set", () => {
    for (const c of CATEGORY_KEYS) expect(full({ category: c }).category).toBe(c);
  });

  // The taxonomy is adtech-specific now, not generic AI verticals. A generic
  // key must not survive, or cohorts fill with companies that share a word
  // rather than a place in the supply chain.
  it("rejects the generic AI categories it used to accept", () => {
    for (const old of ["sales", "marketing", "support", "coding", "health"]) {
      expect(full({ category: old }).category).toBe("other");
    }
  });

  it("normalises stage spacing and falls back to unknown", () => {
    expect(full({ stage: "Series A" }).stage).toBe("series-a");
    expect(full({ stage: "growth" }).stage).toBe("unknown");
  });
});

describe("usability", () => {
  it("rejects a result whose reasoning is empty", () => {
    const r = full({ content: { score: 10, reasoning: "too short", improve: "a" } });
    expect(() => assertScoreUsable(r)).toThrow(/reasoning too thin/);
  });

  it("rejects a result with no improvement line — that is the CTA", () => {
    const r = full({ gtm_stack: { score: 10, reasoning: "x".repeat(120), improve: "" } });
    expect(() => assertScoreUsable(r)).toThrow(/improvement line/);
  });

  it("lets an ineligible verdict through without dimensions", () => {
    const r = normalizeScore({ eligible: false, ineligibleReason: "This is a consultancy.", name: "X" });
    expect(() => assertScoreUsable(r)).not.toThrow();
  });
});

describe("the prompt", () => {
  const p = buildPrompt({
    domain: "acme.com", pages: "hello", detected: [], coreCoverage: 0,
    openRoles: 0, sitemapUrlCount: null, stageNotes: [], thin: false,
  });

  // Positioning, content and stack maturity all improve with funding. Without
  // this instruction the score measures money, which is the bias this tool has
  // had designed out of it three times.
  it("always instructs stage-relative judgement", () => {
    expect(p).toMatch(/REASONABLE AT THIS COMPANY'S STAGE/);
  });

  it("tells the model absence of detected tooling is weak evidence", () => {
    expect(p).toMatch(/absence is weak evidence/);
  });

  it("warns when the site barely rendered", () => {
    const thin = buildPrompt({
      domain: "a.com", pages: "", detected: [], coreCoverage: 0,
      openRoles: 0, sitemapUrlCount: null, stageNotes: [], thin: true,
    });
    expect(thin).toMatch(/BARELY RENDERED/);
  });
});
