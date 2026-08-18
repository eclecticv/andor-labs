/**
 * The grader.
 *
 * Everything here is about the two things a bad grade looks like from the
 * outside: a number that does not mean what the rubric says it means, and a
 * malformed model response that gets published instead of retried.
 *
 * No network. `runGrader` is not exercised — the ladder is providers.ts's
 * problem. What is exercised is every pure function between the model's bytes
 * and the database row.
 */
import { describe, expect, it } from "vitest";
import {
  DIMENSIONS, DIMENSION_KEYS, GRADER, gradeOf, letterFor,
  normalizeGrade, assertGradeUsable, recallFrom, buildGraderPrompt,
  buildGraderSystem, type Grade,
} from "../functions/_lib/grader";
import { CATEGORIES, CATEGORY_NOT } from "../functions/_lib/classify";

const raw = (over: Record<string, unknown> = {}) => ({
  case_against: ["thin on proof", "no named integrations", "one platform away from irrelevance"],
  originality: { score: 4, reason: "first to package curation as a bidder-side product" },
  defensibility: { score: 3, reason: "names twelve OpenRTB integrations, no depth given" },
  traction: { score: 3, reason: "four named publishers, no volumes" },
  execution: { score: 4, reason: "public API reference and a dated changelog" },
  durability: { score: 3, reason: "depends on the curation category surviving" },
  summary: "A curation platform that packages deals for buy-side seats, with real integration breadth and thin public proof of use.",
  category: "curation",
  funding: { round: "series-a", year: 2024, investor: "Example Ventures" },
  ...over,
});

describe("the rubric", () => {
  it("is five dimensions, in a fixed order", () => {
    expect(DIMENSION_KEYS).toEqual([
      "originality", "defensibility", "traction", "execution", "durability",
    ]);
  });

  it("anchors every dimension from 1 to 5 with no gaps", () => {
    // An anchored scale is the whole determinism argument — temperature 0 only
    // removes sampling noise. A missing band is a band the model has to invent.
    for (const d of DIMENSIONS) {
      for (const band of [1, 2, 3, 4, 5]) {
        expect(d.anchors).toMatch(new RegExp(`^${band} —`, "m"));
      }
    }
  });

  it("tells the grader that acquisition is an outcome, not a verdict", () => {
    // This is the fix. Without it the model reads "acquired by X" as a defect,
    // which is what the dimension it replaced did to every good outcome on the
    // board.
    const durability = DIMENSIONS.find((d) => d.key === "durability")!;
    expect(durability.anchors).toMatch(/acquisition is an outcome, not a verdict/i);
    expect(durability.anchors).toMatch(/never score down merely because a company was acquired/i);
  });

  it("asks no dimension to imagine a transaction", () => {
    const text = JSON.stringify(DIMENSIONS).toLowerCase();
    expect(text).not.toContain("would you invest");
    expect(text).not.toContain("write a cheque");
  });

  it("makes defensibility name a bottleneck from a closed list", () => {
    // "Could this be vibe-coded" produced rave scores, because a model
    // pattern-matches a feature list to a weekend build and a feature list is
    // mostly what a homepage is.
    const d = DIMENSIONS.find((x) => x.key === "defensibility")!;
    expect(d.ask).toMatch(/choose from/i);
    expect(d.ask).toMatch(/openrtb/i);
    expect(d.ask).toMatch(/that is a valid and common finding/i);
  });
});

describe("grade arithmetic", () => {
  it("averages the five to one decimal", () => {
    expect(gradeOf({ originality: 4, defensibility: 3, traction: 3, execution: 4, durability: 3 }))
      .toBe(3.4);
  });

  it("lands on 0.2 steps, which is what keeps ties rare", () => {
    // Five integers in 1-5 produce 21 distinct means. Rounding to whole numbers
    // would collapse those into 5 and put most of a board in a three-way tie.
    const means = new Set<number>();
    for (let a = 1; a <= 5; a++) for (let b = 1; b <= 5; b++) for (let c = 1; c <= 5; c++)
      for (let d = 1; d <= 5; d++) for (let e = 1; e <= 5; e++)
        means.add(gradeOf({ originality: a, defensibility: b, traction: c, execution: d, durability: e }));
    expect(means.size).toBe(21);
    expect(Math.min(...means)).toBe(1);
    expect(Math.max(...means)).toBe(5);
  });

  it("puts every letter boundary on the inclusive side", () => {
    expect(letterFor(5)).toBe("A");
    expect(letterFor(4.5)).toBe("A");
    expect(letterFor(4.4)).toBe("B");
    expect(letterFor(3.5)).toBe("B");
    expect(letterFor(3.4)).toBe("C");
    expect(letterFor(2.5)).toBe("C");
    expect(letterFor(2.4)).toBe("D");
    expect(letterFor(1.5)).toBe("D");
    expect(letterFor(1.4)).toBe("E");
    expect(letterFor(1)).toBe("E");
  });
});

