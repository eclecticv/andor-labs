/**
 * The line runs at Series B. Everything from pre-seed to Series A is in.
 *
 * These tests exist because the calibration moved once already — when Series A
 * came inside the line, half the maturity signals stopped discriminating and
 * had to come off the list. A regression here silently refuses the exact
 * companies the board is for.
 */
import { describe, expect, it } from "vitest";
import { assessStage, countOpenRoles, tooBigMessage } from "../functions/_lib/stage";

const ev = (over: Partial<Parameters<typeof assessStage>[0]> = {}) =>
  assessStage({ text: "", html: "", detected: [], ...over });

describe("hard refusals", () => {
  it("refuses a company that names a Series B or later", () => {
    expect(ev({ text: "We raised our Series B last spring." }).tooBig).toBe(true);
    expect(ev({ text: "Following our Series C..." }).tooBig).toBe(true);
  });

  it("refuses public companies", () => {
    expect(ev({ text: "NASDAQ: ACME" }).tooBig).toBe(true);
    expect(ev({ text: "See our Investor Relations page" }).tooBig).toBe(true);
  });

  it("refuses a raise that is past a Series A on any reading", () => {
    expect(ev({ text: "We raised $60M to accelerate." }).tooBig).toBe(true);
  });
});

describe("what must NOT refuse", () => {
  // The band is pre-seed to Series A inclusive. These are the false-refusal
  // cases that would silently exclude the board's whole target audience.
  it("admits a Series A company", () => {
    expect(ev({ text: "We closed our Series A in March." }).tooBig).toBe(false);
  });

  it("admits a $25M raise — genuinely ambiguous, so the round name governs", () => {
    expect(ev({ text: "We raised $25M." }).tooBig).toBe(false);
  });

  it("admits a seed company with SOC 2 — common now, so it is not a signal", () => {
    expect(ev({ text: "We are SOC 2 Type II compliant." }).tooBig).toBe(false);
  });

  it("admits a company with a handful of open roles", () => {
    const html = Array.from({ length: 6 }, (_, i) => `<a href="https://jobs.lever.co/acme/role-${i}">`).join("");
    expect(ev({ html }).tooBig).toBe(false);
  });
});

describe("soft signals", () => {
  it("needs two before refusing", () => {
    const oneSignal = ev({ text: "offices in london" , sitemapUrlCount: 900 });
    expect(oneSignal.soft.length).toBe(1);
    expect(oneSignal.tooBig).toBe(false);
  });

  it("refuses when two stack up", () => {
    const html = Array.from({ length: 40 }, (_, i) => `<a href="https://boards.greenhouse.io/acme/${i}">`).join("");
    const v = ev({ html, sitemapUrlCount: 900 });
    expect(v.soft.length).toBeGreaterThanOrEqual(2);
    expect(v.tooBig).toBe(true);
  });
});

describe("open roles", () => {
  it("counts distinct board links, not repeated nav links", () => {
    const html = '<a href="https://jobs.lever.co/acme/a">x</a><a href="https://jobs.lever.co/acme/a">x</a>';
    expect(countOpenRoles(html)).toBe(1);
  });
});

describe("no evidence", () => {
  // A stealth pre-seed and an unlisted giant look identical from here, so this
  // proceeds as provisional rather than refusing.
  it("flags an empty site without refusing it", () => {
    const v = ev({ text: "Coming soon." });
    expect(v.noEvidence).toBe(true);
    expect(v.tooBig).toBe(false);
  });
});

describe("the refusal message", () => {
  it("names the evidence so the company can check it", () => {
    const v = ev({ text: "NASDAQ: ACME" });
    expect(tooBigMessage(v, "Acme")).toContain("publicly listed");
    expect(tooBigMessage(v, "Acme")).toContain("pre-seed to Series A");
  });
});
