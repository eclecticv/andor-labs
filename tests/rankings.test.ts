/**
 * The build-time read layer.
 *
 * The tests that matter here are about CLAIMS the page makes: that every model
 * on the panel is named correctly, that a rank is computed rather than stored,
 * and that a stage the pipeline guessed is not displayed as one it knows.
 */
import { describe, expect, it } from "vitest";
import {
  MODEL_IDENTITY, identityFor, PANELISTS, WRITER, BOARD_AXIS, COHORTS,
  cohortKeyOf, ranksFor, bandBadgeFor, ordinal, fmt, adjectivesFor, scoreBand,
  type Entry,
} from "../src/lib/rankings";

const entry = (over: Partial<Entry> = {}): Entry => ({
  slug: "acme", name: "Acme", domain: "acme.com", logo_url: null, one_liner: null,
  provisional: 0, category: "ssp", band: "growth", side: "sell",
  band_evidence: null, band_inferred: 1,
  total: 20, innovation: 7, difficulty: 7, investability: 6,
  split_question: null, split_spread: 0, summary: "", stack_json: "{}",
  created_at: "", takes: [], ...over,
});

describe("model identity", () => {
  it("names the model that answered, not the seat it sat in", () => {
    // A seat is a ladder, and OpenCode's spans several labs: when
    // deepseek-v4-pro fails it falls to qwen3.8-max, which is Alibaba. Printing
    // DeepSeek's bio next to Qwen's answer would break the one claim the board
    // rests on — three models, three labs, and you can check.
    const who = identityFor("qwen3.8-max", "deepseek");
    expect(who.name).toBe("Qwen 3.8 Max");
    expect(who.lab).toBe("Alibaba");
  });

  it("covers every model the panel and writer can seat", () => {
    for (const p of PANELISTS) expect(MODEL_IDENTITY[p.model]).toBeTruthy();
    expect(MODEL_IDENTITY["gpt-5.6-luna"]).toBeTruthy();
  });

  it("never invents a parameter count", () => {
    // Same rule as the panel bios: published specs only, "undisclosed"
    // otherwise. One fabricated number would discredit the whole page.
    for (const m of Object.values(MODEL_IDENTITY)) {
      if (!/\b\d+B\b/.test(m.spec)) expect(m.spec).toMatch(/undisclosed/i);
    }
  });

  it("falls back to the seat rather than rendering blank", () => {
    const who = identityFor("some-new-rung", "gemini");
    expect(who.name).toBeTruthy();
    expect(who.substitute).toBe(true);
  });

  it("keeps the writer out of the panel's labs", () => {
    expect(PANELISTS.map((p) => p.lab)).not.toContain(WRITER.lab);
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
    entry({ slug: "a", total: 25, category: "ssp", side: "sell" }),
    entry({ slug: "b", total: 20, category: "ssp", side: "sell" }),
    entry({ slug: "c", total: 15, category: "dsp", side: "buy" }),
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

  it("collapses repeated adjectives into agreement", () => {
    // Two labs reaching for the same word is the strongest signal a row can
    // carry, but rendered literally it reads as a duplication bug.
    const e = entry({
      takes: [
        { panelist_id: "a", model_used: "m", innovation: 0, difficulty: 0, investability: 0, ratings: {} as any, adjective: "credible" },
        { panelist_id: "b", model_used: "m", innovation: 0, difficulty: 0, investability: 0, ratings: {} as any, adjective: "credible" },
        { panelist_id: "c", model_used: "m", innovation: 0, difficulty: 0, investability: 0, ratings: {} as any, adjective: "reskinned" },
      ],
    });
    expect(adjectivesFor(e)).toEqual([
      { word: "credible", count: 2 },
      { word: "reskinned", count: 1 },
    ]);
  });

  it("bands the score out of thirty, not a hundred", () => {
    // The thresholds moved with the scale; a /100 threshold here would put
    // every company on the board in the bottom band.
    expect(scoreBand(25).label).toBe("On fire");
    expect(scoreBand(20).label).toBe("Genuinely interesting");
    expect(scoreBand(5).label).toBe("Brutal");
  });
});