describe("normalising what came back", () => {
  it("reads a well-formed response", () => {
    const g = normalizeGrade(raw(), GRADER.model);
    expect(g.grade).toBe(3.4);
    expect(g.letter).toBe("C");
    expect(g.scores.originality.score).toBe(4);
    expect(g.caseAgainst).toHaveLength(3);
    expect(g.category).toBe("curation");
    expect(g.modelUsed).toBe(GRADER.model);
  });

  it("clamps a score the model invented outside the scale", () => {
    // A structured-output schema makes the shape likely, not certain. A model
    // that answers 8 on a 1-5 scale has reinvented the scale, and 8 would fail
    // the database CHECK and lose the whole ranking.
    const g = normalizeGrade(raw({ originality: { score: 8, reason: "x".repeat(20) } }), "m");
    expect(g.scores.originality.score).toBe(5);
    const low = normalizeGrade(raw({ traction: { score: 0, reason: "x".repeat(20) } }), "m");
    expect(low.scores.traction.score).toBe(1);
  });

  it("rounds a decimal score to a band rather than storing it", () => {
    // The column is INTEGER. A 3.5 here means the model averaged something of
    // its own, and there is no averaging left to do.
    const g = normalizeGrade(raw({ execution: { score: 3.6, reason: "x".repeat(20) } }), "m");
    expect(g.scores.execution.score).toBe(4);
  });

  it("takes a score sent as a string", () => {
    const g = normalizeGrade(raw({ durability: { score: "4", reason: "x".repeat(20) } }), "m");
    expect(g.scores.durability.score).toBe(4);
  });

  it("falls back to the neutral band when a dimension is missing entirely", () => {
    const g = normalizeGrade(raw({ traction: undefined }), "m");
    expect(g.scores.traction.score).toBe(3);
    expect(g.scores.traction.reason).toBe("");
  });

  it("survives a response that is not an object at all", () => {
    // extractJson can hand back a string or null when a model answered in prose.
    expect(() => normalizeGrade(null, "m")).not.toThrow();
    expect(() => normalizeGrade("nope", "m")).not.toThrow();
    expect(normalizeGrade(null, "m").grade).toBe(3);
  });

  it("keeps at most three items in the case against", () => {
    const g = normalizeGrade(raw({ case_against: ["a", "b", "c", "d", "e"] }), "m");
    expect(g.caseAgainst).toHaveLength(3);
  });

  it("normalises the funding round the way the classifier expects it", () => {
    const g = normalizeGrade(raw({ funding: { round: "Series B", year: "2023", investor: " Acme " } }), "m");
    expect(g.funding.round).toBe("series-b");
    expect(g.funding.year).toBe(2023);
    expect(g.funding.investor).toBe("Acme");
  });
});

describe("refusing an unusable answer", () => {
  // These throw so the ladder treats the attempt as a failed rung and retries,
  // rather than publishing something empty. Each one describes a failure that
  // would visibly break the page.
  const parsed = (over: Record<string, unknown> = {}): Grade =>
    normalizeGrade(raw(over), GRADER.model);

  it("accepts a complete answer", () => {
    expect(() => assertGradeUsable(parsed())).not.toThrow();
  });

  it("rejects a summary too short to be a verdict", () => {
    expect(() => assertGradeUsable(parsed({ summary: "Good." }))).toThrow(/summary too short/);
  });

  it("rejects a score with no reason behind it", () => {
    // A number with no pointer to evidence is indistinguishable from a guess,
    // and the company page renders the reason directly under the score.
    expect(() => assertGradeUsable(parsed({ traction: { score: 4, reason: "yes" } })))
      .toThrow(/no reason given for: traction/);
  });

  it("rejects a case against that barely tried", () => {
    expect(() => assertGradeUsable(parsed({ case_against: ["only one"] })))
      .toThrow(/at least 2/);
  });
});

describe("the prompt", () => {
  const input = {
    domain: "example.com", pages: "PAGE TEXT", thin: false,
    categories: CATEGORIES, categoryNotes: CATEGORY_NOT,
  };

  it("demands the case against before any score exists", () => {
    const p = buildGraderPrompt(input);
    expect(p.indexOf("BEFORE YOU SCORE ANYTHING")).toBeLessThan(p.indexOf("HOW TO SCORE"));
  });

  it("starts every dimension at the neutral band", () => {
    expect(buildGraderPrompt(input)).toMatch(/Start every dimension at 3/);
  });

  it("carries every dimension and every category key", () => {
    const p = buildGraderPrompt(input);
    for (const d of DIMENSIONS) expect(p).toContain(d.key.toUpperCase());
    for (const c of CATEGORIES) expect(p).toContain(c.key);
  });

  it("warns the grader when the site barely rendered", () => {
    expect(buildGraderPrompt({ ...input, thin: true })).toMatch(/BARELY RENDERED/);
    expect(buildGraderPrompt(input)).not.toMatch(/BARELY RENDERED/);
  });

  it("turns Nemotron's reasoning on in the system message", () => {
    // The line is load-bearing and undocumented anywhere else: without the
    // literal string, this model family ships with reasoning off and you pay
    // reasoning latency for a non-reasoning answer.
    expect(buildGraderSystem().startsWith("detailed thinking on")).toBe(true);
  });

  it("keeps the character out of the rubric", () => {
    // The rubric is the published artifact — it appears verbatim on the page.
    // The system message is the part that never needs to.
    expect(buildGraderPrompt(input)).not.toContain("You are not a marketer");
  });
});

describe("recall", () => {
  it("reports the grader's read with a vote of one", () => {
    const r = recallFrom(normalizeGrade(raw(), GRADER.model));
    expect(r.category).toBe("curation");
    expect(r.round).toBe("series-a");
    expect(r.roundYear).toBe(2024);
    expect(r.roundVotes).toBe(1);
    expect(r.evidence).toMatch(/series a in 2024/i);
  });

  it("abstains when the round has no year behind it", () => {
    // A round without a year was always treated as a guess rather than recall:
    // "series-b" alone is a common enough string to hit by chance.
    const r = recallFrom(normalizeGrade(raw({ funding: { round: "seed", year: 0, investor: "" } }), "m"));
    expect(r.round).toBe("");
    expect(r.roundVotes).toBe(0);
    expect(r.evidence).toBe("");
  });

  it("abstains when the grader named no round at all", () => {
    const r = recallFrom(normalizeGrade(raw({ funding: { round: "", year: 0, investor: "" } }), "m"));
    expect(r.round).toBe("");
    expect(r.categoryVotes).toBe(1);
  });
});
