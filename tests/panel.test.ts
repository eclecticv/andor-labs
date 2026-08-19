/**
 * The panel's arithmetic and its refusals.
 *
 * Nothing here calls a model. What is tested is the layer between the models
 * and the board: that a total is computed rather than asked for, that a
 * disagreement survives to the page instead of being averaged away, and that
 * an answer which is well-formed but empty does not count as an answer.
 */
import { describe, expect, it } from "vitest";
import {
  PANELISTS, WRITER, QUESTIONS, aggregate, normalizeTake, assertTakeUsable,
  buildPanelPrompt, buildPanelSystem, resolveRecall, type PanelistTake,
} from "../functions/_lib/panel";
import { CATEGORIES } from "../functions/_lib/classify";

/**
 * Jurors answer in words now, so the fixture does too. The numbers behind them
 * (hard no 0 · no 3 · kinda 5 · yes 8 · extremely 10) are what the arithmetic
 * sees, and asserting on those is asserting that the mapping holds.
 */
const take = (id: string, verdicts: [string, string, string]): PanelistTake =>
  normalizeTake(
    {
      innovation: { verdict: verdicts[0], summary: "x".repeat(80) },
      difficulty: { verdict: verdicts[1], summary: "x".repeat(80) },
      outlook: { verdict: verdicts[2], summary: "x".repeat(80) },
      adjective: "curious",
    },
    id,
    "test-model",
  );

describe("the panel roster", () => {
  it("seats three different labs", () => {
    // The whole design rests on independence. Two seats from one lab would be
    // one opinion counted twice, and the mean would quietly weight it double.
    const labs = new Set(PANELISTS.map((p) => p.lab));
    expect(labs.size).toBe(3);
  });

  it("keeps the writer out of the panel's labs", () => {
    expect(PANELISTS.map((p) => p.lab)).not.toContain(WRITER.lab);
  });

  it("does not invent parameter counts", () => {
    // Bios are published specs only. A page whose premise is transparency
    // cannot carry a made-up number, so anything undisclosed says so.
    for (const p of [...PANELISTS, WRITER]) {
      expect(p.spec.length).toBeGreaterThan(40);
      if (!/\b\d+B\b/.test(p.spec)) expect(p.spec).toMatch(/undisclosed/i);
    }
  });
});

describe("aggregation", () => {
  it("averages each question and sums the means", () => {
    const result = aggregate([
      take("a", ["yes", "kinda", "yes"]),
      take("b", ["yes", "kinda", "kinda"]),
      take("c", ["kinda", "kinda", "kinda"]),
    ]);
    expect(result.means.innovation).toBe(7); // 8, 8, 5
    expect(result.means.difficulty).toBe(5); // kinda across the board
    expect(result.means.outlook).toBe(6);    // 8, 5, 5
    expect(result.total).toBe(18);
  });

  it("keeps one decimal, which is what stops the board tying", () => {
    // Three verdicts averaged land on values like 6 and 7.3. Rounding those to
    // whole numbers would throw away the granularity that keeps ranks distinct.
    const result = aggregate([
      take("a", ["yes", "hard no", "hard no"]),
      take("b", ["kinda", "hard no", "hard no"]),
      take("c", ["kinda", "hard no", "hard no"]),
    ]);
    expect(result.means.innovation).toBe(6); // 8, 5, 5
  });

  it("surfaces a real disagreement", () => {
    const result = aggregate([
      take("a", ["extremely", "kinda", "kinda"]),
      take("b", ["hard no", "kinda", "kinda"]),
      take("c", ["kinda", "kinda", "kinda"]),
    ]);
    expect(result.split).toEqual({ question: "innovation", spread: 10 }); // 10 vs 0
  });

  it("does not call rounding a disagreement", () => {
    // A one or two point spread is three models agreeing. Reporting that as a
    // split would make every page claim a controversy it does not have.
    const result = aggregate([
      take("a", ["kinda", "yes", "yes"]),
      take("b", ["kinda", "yes", "yes"]),
      take("c", ["no", "yes", "yes"]),
    ]);
    expect(result.split).toBeNull();
  });
});

