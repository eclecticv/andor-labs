/**
 * The grader is described in more than one place, so it can disagree with itself.
 *
 * It did, under the panel. A seat changed from DeepSeek to Qwen and the landing
 * page went on announcing "DeepSeek is reading…" in its loading state, the
 * how-it-works strip went on crediting "NVIDIA, DeepSeek and Google", and
 * llms.txt went on telling answer engines the same thing — while the company
 * pages named the new seat. Three surfaces, two rosters, one deploy.
 *
 * The panel is gone, and with it most of that surface area. What replaces it is
 * a sharper version of the same risk: ONE model is named on the page with its
 * published specs, so a pin change with no copy change makes every one of those
 * claims false at once — and there is no longer a spread of other names to make
 * the mismatch obvious to a reader.
 *
 * None of this is caught by types: they are string literals, and a string
 * literal is never wrong at compile time. So the check is a source scan.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { GRADER as PAGE_GRADER, graderLoadingMessages } from "../src/lib/rankings";
import { buildIdentifyPrompt, CATEGORIES, CATEGORY_NOT } from "../functions/_lib/classify";
import { GRADER, buildGraderPrompt } from "../functions/_lib/grader";

/**
 * Labs that have ever held a seat, plus the ones on the provider ladders.
 *
 * A name from this list appearing in page copy is only correct while that lab
 * is actually grading — which is the whole failure mode.
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

describe("page copy does not drift from the grader", () => {
  const files = [...walk("src/pages"), ...walk("src/components")];

  it("never names a lab that is not grading", () => {
    const offences: string[] = [];
    for (const file of files) {
      const src = stripComments(readFileSync(file, "utf8"));
      for (const lab of EVER_SEATED) {
        if (lab === GRADER.lab) continue;
        if (!src.includes(lab)) continue;
        offences.push(`${file} names "${lab}"`);
      }
    }
    expect(offences, offences.join("\n")).toEqual([]);
  });

  it("does not describe a panel that no longer sits", () => {
    // The words that would survive a half-done migration and quietly tell a
    // reader the board works a way it no longer works.
    const stale = /\b(three labs|four labs|the panel|panelists?|jurors?)\b/i;
    const offences = files
      .filter((f) => stale.test(stripComments(readFileSync(f, "utf8"))))
      .map((f) => `${f} still describes a panel`);
    expect(offences, offences.join("\n")).toEqual([]);
  });

  it("keeps the two declarations of the grader identical", () => {
    // functions/ and src/ bundle separately, so this pair is duplicated rather
    // than imported across the boundary. Duplication is the point; drift is not.
    expect(PAGE_GRADER.model).toBe(GRADER.model);
    expect(PAGE_GRADER.name).toBe(GRADER.name);
    expect(PAGE_GRADER.lab).toBe(GRADER.lab);
    expect(PAGE_GRADER.spec).toBe(GRADER.spec);
  });

  it("derives the loading lines from the grader", () => {
    const steps = graderLoadingMessages();
    expect(steps.length).toBeGreaterThan(2);
    expect(steps.some((s) => s.includes(GRADER.name))).toBe(true);
  });

  it("puts the category guards in BOTH prompts that assign a category", () => {
    // Category is resolved from the identifier's answer and the grader's recall
    // together. A guard written into only one of them works only half the time
    // — which is exactly what happened: the note was added to the judging prompt,
    // and pubX (a publisher yield product) kept being identified as
    // `agentic-buying`, a buy-side category, because the identifier never saw
    // it.
    const identify = buildIdentifyPrompt("example.com", "hello", false);
    const grader = buildGraderPrompt({
      domain: "example.com", pages: "hello", thin: false,
      categories: CATEGORIES, categoryNotes: CATEGORY_NOT,
    });
    for (const prompt of [identify, grader]) {
      for (const [key, note] of Object.entries(CATEGORY_NOT)) {
        expect(prompt, `missing guard for "${key}"`).toContain(note!);
      }
    }
  });


});
