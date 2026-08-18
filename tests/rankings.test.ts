/**
 * The build-time read layer.
 *
 * The tests that matter here are about CLAIMS the page makes: that the grader
 * is named correctly, that a rank is computed rather than stored, and that a
 * size class the pipeline guessed is not displayed as one it knows.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  GRADER, isStaleGrade, BOARD_AXIS, COHORTS, cohortKeyOf, ranksFor,
  bandBadgeFor, ordinal, fmt, scoreBand, letterFor, scoresFor, reasonsFor,
  caseAgainstFor, CATEGORY_LABELS, DIMENSIONS, DIMENSION_KEYS, type Entry,
} from "../src/lib/rankings";
import { CATEGORIES, CATEGORY_NOT, sideFor } from "../functions/_lib/classify";

const entry = (over: Partial<Entry> = {}): Entry => ({
  slug: "acme", name: "Acme", domain: "acme.com", logo_url: null, one_liner: null,
  provisional: 0, category: "ssp", band: "growth", side: "sell",
  band_evidence: null, band_inferred: 1,
  grade: 3.4, originality: 4, defensibility: 3, traction: 3, execution: 4, durability: 3,
  reasons_json: "{}", case_against_json: "[]",
  summary: "", stack_json: "{}", model_used: GRADER.model, created_at: "", ...over,
});

describe("the grader", () => {
  it("is pinned, and a row graded by anything else is stale", () => {
    // The grader has no fallback ladder, so in normal operation nothing is
    // stale. This matters the day the pin moves: every existing row was graded
    // by a different instrument, and the board has to be able to say which.
    expect(isStaleGrade(GRADER.model)).toBe(false);
    expect(isStaleGrade("nvidia/nemotron-3-super-120b-a12b")).toBe(true);
  });

  it("does not treat a missing model as stale", () => {
    // An empty string means "not recorded", which is a gap, not a substitution.
    expect(isStaleGrade("")).toBe(false);
  });

  it("never invents a parameter count", () => {
    // Both numbers in the spec are published in the model's own name. A made-up
    // figure on a page whose whole premise is transparency is the one lie that
    // would discredit everything around it.
    expect(GRADER.spec).toMatch(/550B/);
    expect(GRADER.spec).toMatch(/55B/);
    expect(GRADER.model).toContain("550b");
    expect(GRADER.model).toContain("a55b");
  });
});

describe("the rubric", () => {
  it("has five dimensions and no more", () => {
    expect(DIMENSIONS).toHaveLength(5);
    expect(DIMENSION_KEYS).toEqual([
      "originality", "defensibility", "traction", "execution", "durability",
    ]);
  });

  it("names an icon PixelIcon can actually draw", () => {
    // `tools` was invented here and silently drew nothing: PixelIcon takes a
    // name from a closed set and has no fallback, so a typo is invisible until
    // someone looks at the page. Types do not catch it — the icon prop is cast.
    const source = readFileSync("src/components/ds/PixelIcon.astro", "utf8");
    for (const d of DIMENSIONS) {
      // Hyphenated keys are quoted in the map ("laptop-code":), bare ones are
      // not (bolt:). Accept either rather than assuming one.
      const declared = source.includes(`"${d.icon}":`) || source.includes(`\n  ${d.icon}:`);
      expect(declared, `PixelIcon has no "${d.icon}"`).toBe(true);
    }
  });

  it("gives every dimension a label, icon and question", () => {
    for (const d of DIMENSIONS) {
      expect(d.label.length).toBeGreaterThan(2);
      expect(d.icon.length).toBeGreaterThan(2);
      expect(d.question).toMatch(/\?$/);
    }
  });

  it("has no dimension asking whether to invest", () => {
    // The dimension this rubric replaced. It punished acquired companies by
    // construction: it asked about a transaction, so anything making the
    // transaction impossible read as a defect in the company.
    const text = JSON.stringify(DIMENSIONS).toLowerCase();
    expect(text).not.toContain("invest");
  });
});

describe("letter bands", () => {
  it("puts every boundary on the inclusive side", () => {
    // 3.5 is reachable (4,4,4,3,3) rather than theoretical, so an off-by-one
    // here misgrades real rows.
    expect(letterFor(4.5)).toBe("A");
    expect(letterFor(4.4)).toBe("B");
    expect(letterFor(3.5)).toBe("B");
    expect(letterFor(3.4)).toBe("C");
    expect(letterFor(2.5)).toBe("C");
    expect(letterFor(1.5)).toBe("D");
    expect(letterFor(1.4)).toBe("E");
  });

  it("agrees with the icon band at every boundary", () => {
    // The letter and the icon are two renderings of one decision; if they can
    // disagree, one of them is lying on every row in the gap.
    const solidAt = [5, 4.5].every((g) => scoreBand(g).solid);
    expect(solidAt).toBe(true);
    expect(letterFor(4.5)).toBe("A");
    expect(scoreBand(4.4).label).toBe("Genuinely interesting");
    expect(letterFor(4.4)).toBe("B");
  });
});

describe("reading a row", () => {
  it("pulls the five scores off the entry", () => {
    expect(scoresFor(entry())).toEqual({
      originality: 4, defensibility: 3, traction: 3, execution: 4, durability: 3,
    });
  });

  it("survives malformed JSON rather than failing the build", () => {
    // These columns are model output that went through JSON.stringify. A single
    // bad row must not take the whole static build down with it.
    expect(reasonsFor(entry({ reasons_json: "not json" }))).toEqual({});
    expect(caseAgainstFor(entry({ case_against_json: "not json" }))).toEqual([]);
    expect(caseAgainstFor(entry({ case_against_json: '{"a":1}' }))).toEqual([]);
  });

  it("reads the case against as a list of strings", () => {
    expect(caseAgainstFor(entry({ case_against_json: '["one","two"]' })))
      .toEqual(["one", "two"]);
  });
});

describe("category taxonomy", () => {
  it("labels every category the classifier can assign", () => {
    // CATEGORY_LABELS here and CATEGORIES in functions/_lib/classify.ts are
    // deliberate duplicates — Pages Functions bundle separately from the Astro
    // build, so a cross-boundary import is a thing you find out about at deploy
    // time. The cost of that choice is drift, and drift here is silent: an
    // unlabelled key renders as "Other" rather than throwing.
    for (const c of CATEGORIES) {
      expect(CATEGORY_LABELS[c.key], `no label for "${c.key}"`).toBeTruthy();
    }
  });

  it("gives the buy side somewhere to land", () => {
    // The bug this taxonomy change exists to fix: buy-side had three keys
    // against sell-side's seven, so buy-side vendors piled into "DSP & Media
    // Buying" or fell through to "Other" — which is independent. The tab
    // looked empty because the taxonomy had no room in it, not because the
    // companies were missing.
    const buy = CATEGORIES.filter((c) => sideFor(c.key) === "buy");
    const sell = CATEGORIES.filter((c) => sideFor(c.key) === "sell");
    expect(buy.length).toBeGreaterThanOrEqual(sell.length);
  });

  it("keeps agentic buying from swallowing every copilot", () => {
    // Newest category on the board and the easiest to inflate: without the
    // guard, anything with a chat box lands in it.
    expect(CATEGORY_NOT["agentic-buying"]).toMatch(/chatbot|copilot|bolted/i);
    expect(CATEGORY_NOT["retail-media-buying"]).toMatch(/sell-side/i);
  });
});

describe("the cohort axis", () => {
  it("groups entries by whichever axis is in force", () => {
    // BOARD_AXIS is one constant so the board can be flipped back to stage
    // bands the day funding data exists. Both shapes must group correctly.
    const e = entry();
    expect(cohortKeyOf(e)).toBe(BOARD_AXIS === "side" ? "sell" : "growth");
    expect(COHORTS.map((c) => c.key)).toContain(cohortKeyOf(e));
  });

  it("gives every cohort a label, icon and blurb", () => {
    for (const c of COHORTS) {
      expect(c.label).toBeTruthy();
      expect(c.icon).toBeTruthy();
      expect(c.blurb.length).toBeGreaterThan(20);
    }
  });
});

describe("ranks", () => {
  const board = [
    entry({ slug: "a", grade: 4.6, category: "ssp", side: "sell" }),
    entry({ slug: "b", grade: 3.8, category: "ssp", side: "sell" }),
    entry({ slug: "c", grade: 2.4, category: "dsp", side: "buy" }),
  ];

  it("positions a company inside its own cohort, not the whole board", () => {
    const r = ranksFor(board[2], board);
    // Third overall, but first among buy-side — which is the point of cohorts.
    expect(r.cohortRank).toBe(1);
    expect(r.cohortSize).toBe(1);
  });

  it("counts the subcategory separately", () => {
    const r = ranksFor(board[1], board);
    expect(r.categoryRank).toBe(2);
    expect(r.categorySize).toBe(2);
  });
});

describe("the stage badge", () => {
  it("shows nothing when the band was guessed", () => {
    // An inferred band is the middle-band default wearing a label. Printing it
    // the same way as an evidenced one would have the page claim knowledge it
    // does not have — and since stage is stated on well under a fifth of adtech
    // sites, that would be the common case rather than the edge.
    expect(bandBadgeFor(entry({ band_inferred: 1, band_evidence: "guessed" }))).toBeNull();
  });

  it("shows the band when something established it", () => {
    const badge = bandBadgeFor(entry({ band_inferred: 0, band_evidence: "announces a Series B" }));
    expect(badge?.label).toBe("Growth");
    expect(badge?.evidence).toMatch(/Series B/);
  });
});

describe("presentation", () => {
  it("writes ranks as ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal))
      .toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"]);
  });

  it("never renders a trailing .0", () => {
    expect(fmt(20)).toBe("20");
    expect(fmt(20.1)).toBe("20.1");
  });

  it("bands the grade on the 1-5 scale, not out of thirty", () => {
    // The thresholds moved with the scale. A /30 threshold here would put every
    // company on the board in the bottom band.
    expect(scoreBand(4.6).label).toBe("Exceptional");
    expect(scoreBand(3.6).label).toBe("Genuinely interesting");
    expect(scoreBand(1.2).label).toBe("Brutal");
  });
});
