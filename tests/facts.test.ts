/**
 * The facts lookup answers a question about a company and has no idea which
 * company it answered about. That is how confiant.com came back as "Confiant
 * Solutions", an Indian IT-training consultancy — every field internally
 * consistent and all of them about someone else, published under the real
 * Confiant's name and next to the real Confiant's verdict.
 *
 * The regression matrix below is built from the six rows that were actually on
 * the board when that happened, because the hard part of this gate is not
 * catching Confiant — it is catching Confiant WITHOUT rejecting the five that
 * were right.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  companyQuery, pressQuery, factsProblem, normalizeFacts, factsBlock,
  divisionFor, ageOf, host, sameSite, type CompanyFacts,
} from "../functions/_lib/facts";

/** A payload that passes, so each test varies one thing away from it. */
const ok = (over: Partial<CompanyFacts> = {}): CompanyFacts => ({
  foundedYear: 2013, headcountRange: "11-50", hqCity: "New York",
  hqCountry: "United States", whatTheyDo: "Blocks malicious ads.", serves: ["publishers"],
  officialWebsite: "confiant.com", totalFundingUsd: 4_100_000, lastFunding: "Series A 2018",
  acquiredBy: "", confidence: { founded_year: "high" },
  sources: { founded_year: ["https://www.linkedin.com/company/weareconfiant"] },
  costUsd: 0.007, ...over,
});

describe("companyQuery", () => {
  it("leads with the domain, not the name", () => {
    // The name is the part that collides; the domain is the part that does not.
    // Putting the proper noun first is what let a differently-named company win
    // the retrieval.
    const q = companyQuery("confiant.com", "Confiant");
    expect(q.indexOf("confiant.com")).toBe(0);
    expect(q.indexOf("confiant.com")).toBeLessThan(q.indexOf("Confiant)"));
  });
});

describe("pressQuery", () => {
  it("carries the domain, which the name-only version did not", () => {
    expect(pressQuery("Confiant", "confiant.com", "how it works")).toContain("confiant.com");
  });
});

describe("factsProblem — the grounding gate", () => {
  it("rejects the payload that shipped: zero citations", () => {
    // The real confiant.com row. Every other row on the board carried 7-10.
    const problem = factsProblem(
      ok({ sources: {}, confidence: {}, officialWebsite: "" }), "confiant.com",
    );
    expect(problem).toMatch(/citation/i);
  });

  it("accepts a company grounded entirely on LinkedIn", () => {
    // adpushup.com and ezoic.com are both cited ONLY on linkedin.com. A gate
    // that demanded a citation on the crawled domain would reject two correct
    // rows out of five, which is why this gate never looks at citation hosts.
    expect(factsProblem(
      ok({ officialWebsite: "adpushup.com",
           sources: { founded_year: ["https://www.linkedin.com/company/adpushup"] } }),
      "adpushup.com",
    )).toBeNull();
  });

  it("accepts a company grounded on its own domain", () => {
    expect(factsProblem(
      ok({ officialWebsite: "blockthrough.com",
           sources: { founded_year: ["https://blockthrough.com/about"] } }),
      "blockthrough.com",
    )).toBeNull();
  });

  it("accepts a sparse answer that is still grounded", () => {
    // useadmesh.com: no founding year at all, but seven cited fields. Sparse and
    // ungrounded are different failures and only the second one is a wrong
    // company, so only the second one rejects.
    expect(factsProblem(
      ok({ foundedYear: 0, officialWebsite: "useadmesh.com",
           sources: { headcount_range: ["https://useadmesh.com"] } }),
      "useadmesh.com",
    )).toBeNull();
  });

  it("rejects a grounded answer about a different company", () => {
    const problem = factsProblem(ok({ officialWebsite: "confiantsolutions.in" }), "confiant.com");
    expect(problem).toMatch(/wrong company/);
  });

  it("does not reject when the website field is simply empty", () => {
    // An unfilled field is a gap, not a contradiction. Letting absence veto the
    // whole lookup would turn one unmeasured field into the gate.
    expect(factsProblem(ok({ officialWebsite: "" }), "confiant.com")).toBeNull();
  });

  it("tolerates scheme, www and subdomains", () => {
    expect(factsProblem(ok({ officialWebsite: "https://www.confiant.com/" }), "confiant.com")).toBeNull();
    expect(factsProblem(ok({ officialWebsite: "go.acme.com" }), "acme.com")).toBeNull();
    expect(sameSite("acme.com", "go.acme.com")).toBe(true);
    expect(host("HTTPS://WWW.Acme.com:443/x?y")).toBe("acme.com");
  });
});

