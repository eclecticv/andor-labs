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
  SCORE_BANDS, bandLegend,
  CATEGORY_LABELS, rankingIsStale, type Take, type Entry,
} from "../src/lib/rankings";
import { CATEGORIES, CATEGORY_NOT, sideFor } from "../functions/_lib/classify";

const entry = (over: Partial<Entry> = {}): Entry => ({
  slug: "acme", name: "Acme", domain: "acme.com", logo_url: null, one_liner: null,
  provisional: 0, category: "ssp", band: "growth", side: "sell",
  band_evidence: null, band_inferred: 1,
  founded_year: 2019, division: "lightweight", headcount: "11-50", facts_json: null,
  total: 20, innovation: 7, difficulty: 7, outlook: 6,
  split_question: null, split_spread: 0, summary: "",
  created_at: "", takes: [], ...over,
});

describe("model identity", () => {
  it("names the model that answered, not the seat it sat in", () => {
    // Rows ranked before the pin exist: the old open ladder let GLM answer in
    // DeepSeek's seat. Attribution follows the model that produced the words.
    const who = identityFor("glm-5.3", "deepseek");
    expect(who.name).toBe("GLM 5.3");
    expect(who.lab).toBe("Zhipu AI");
  });

  it("withholds the character from any model that is not the pinned seat", () => {
    // The character is a byline. Printing "Nemo Vasquez" above words produced
    // by a model from another lab is a fabricated attribution, and it is worse
    // than an unglamorous row — so a stale take gets the model and nothing else.
    const stale = identityFor("glm-5.3", "nemotron");
    expect(stale.character).toBeNull();
    expect(stale.bio).toBe("");
    expect(stale.stale).toBe(true);

    const seat = PANELISTS[0];
    const pinned = identityFor(seat.model, seat.id);
    expect(pinned.character).toBe(seat.character);
    expect(pinned.stale).toBe(false);
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

  it("withholds every character when any seat on the ranking is stale", () => {
    // The bug this exists to stop, seen live on the board: the Gemini seat kept
    // the same model across a panel change, so on a row scored by the OLD jury
    // two takes rendered as bare models and the third rendered as "Gemma
    // Larkspur" — one page, three jurors, two naming systems, and a byline over
    // words written before that character existed.
    const unchanged = PANELISTS.find((p) => p.id === "gemini")!;
    const takes = [
      { panelist_id: "nemotron", model_used: "nvidia/nemotron-3-super-120b-a12b" },
      { panelist_id: "deepseek", model_used: "deepseek-v4-pro" },
      { panelist_id: unchanged.id, model_used: unchanged.model },
    ] as Take[];

    expect(rankingIsStale(takes)).toBe(true);
    // The seat whose model did NOT change still loses its character, because
    // the ranking it belongs to is not one this panel produced.
    expect(identityFor(unchanged.model, unchanged.id, true).character).toBeNull();
    // And on a ranking that IS current, it keeps it.
    const current = PANELISTS.map((p) => ({
      panelist_id: p.id, model_used: p.model,
    })) as Take[];
    expect(rankingIsStale(current)).toBe(false);
    expect(identityFor(unchanged.model, unchanged.id, false).character).toBe(unchanged.character);
  });

  it("falls back to the seat rather than rendering blank", () => {
    const who = identityFor("some-new-rung", "gemini");
    expect(who.name).toBeTruthy();
    expect(who.stale).toBe(true);
  });

  it("keeps the writer out of the panel's labs", () => {
    expect(PANELISTS.map((p) => p.lab)).not.toContain(WRITER.lab);
  });

  it("gives every seat a distinct lab", () => {
    // "Three models, three different labs, and you can check" is the board's
    // whole claim. Two seats from one lab quietly makes it false.
    const labs = PANELISTS.map((p) => p.lab);
    expect(new Set(labs).size).toBe(labs.length);
  });

  it("gives every seat a character and a lens", () => {
    for (const p of PANELISTS) {
      expect(p.character).toBeTruthy();
      expect(p.lens).toBeTruthy();
      expect(p.bio).toBeTruthy();
    }
    const names = PANELISTS.map((p) => p.character);
    expect(new Set(names).size).toBe(names.length);
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
        { panelist_id: "a", model_used: "m", innovation: 0, difficulty: 0, outlook: 0, ratings: {} as any, adjective: "credible" },
        { panelist_id: "b", model_used: "m", innovation: 0, difficulty: 0, outlook: 0, ratings: {} as any, adjective: "credible" },
        { panelist_id: "c", model_used: "m", innovation: 0, difficulty: 0, outlook: 0, ratings: {} as any, adjective: "reskinned" },
      ],
    });
    expect(adjectivesFor(e)).toEqual([
      { word: "credible", count: 2 },
      { word: "reskinned", count: 1 },
    ]);
  });

  it("bands the score out of thirty, not a hundred", () => {
    // Asserted against the scale rather than against four re-typed strings:
    // typing the labels here would make this test a fifth copy of the thing
    // the shared module exists to stop copying. What must not drift is that a
    // total lands in the band its threshold claims — a /100 threshold would put
    // every company on the board in the bottom band.
    for (const b of SCORE_BANDS) {
      expect(scoreBand(b.min).label).toBe(b.label);
      expect(scoreBand(29).min).toBeGreaterThanOrEqual(SCORE_BANDS[0].min);
    }
    expect(scoreBand(0).label).toBe(SCORE_BANDS[SCORE_BANDS.length - 1].label);
  });

  it("gives every band a verdict and a share line", () => {
    // The 12-18 band read "The panel is thinking", which described the jury
    // rather than the company on a page where the jury has finished. A band is
    // a position someone could disagree with, so each one needs its own words
    // and its own share line — the share ladder used to be a separate copy of
    // these thresholds and had already drifted out of step with them.
    const labels = SCORE_BANDS.map((b) => b.label);
    const brags = SCORE_BANDS.map((b) => b.brag);
    expect(new Set(labels).size).toBe(SCORE_BANDS.length);
    expect(new Set(brags).size).toBe(SCORE_BANDS.length);
    for (const b of SCORE_BANDS) expect(b.brag.length).toBeGreaterThan(10);
    // Exactly one band spends the accent.
    expect(SCORE_BANDS.filter((b) => b.solid)).toHaveLength(1);
  });

  it("builds the legend from the scale it explains", () => {
    // The leaderboard's legend was hand-typed beside the bands and had drifted
    // from the labels it was decoding.
    const legend = bandLegend();
    for (const b of SCORE_BANDS) expect(legend).toContain(b.label);
  });
});