describe("usability", () => {
  it("rejects a take with nothing in it", () => {
    // This is the "..." bug generalised: a model can return well-formed JSON
    // and still have said nothing, and truthiness alone does not catch it.
    expect(() => assertTakeUsable(normalizeTake({}, "a", "m"))).toThrow();
  });

  it("rejects a thin summary even when the score is present", () => {
    const thin = normalizeTake(
      {
        innovation: { verdict: "yes", summary: "Good." },
        difficulty: { verdict: "yes", summary: "x".repeat(80) },
        outlook: { verdict: "yes", summary: "x".repeat(80) },
        adjective: "solid",
      },
      "a",
      "m",
    );
    expect(() => assertTakeUsable(thin)).toThrow(/innovation/);
  });

  it("clamps scores into range instead of trusting the model", () => {
    const wild = normalizeTake({ innovation: { verdict: "wildly extremely so" }, difficulty: { verdict: "??" } }, "a", "m");
    expect(wild.ratings.innovation.score).toBe(10);
    // An unreadable verdict lands on "kinda", not "hard no": a parse failure is
    // our problem and must not be scored as the company's.
    expect(wild.ratings.difficulty.verdict).toBe("kinda");
    expect(wild.ratings.innovation.verdict).toBe("extremely");
  });

  it("takes the first word of an adjective rather than the letters", () => {
    // Stripping non-letters and truncating produced "genuinelyimpress" — two
    // words welded together and then cut, which would have shipped onto the
    // board as a company's one-word verdict.
    expect(normalizeTake({ adjective: "Genuinely Impressive!" }, "a", "m").adjective)
      .toBe("genuinely");
    expect(normalizeTake({ adjective: "  Overbuilt  " }, "a", "m").adjective).toBe("overbuilt");
  });
});

describe("the recall vote", () => {
  // Two facts the board's structure depends on are resolved by majority across
  // three labs. This is the hallucination filter, so its failure mode matters
  // more than its success: it must abstain rather than pass through a guess.
  const withRecall = (id: string, r: Partial<PanelistTake["recall"]>): PanelistTake => ({
    ...take(id, ["kinda", "kinda", "kinda"]),
    recall: { category: "", round: "", year: 0, investor: "", ...r },
  });

  it("takes a category two panelists agree on", () => {
    const r = resolveRecall([
      withRecall("nemotron", { category: "ssp" }),
      withRecall("glm", { category: "ssp" }),
      withRecall("gemini", { category: "dsp" }),
    ]);
    expect(r.category).toBe("ssp");
    expect(r.categoryVotes).toBe(2);
  });

  it("abstains when all three disagree", () => {
    // Three-way disagreement means nobody has a majority, and inventing one by
    // taking the first would be exactly the single-model wobble this replaces.
    const r = resolveRecall([
      withRecall("nemotron", { category: "ssp" }),
      withRecall("glm", { category: "dsp" }),
      withRecall("gemini", { category: "curation" }),
    ]);
    expect(r.category).toBe("");
    expect(r.categoryVotes).toBe(0);
  });

  it("requires the year to match, not just the round", () => {
    // "series-b" alone is a coin flip between a few options and models collide
    // on it by chance. The year is what makes agreement mean recall.
    const r = resolveRecall([
      withRecall("nemotron", { round: "series-b", year: 2021, investor: "a16z" }),
      withRecall("glm", { round: "series-b", year: 2019, investor: "Index" }),
      withRecall("gemini", { round: "", year: 0 }),
    ]);
    expect(r.round).toBe("");
  });

  it("accepts a round two panelists place in the same year", () => {
    const r = resolveRecall([
      withRecall("nemotron", { round: "series-b", year: 2021, investor: "a16z" }),
      withRecall("glm", { round: "series-b", year: 2021, investor: "Accel" }),
      withRecall("gemini", { round: "", year: 0 }),
    ]);
    expect(r.round).toBe("series-b");
    expect(r.roundYear).toBe(2021);
    expect(r.roundVotes).toBe(2);
    // The page prints who recalled it, so a reader can weigh the claim.
    expect(r.evidence).toMatch(/NVIDIA and Zhipu AI/);
    expect(r.evidence).toMatch(/2021/);
  });

  it("ignores a panelist that named a round but no year", () => {
    // The prompt tells them to give all three or none. Counting a partial
    // answer would reintroduce the guesswork that instruction exists to stop.
    const r = resolveRecall([
      withRecall("nemotron", { round: "seed", year: 0 }),
      withRecall("glm", { round: "seed", year: 0 }),
      withRecall("gemini", { round: "seed", year: 0 }),
    ]);
    expect(r.round).toBe("");
  });

  it("throws out a year that cannot be real", () => {
    const t = normalizeTake({ funding: { round: "seed", year: 1994 } }, "a", "m");
    expect(t.recall.year).toBe(0);
  });
});

