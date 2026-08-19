/**
 * Third-party facts.
 *
 * Two things are being defended here. The first is that a lookup NEVER costs a
 * ranking: no key, no match, a bad response and a timeout all have to end in
 * null rather than an exception, because this call sits on the critical path in
 * front of four model calls.
 *
 * The second matters more. An enrichment API that matches loosely is a
 * fabrication engine with a citation attached — it would put another company's
 * funding history on this company's page, sourced and confident and wrong. So
 * the match is on the domain the company actually controls, and nothing else.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { lookupCompany, fundingBand, bandFromFunding, factsBlock } from "../functions/_lib/facts";

const row = (over: Record<string, unknown> = {}) => ({
  name: "Nexx360",
  website: "https://nexx360.io",
  short_description: "Server-side header bidding.",
  industries: ["AdTech"],
  hq_city: "Paris",
  hq_country: "France",
  employee_count_range: "11-50",
  total_funding_raised: 4_000_000,
  ...over,
});

/**
 * Every paid lookup is now preceded by a free /usage check, so the stub has to
 * answer both. Credits default high; pass `credits` to exercise the budget
 * guard.
 */
const respond = (body: unknown, ok = true, status = 200, credits = 25) =>
  vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes("/usage")) {
      return { ok: true, status: 200, json: async () => ({ data: { credits_remaining: credits } }) } as unknown as Response;
    }
    return { ok, status, json: async () => body } as unknown as Response;
  });

afterEach(() => vi.unstubAllGlobals());

describe("failing soft", () => {
  it("returns null with no API key, without calling anything", async () => {
    const fetchSpy = respond({});
    vi.stubGlobal("fetch", fetchSpy);
    expect(await lookupCompany({}, "nexx360.io")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns null on a non-200 rather than throwing", async () => {
    vi.stubGlobal("fetch", respond({}, false, 429));
    expect(await lookupCompany({ INDEXED_API_KEY: "idx_x" }, "nexx360.io")).toBeNull();
  });

  it("returns null when the request throws", async () => {
    // Covers the abort as well — a slow lookup must not cost the ranking.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    expect(await lookupCompany({ INDEXED_API_KEY: "idx_x" }, "nexx360.io")).toBeNull();
  });

  it("returns null on a body that is not the shape we expect", async () => {
    vi.stubGlobal("fetch", respond({ data: "not an array" }));
    expect(await lookupCompany({ INDEXED_API_KEY: "idx_x" }, "nexx360.io")).toBeNull();
  });
});

describe("matching on the domain and nothing else", () => {
  it("matches the right row out of several", async () => {
    vi.stubGlobal("fetch", respond({ data: [
      row({ name: "Nexxus", website: "https://nexxus.com", total_funding_raised: 99_000_000 }),
      row(),
    ] }));
    const facts = await lookupCompany({ INDEXED_API_KEY: "idx_x" }, "nexx360.io");
    expect(facts?.name).toBe("Nexx360");
    expect(facts?.totalFundingRaised).toBe(4_000_000);
  });

  it("ignores www and scheme differences", async () => {
    vi.stubGlobal("fetch", respond({ data: [row({ website: "http://www.nexx360.io/" })] }));
    expect((await lookupCompany({ INDEXED_API_KEY: "idx_x" }, "nexx360.io"))?.name).toBe("Nexx360");
  });

  it("refuses a name match on a different domain", async () => {
    // The whole point. "Adagio" is an adtech company, a music tempo and a French
    // software house; a fuzzy name match would attach the wrong funding history
    // to a real company's public page.
    vi.stubGlobal("fetch", respond({ data: [row({ name: "Adagio", website: "https://adagio.fr" })] }));
    expect(await lookupCompany({ INDEXED_API_KEY: "idx_x" }, "adagio.io")).toBeNull();
  });

  it("skips rows with no website at all", async () => {
    vi.stubGlobal("fetch", respond({ data: [{ name: "Nexx360" }, row()] }));
    expect((await lookupCompany({ INDEXED_API_KEY: "idx_x" }, "nexx360.io"))?.hqCity).toBe("Paris");
  });
});

describe("banding a raise", () => {
  it("reads an unfunded company as unfunded, not as tiny", () => {
    expect(fundingBand(0)).toBe("no disclosed funding");
    expect(bandFromFunding(0)).toBeNull();
  });

  it("maps raises onto the board's three stage bands", () => {
    expect(bandFromFunding(1_000_000)).toBe("emerging");
    expect(bandFromFunding(4_000_000)).toBe("emerging");
    expect(bandFromFunding(20_000_000)).toBe("growth");
    expect(bandFromFunding(200_000_000)).toBe("mature");
  });

  it("hands jurors an order of magnitude, not an exact figure", () => {
    // "$12,400,000" invites a model to treat a rounding difference as a finding.
    expect(fundingBand(12_400_000)).toBe("$3M–15M raised");
    expect(fundingBand(12_400_001)).toBe("$3M–15M raised");
  });
});

describe("the block handed to the jurors", () => {
  it("is empty when there are no facts, so the prompt is unchanged", () => {
    expect(factsBlock(null)).toBe("");
  });

  it("names its source and tells the panel not to argue with it", async () => {
    vi.stubGlobal("fetch", respond({ data: [row()] }));
    const facts = await lookupCompany({ INDEXED_API_KEY: "idx_x" }, "nexx360.io");
    const block = factsBlock(facts);
    expect(block).toContain("indexed.vc");
    expect(block).toMatch(/not from the company's website/i);
    expect(block).toContain("$3M–15M raised");
    expect(block).toContain("11-50");
  });

  it("omits fields the lookup did not have rather than printing blanks", async () => {
    vi.stubGlobal("fetch", respond({ data: [row({ hq_city: "", hq_country: "", industries: [] })] }));
    const block = factsBlock(await lookupCompany({ INDEXED_API_KEY: "idx_x" }, "nexx360.io"));
    expect(block).not.toContain("based");
    expect(block).not.toContain("sectors");
    expect(block).toContain("headcount");
  });
});

describe("the credit budget", () => {
  it("does not spend when the monthly reserve is reached", async () => {
    // 25 searches a MONTH against a board with more companies than that. A
    // reserve that is only a comment is not a reserve.
    const fetchSpy = respond({ data: [row()] }, true, 200, 5);
    vi.stubGlobal("fetch", fetchSpy);
    expect(await lookupCompany({ INDEXED_API_KEY: "idx_x" }, "nexx360.io")).toBeNull();
    const paidCalls = fetchSpy.mock.calls.filter((c) => !String(c[0]).includes("/usage"));
    expect(paidCalls).toHaveLength(0);
  });

  it("spends when there is headroom", async () => {
    vi.stubGlobal("fetch", respond({ data: [row()] }, true, 200, 20));
    expect((await lookupCompany({ INDEXED_API_KEY: "idx_x" }, "nexx360.io"))?.name).toBe("Nexx360");
  });

  it("refuses to spend when the usage endpoint will not answer", async () => {
    // Guessing wrong here exhausts a monthly budget silently, and someone else
    // discovers it. Unknown means no.
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) =>
      String(url).includes("/usage")
        ? ({ ok: false, status: 500, json: async () => ({}) } as unknown as Response)
        : ({ ok: true, status: 200, json: async () => ({ data: [row()] }) } as unknown as Response)));
    expect(await lookupCompany({ INDEXED_API_KEY: "idx_x" }, "nexx360.io")).toBeNull();
  });
});
