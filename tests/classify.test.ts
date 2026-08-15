/**
 * Classification decides which table a company appears in, so a wrong answer
 * here does not just mis-rank one company — it shifts every rank around it in
 * two different cohorts. These tests guard the parts where that has already
 * gone wrong once.
 */
import { describe, expect, it } from "vitest";

import {
  CATEGORIES, sideFor, place, placeFromMarkup, cohortLabel, normalizeIdentity, assertIdentityUsable,
} from "../functions/_lib/classify";

describe("side", () => {
  it("covers every subcategory", () => {
    // Side is a lookup, not an inference, which only works if the table is
    // total. A missing key would silently fall through to "independent" and
    // quietly put an SSP in the wrong section of the board.
    for (const c of CATEGORIES) {
      expect(["buy", "sell", "independent"]).toContain(sideFor(c.key));
    }
  });

  it("puts inventory owners on the sell side regardless of how they are labelled", () => {
    expect(sideFor("ssp")).toBe("sell");
    // Retail media and CTV read as "channels" but commercially they are supply.
    expect(sideFor("retail-media")).toBe("sell");
    expect(sideFor("ctv-audio")).toBe("sell");
  });

  it("puts budget spenders on the buy side and referees in the middle", () => {
    expect(sideFor("dsp")).toBe("buy");
    expect(sideFor("curation")).toBe("buy");
    expect(sideFor("measurement")).toBe("independent");
    expect(sideFor("fraud-quality")).toBe("independent");
  });
});

describe("public companies", () => {
  it("refuses a ticker, an IR section, or an IPO", () => {
    expect(placeFromMarkup("", "NASDAQ: TTD").isPublic).toBeTruthy();
    expect(placeFromMarkup('<a href="/ir">Investor Relations</a>', "").isPublic).toBeTruthy();
    expect(placeFromMarkup("", "since we went public in 2021").isPublic).toBeTruthy();
  });

  it("refuses with a reason a human would accept", () => {
    const p = place("", "NYSE: MGNI", null);
    expect(p.eligible).toBe(false);
    expect(p.reason).toMatch(/public/i);
  });

  it("does not mistake ordinary ad copy for a listing", () => {
    // "public" is a common word in this industry — public inventory, public
    // marketplaces, publishers. The patterns have to be narrower than the word.
    const text = "We help publishers monetise public marketplace inventory.";
    expect(placeFromMarkup("", text).isPublic).toBeNull();
  });

  // Carried over from the deleted stage.test.ts. These were the false-refusal
  // cases for the old "too big" gate, and they still matter: exclusion is now
  // permanent rather than a division change, so a false positive does not
  // mis-sort a company, it deletes it from the board entirely.
  it("does not refuse a well-funded private company", () => {
    expect(placeFromMarkup("", "We raised $25M in our Series C.").isPublic).toBeNull();
    expect(placeFromMarkup("", "We are SOC 2 Type II compliant.").isPublic).toBeNull();
  });

  it("does not read a lowercase exchange name in prose as a ticker", () => {
    // The ticker pattern is case-sensitive precisely so this does not fire.
    expect(placeFromMarkup("", "our nasdaq: the whole open web").isPublic).toBeNull();
  });

  it("does not refuse a company that merely mentions its investors", () => {
    expect(placeFromMarkup("", "Backed by leading investors.").isPublic).toBeNull();
  });
});

describe("bands", () => {
  it("reads an announced round off the page", () => {
    expect(placeFromMarkup("", "we raised our Series B last month").band).toBe("growth");
    expect(placeFromMarkup("", "announcing our Series C").band).toBe("mature");
    expect(placeFromMarkup("", "fresh out of Y Combinator").band).toBe("emerging");
  });

  it("takes the most advanced round when a history page lists several", () => {
    // A company that mentions its seed round AND its Series C is a Series C
    // company with an about page, not a seed company.
    const history = "2019 seed round. 2021 Series A. 2024 Series C.";
    expect(placeFromMarkup("", history).band).toBe("mature");
  });

  it("prefers structural evidence over what the model thought", () => {
    // The model's read is advisory. Marketing copy is written to sound
    // established, so an explicit round in the markup always wins.
    const p = place("", "we closed our seed round in March", "series-c");
    expect(p.band).toBe("emerging");
    expect(p.bandInferred).toBe(false);
  });

  it("falls back to the middle band, never the smallest", () => {
    // The old division detector defaulted unknowns to the SMALLEST band, which
    // dropped big companies into the bracket meant to protect small ones. The
    // middle is where being wrong costs least in either direction.
    const p = place("", "We make advertising better.", "unknown");
    expect(p.band).toBe("growth");
    expect(p.bandInferred).toBe(true);
    expect(p.bandEvidence).toMatch(/no funding signals/i);
  });

  it("admits when a band was guessed", () => {
    // A guessed band that looks identical to an evidenced one on the page is
    // worse than an admitted gap, so the flag has to survive to the caller.
    expect(place("", "Series A closed", null).bandInferred).toBe(false);
    expect(place("", "nothing here", "seed").bandInferred).toBe(true);
  });
});

describe("cohort labels", () => {
  it("reads the way the rank is spoken", () => {
    expect(cohortLabel("emerging", "sell")).toBe("emerging sell-side");
    // The KEY is still `independent` — it is in every published URL — but the
    // label it reads as is "Infrastructure", because on a board of private
    // startups "independent" parses as a maturity band rather than a side.
    expect(cohortLabel("mature", "independent")).toBe("mature infrastructure");
  });
});

describe("identity", () => {
  it("keeps only known categories", () => {
    expect(normalizeIdentity({ category: "ssp" }).category).toBe("ssp");
    // A free-text category is the same as no category: cohorts depend on the
    // set being closed, so anything unrecognised becomes "other" rather than
    // creating a cohort of one.
    expect(normalizeIdentity({ category: "AI curation platform" }).category).toBe("other");
  });

  it("refuses a refusal with no reason", () => {
    expect(() => assertIdentityUsable(normalizeIdentity({ eligible: false }))).toThrow();
    expect(
      assertIdentityUsable(normalizeIdentity({ eligible: false, ineligibleReason: "Not adtech." })),
    ).toBeTruthy();
  });

  it("refuses an eligible company with no name", () => {
    expect(() => assertIdentityUsable(normalizeIdentity({ eligible: true }))).toThrow();
  });
});
