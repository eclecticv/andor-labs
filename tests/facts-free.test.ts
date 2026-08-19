/**
 * The free tiers.
 *
 * These exist because the metered source is 25 searches a MONTH against a board
 * with more companies than that. Anything answerable without a credit has to be
 * answered here, and anything answered here has to be RIGHT — a sourced,
 * confident wrong fact on a real company's public page is the failure mode this
 * whole layer is built to avoid.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { factsFromMarkup } from "../functions/_lib/facts-free";
import { gatherFacts } from "../functions/_lib/facts";

afterEach(() => vi.unstubAllGlobals());

const ld = (obj: unknown) =>
  `<html><head><script type="application/ld+json">${JSON.stringify(obj)}</script></head></html>`;

describe("schema.org markup — zero calls, zero credits", () => {
  it("reads founding year, headcount and city off an Organization block", () => {
    const f = factsFromMarkup(ld({
      "@type": "Organization", name: "Nexx360", foundingDate: "2019-04-01",
      numberOfEmployees: { "@type": "QuantitativeValue", value: "25" },
      address: { "@type": "PostalAddress", addressLocality: "Paris", addressCountry: "FR" },
    }));
    expect(f?.foundedYear).toBe(2019);
    expect(f?.employeeCountRange).toBe("25");
    expect(f?.hqCity).toBe("Paris");
    expect(f?.hqCountry).toBe("FR");
  });

  it("finds the org inside an @graph, which is how most CMSs emit it", () => {
    const f = factsFromMarkup(ld({
      "@context": "https://schema.org",
      "@graph": [{ "@type": "WebSite" }, { "@type": "Corporation", foundingDate: "2011" }],
    }));
    expect(f?.foundedYear).toBe(2011);
  });

  it("returns null for an Organization block with none of the fields", () => {
    // nexx360.io really does this: an Organization node with a name and nothing
    // else. Returning a hollow object would make the caller think it had facts.
    expect(factsFromMarkup(ld({ "@type": "Organization", name: "Nexx360" }))).toBeNull();
  });

  it("survives a malformed block and keeps reading the others", () => {
    const html = `<script type="application/ld+json">{ not json </script>` +
      ld({ "@type": "Organization", foundingDate: "2015" }).replace(/^<html><head>|<\/head><\/html>$/g, "");
    expect(factsFromMarkup(html)?.foundedYear).toBe(2015);
  });

  it("returns null when there is no structured data at all", () => {
    // mediatrust.com: zero ld+json blocks. Common, and not an error.
    expect(factsFromMarkup("<html><body><h1>A company</h1></body></html>")).toBeNull();
  });

  it("rejects a founding year that cannot be one", () => {
    // A parse landing on a copyright range or a phone number is not a fact.
    expect(factsFromMarkup(ld({ "@type": "Organization", foundingDate: "3025" }))).toBeNull();
    expect(factsFromMarkup(ld({ "@type": "Organization", foundingDate: "1650" }))).toBeNull();
  });
});

describe("the chain spends nothing it does not have to", () => {
  it("stops at the free tier and never calls the metered API", async () => {
    // The gate that makes the 25-a-month budget real. The first version of
    // gatherFacts() called the paid API unconditionally — free-first in the
    // comments, pay-every-time in the code. criteo.com is fully answered by its
    // own markup and must cost nothing.
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "Organization", foundingDate: "2005",
      address: { addressLocality: "Paris" },
    })}</script>`;
    const facts = await gatherFacts({ INDEXED_API_KEY: "idx_x" }, "criteo.com", "Criteo", html);
    expect(facts?.foundedYear).toBe(2005);
    expect(facts?.source).toMatch(/schema\.org/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