describe("the prompt", () => {
  const prompt = buildPanelPrompt({ domain: "example.com", pages: "Hello.", thin: false, categories: CATEGORIES });

  it("tells the engineer to score difficulty, not ease", () => {
    // The vibe-code question runs backwards from the other two: if 10 meant
    // "easily cloned" a company could top the board by being trivial. The
    // inversion has to be stated in the prompt or the total is incoherent.
    expect(prompt).toMatch(/Is this hard to replicate\?/);
  });

  it("gives every question an anchored scale", () => {
    // Anchors are the determinism lever — they turn scoring into
    // classification against fixed points instead of inventing a scale.
    for (const q of QUESTIONS) expect(prompt).toContain(q.anchors.split("\n")[0]);
  });

  it("says the panelists cannot see each other", () => {
    // Moved to the system message with the rest of who-you-are. The rubric is
    // now byte-identical across seats, so anything about the juror belongs on
    // the other side of the split.
    for (const p of PANELISTS) {
      expect(buildPanelSystem(p)).toMatch(/cannot see their answers/i);
    }
  });

  it("keeps the rubric free of persona", () => {
    // The regression this whole change exists to prevent. Personas used to sit
    // on the QUESTIONS, so every juror wore all three hats and the panel was
    // one committee sampled three times. If a character name or a lens ever
    // reappears in the shared prompt, that is back.
    for (const p of PANELISTS) {
      expect(prompt).not.toContain(p.character);
      expect(prompt).not.toContain(p.lens);
      expect(prompt).not.toContain(p.disqualifier);
    }
    expect(prompt).not.toMatch(/wear the stated hat/i);
  });

  it("gives each seat a lens that does not move between questions", () => {
    for (const p of PANELISTS) {
      const system = buildPanelSystem(p);
      expect(system).toContain(p.character);
      expect(system).toContain(p.lens);
      expect(system).toContain(p.disqualifier);
      for (const f of p.forbidden) expect(system).toContain(f);
      // The instruction that actually holds character across dimensions.
      expect(system).toMatch(/EVERY question/);
    }
  });

  it("turns Nemotron's reasoning on, literally", () => {
    // NVIDIA's Nemotron line ships reasoning OFF and enables it only on this
    // exact string in the system prompt. Without it you pay reasoning latency
    // for a non-reasoning answer.
    const nemo = PANELISTS.find((p) => p.provider === "nvidia")!;
    expect(buildPanelSystem(nemo).startsWith("detailed thinking on")).toBe(true);
  });

  it("makes the juror write the case against before scoring", () => {
    expect(prompt).toMatch(/case_against/);
    expect(prompt.indexOf("case_against")).toBeLessThan(prompt.indexOf("── INNOVATION ──"));
  });

  it("caps an uncited score at the midpoint", () => {
    expect(prompt).toMatch(/cannot go above "kinda"/i);
    expect(prompt).toMatch(/two DIFFERENT\s+concrete things/);
    expect(prompt).toMatch(/Start each question at 4/);
  });

  it("warns when the site barely rendered", () => {
    const thin = buildPanelPrompt({ domain: "x.com", pages: "", thin: true, categories: CATEGORIES });
    expect(thin).toMatch(/BARELY RENDERED/);
  });
});
