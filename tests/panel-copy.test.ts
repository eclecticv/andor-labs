/**
 * The panel is described in more than one place, so it can disagree with itself.
 *
 * It did. A seat changed from DeepSeek to Qwen and the landing page went on
 * announcing "DeepSeek is reading…" in its loading state, the how-it-works
 * strip went on crediting "NVIDIA, DeepSeek and Google", and llms.txt went on
 * telling answer engines the same thing — while the company pages named the
 * new seat. Three surfaces, two rosters, one deploy.
 *
 * None of that is caught by types: they are string literals, and a string
 * literal is never wrong at compile time. So the check is a source scan.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PANELISTS, WRITER, QUESTIONS, panelLabs, panelLoadingMessages } from "../src/lib/rankings";
import { buildIdentifyPrompt, CATEGORIES, CATEGORY_NOT } from "../functions/_lib/classify";
import { buildPanelPrompt } from "../functions/_lib/panel";
import { buildWriterPrompt } from "../functions/_lib/writer";

/**
 * Labs that have ever held a seat, plus the ones on the provider ladders.
 *
 * A name from this list appearing in page copy is only correct while that lab
 * is actually seated — which is the whole failure mode.
 */
const EVER_SEATED = [
  "NVIDIA", "DeepSeek", "Google DeepMind", "Alibaba", "OpenAI", "xAI",
  "Zhipu AI", "Moonshot", "MiniMax",
];

/** Comments explain history and legitimately name retired labs. Strip them. */
const stripComments = (src: string): string =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/^\s*\*.*$/gm, " ");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(astro|ts)$/.test(name) ? [full] : [];
  });
}