describe("normalizeFacts", () => {
  it("maps content and keys grounding by field", () => {
    const facts = normalizeFacts({
      output: {
        content: {
          founded_year: 2013, headcount_range: "11-50", hq_city: "New York",
          hq_country: "United States", what_they_do: "Blocks bad ads.",
          serves: ["publishers", "SSPs"], official_website: "confiant.com",
          total_funding_usd: 4_100_000, last_funding: "Series A 2018", acquired_by: "",
        },
        grounding: [{
          field: "founded_year", confidence: "high",
          citations: [{ url: "https://a.example" }, { url: "https://b.example" },
                      { url: "https://c.example" }, { url: "https://d.example" }],
        }],
      },
      costDollars: { total: 0.007 },
    })!;
    expect(facts.foundedYear).toBe(2013);
    expect(facts.officialWebsite).toBe("confiant.com");
    expect(facts.confidence.founded_year).toBe("high");
    expect(facts.sources.founded_year).toHaveLength(3); // capped
    expect(facts.costUsd).toBe(0.007);
  });

  it("returns null when there is no content to map", () => {
    expect(normalizeFacts({})).toBeNull();
  });
});

describe("factsBlock", () => {
  it("names a missing founding year instead of dropping the line", () => {
    // The innovation question tells jurors to "judge against the category in
    // their founding year". Silently omitting the line left that question
    // asking for an anchor the prompt never supplied, and the juror filled the
    // gap from its priors rather than declining.
    const block = factsBlock(ok({ foundedYear: 0 }));
    expect(block).toMatch(/founded\s+NOT ESTABLISHED/);
  });

  it("prints the year when there is one", () => {
    expect(factsBlock(ok())).toMatch(/founded\s+2013/);
    expect(factsBlock(ok())).not.toMatch(/NOT ESTABLISHED/);
  });
});

describe("divisionFor", () => {
  it("bands on the low end of the range, at the documented boundaries", () => {
    // This is where the wrong company's headcount landed: "1-10" filed the real
    // Confiant against nine-person startups.
    expect(divisionFor("1-10")).toBe("lightweight");
    expect(divisionFor("11-50")).toBe("lightweight");
    expect(divisionFor("51-200")).toBe("middleweight");
    expect(divisionFor("201-500")).toBe("middleweight");
    expect(divisionFor("501-1000")).toBe("heavyweight");
    expect(divisionFor("5000+")).toBe("heavyweight");
  });

  it("classifies nothing rather than defaulting when the range is unknown", () => {
    expect(divisionFor("")).toBeNull();
    expect(divisionFor("unknown")).toBeNull();
  });
});

describe("ageOf", () => {
  it("refuses years that cannot be founding years", () => {
    expect(ageOf(2013, 2026)).toBe(13);
    expect(ageOf(0)).toBe(0);
    expect(ageOf(1700)).toBe(0);
    expect(ageOf(2030, 2026)).toBe(0); // a future year is a parse error, not a company
  });
});

/**
 * Provider constraints that would otherwise break in silence. Same spirit as the
 * designed-failure test in rank-my-adtech.test.ts: these encode a fact about
 * someone else's API that no type can hold.
 */
describe("Exa request constraints", () => {
  const src = readFileSync(new URL("../functions/_lib/facts.ts", import.meta.url), "utf8");

  it("keeps outputSchema inside Exa's ten-property cap", () => {
    const props = src.slice(src.indexOf("const OUTPUT_SCHEMA"), src.indexOf("const SYSTEM_PROMPT"));
    const count = (props.match(/^    [a-z_]+: \{/gm) ?? []).length;
    expect(count).toBeLessThanOrEqual(10);
  });

  it("never sets a category on the call that uses excludeDomains", () => {
    // Exa refuses excludeDomains under category "company" or "people". Adding a
    // category to the press call would stop the exclusion applying, silently.
    const call = src.slice(src.indexOf("pressQuery(name, domain, ask)"),
                           src.indexOf("excludeDomains: [domain]"));
    expect(call).not.toMatch(/^\s*category:/m);
  });
});