describe("panel copy does not drift from the panel", () => {
  const seated = new Set([...PANELISTS.map((p) => p.lab), WRITER.lab]);

  const files = [...walk("src/pages"), ...walk("src/components")];

  it("never names a lab that is not currently seated", () => {
    const offences: string[] = [];
    for (const file of files) {
      const src = stripComments(readFileSync(file, "utf8"));
      for (const lab of EVER_SEATED) {
        if (!seated.has(lab) && src.includes(lab)) {
          // NVIDIA Inception is a programme badge on the marketing pages, not
          // a claim about the panel. Only flag it where the panel is described.
          if (lab === "NVIDIA" && !/panel|juror|judge|rank-my-adtech/i.test(src)) continue;
          offences.push(`${file} names "${lab}"`);
        }
      }
    }
    expect(offences, offences.join("\n")).toEqual([]);
  });

  /**
   * A retired question is a lab that changed seat, in slower motion.
   *
   * `investability` became `outlook` and every identifier renamed cleanly,
   * because identifiers are what a rename tool can see. The prose did not:
   * the system prompt still told each juror how to answer "whether you would
   * invest", the panel strip and llms.txt still explained that the engineer
   * answers "the investment question" as an engineer, and the OG share card
   * still drew a bar labelled WOULD YOU INVEST — a string literal, invisible
   * to both the compiler and the rename.
   *
   * Every one of those surfaces described a question the panel is no longer
   * asked, which is the same failure this file was written for.
   */
  const RETIRED_QUESTION_COPY = [
    /would you invest/i,
    /whether they would invest/i,
    /investment question/i,
    /put money in/i,
  ];

  it("never describes a question the panel no longer asks", () => {
    const offences: string[] = [];
    // The OG card is a Function, so it is outside the src/ walk that catches
    // everything else — and it is exactly where the label survived.
    const surfaces = [...files, "functions/og/rank/[slug].ts", "functions/_lib/panel.ts",
                      "src/lib/rankings.ts", "src/pages/llms.txt.ts"];
    for (const file of surfaces) {
      const src = stripComments(readFileSync(file, "utf8"));
      for (const pattern of RETIRED_QUESTION_COPY) {
        const hit = pattern.exec(src);
        if (hit) offences.push(`${file} still says "${hit[0]}"`);
      }
    }
    expect(offences, offences.join("\n")).toEqual([]);
  });

  it("renders every question's label somewhere a reader can see it", () => {
    // The counterpart check: a question that exists in the rubric but appears
    // on no surface is a scored axis the board never explains.
    const rendered = files.map((f) => readFileSync(f, "utf8")).join("\n")
      + readFileSync("functions/og/rank/[slug].ts", "utf8");
    for (const q of QUESTIONS) {
      expect(rendered.toLowerCase(), `no surface renders "${q.label}"`)
        .toContain(q.label.toLowerCase());
    }
  });

  it("names the writer by character wherever it credits the writer", () => {
    /**
     * Every juror is rendered character-first with the model underneath, and
     * the writer is a seat like any other. The company page credited only
     * "GPT-5.6 Luna", so the same clerk was Vega on the landing page and a bare
     * model id on the profile — the two-names-for-one-seat bug this file exists
     * for, on the one seat nobody thought to check.
     */
    const offences: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      if (!src.includes("WRITER.name")) continue;
      if (!src.includes("WRITER.character")) {
        offences.push(`${file} credits WRITER.name without WRITER.character`);
      }
    }
    expect(offences, offences.join("\n")).toEqual([]);
  });

  it("derives the lab sentence from the panel", () => {
    const prose = panelLabs();
    for (const p of PANELISTS) expect(prose).toContain(p.lab);
    // Reads as a list, not an array dump.
    expect(prose).toMatch(/ and /);
    expect(prose).not.toMatch(/[[\]]/);
  });

  it("derives the loading lines from the panel", () => {
    const steps = panelLoadingMessages();
    expect(steps).toHaveLength(PANELISTS.length);
    for (const p of PANELISTS) {
      expect(steps.some((s) => s.includes(p.character))).toBe(true);
    }
  });

  it("puts the category guards in BOTH prompts that assign a category", () => {
    // Category is resolved from the identifier's answer and the panel's recall
    // together. A guard written into only one of them works only half the time
    // — which is exactly what happened: the note was added to the panel prompt,
    // and pubX (a publisher yield product) kept being identified as
    // `agentic-buying`, a buy-side category, because the identifier never saw
    // it.
    const identify = buildIdentifyPrompt("example.com", "hello", false);
    const panel = buildPanelPrompt({
      domain: "example.com", pages: "hello", thin: false,
      categories: CATEGORIES, categoryNotes: CATEGORY_NOT,
    });
    for (const prompt of [identify, panel]) {
      for (const [key, note] of Object.entries(CATEGORY_NOT)) {
        expect(prompt, `missing guard for "${key}"`).toContain(note!);
      }
    }
  });

  it("has the writer name the characters, not the models", () => {
    // The verdict paragraph sits directly above the panel cards. When the
    // writer was handed model names it produced "Nemotron 3 Ultra sees an
    // insightful AI-native layer" under a card headed "Nemo Vasquez" — two
    // names for one juror on one page, with nothing telling a reader they are
    // the same. The model still appears on the card, so naming the person in
    // the prose costs no checkability.
    const takes = PANELISTS.map((p) => ({
      panelistId: p.id,
      modelUsed: p.model,
      adjective: "brisk",
      caseAgainst: [],
      ratings: Object.fromEntries(
        ["innovation", "difficulty", "outlook"].map((k) => [
          k, { score: 6, summary: "x".repeat(80), adjective: "brisk" },
        ]),
      ),
      recall: { category: "dsp", round: "", year: 0, investor: "" },
    })) as any[];

    const prompt = buildWriterPrompt({
      name: "Acme",
      oneLiner: "An ad thing.",
      categoryLabel: "DSP & Media Buying",
      cohort: "buy-side",
      panel: {
        takes,
        total: 18,
        means: { innovation: 6, difficulty: 6, outlook: 6 },
        split: null,
      },
    } as any);

    for (const p of PANELISTS) {
      expect(prompt, `writer never names ${p.character}`).toContain(p.character);
      expect(prompt, `writer still names the model ${p.name}`).not.toContain(p.name);
    }
  });

  it("gives every character somewhere to be rendered", () => {
    // Both surfaces render the same shape. If one of them stops naming the
    // character, the panel is back to being two different things.
    const strip = readFileSync("src/components/ds/PanelStrip.astro", "utf8");
    const profile = readFileSync("src/pages/tools/rank-my-adtech/[slug].astro", "utf8");
    for (const src of [strip, profile]) {
      expect(src).toMatch(/\.character|who\.character/);
      expect(src).toMatch(/\.bio|who\.bio/);
    }
  });
});
