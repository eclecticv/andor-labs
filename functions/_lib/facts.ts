/**
 * Third-party facts about a company, so the panel stops being asked to recall
 * them.
 *
 * ── Why this exists ──
 * Everything else the panel reads comes off the company's own website, which is
 * the one source with an interest in the answer. That is fine for judgement —
 * the whole point of the rubric is to read a marketing site sceptically — but it
 * is useless for FACTS, and the panel was being asked for facts anyway: which
 * funding round, what year, which investor.
 *
 * It was bad at it, measurably. Across 28 companies a round was recalled by two
 * or more panelists WITH a matching year roughly never, and the live run on
 * nexx360.io logged `round none 0/3` — not one of three labs could produce it.
 * So the majority vote was doing nothing except filtering noise that should not
 * have been generated: three models each spending output tokens guessing, and a
 * quorum rule discarding all three guesses.
 *
 * A lookup answers the same question with a source. Indexed.vc publishes funding
 * totals, headcount bands and headquarters for ~41,000 private companies, and
 * its free tier covers exactly the search this needs.
 *
 * ── Everything here fails soft, on purpose ──
 * No key, no match, a non-200, a timeout, malformed JSON — all return null, and
 * a null simply means the panel is asked the old way. A ranking must never fail
 * because a third-party enrichment API had a bad afternoon; that is the same
 * rule `syncLeadToLoops` follows for the CRM, for the same reason.
 *
 * Required environment:
 *   INDEXED_API_KEY   optional. Absent, every lookup returns null and the
 *                     pipeline behaves exactly as it did before this file.
 */

const ENDPOINT = "https://indexed.vc/api/v1/companies";

/** Bounded so a hanging lookup cannot eat the ranking's latency budget. */
const LOOKUP_TIMEOUT_MS = 8_000;

export interface FactsEnv {
  INDEXED_API_KEY?: string;
}

export interface CompanyFacts {
  /** Their canonical name for the company, which may differ from the site's. */
  name: string;
  /** Total raised, in whole units of currency. 0 when unknown or unfunded. */
  totalFundingRaised: number;
  employeeCountRange: string;
  hqCity: string;
  hqCountry: string;
  industries: string[];
  shortDescription: string;
  /** Where this came from, printed on the page. A fact with no source is a claim. */
  source: string;
}

/** Reduce a URL to a bare comparable host. */
function hostOf(value: string): string | null {
  try {
    const raw = value.trim();
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Match on the website host and nothing else.
 *
 * Name matching is what turns an enrichment API into a fabrication engine:
 * "Adagio" is an adtech company, a music tempo, a French software house and at
 * least two other startups, and a fuzzy name match would confidently attach
 * another company's funding history to this one. A domain is the identifier the
 * company actually controls. If the domains do not agree, we have no facts, and
 * no facts is a perfectly good answer.
 */
function pickByDomain(results: unknown, domain: string): Record<string, unknown> | null {
  if (!Array.isArray(results)) return null;
  const want = hostOf(domain);
  if (!want) return null;
  for (const row of results) {
    if (typeof row !== "object" || row === null) continue;
    const site = (row as Record<string, unknown>).website;
    if (typeof site !== "string") continue;
    if (hostOf(site) === want) return row as Record<string, unknown>;
  }
  return null;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export async function lookupCompany(
  env: FactsEnv,
  domain: string,
): Promise<CompanyFacts | null> {
  if (!env.INDEXED_API_KEY) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(`${ENDPOINT}?q=${encodeURIComponent(domain)}`, {
      headers: { "X-API-Key": env.INDEXED_API_KEY, accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[facts] indexed.vc ${res.status} for ${domain}`);
      return null;
    }
    const body = (await res.json()) as { data?: unknown };
    const row = pickByDomain(body?.data, domain);
    if (!row) return null;

    return {
      name: str(row.name),
      totalFundingRaised: num(row.total_funding_raised),
      employeeCountRange: str(row.employee_count_range),
      hqCity: str(row.hq_city),
      hqCountry: str(row.hq_country),
      industries: Array.isArray(row.industries) ? row.industries.map(str).filter(Boolean) : [],
      shortDescription: str(row.short_description),
      source: "indexed.vc",
    };
  } catch (err) {
    // Includes the abort. A slow enrichment call must not cost the ranking.
    console.warn(`[facts] lookup failed for ${domain}:`, err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Round a raise to a band a juror can reason about without doing arithmetic.
 *
 * Deliberately coarse. The exact figure is on the page for anyone who wants it;
 * what a juror needs is the order of magnitude, and handing it "$12,400,000"
 * invites the model to treat a rounding difference as a finding.
 */
export function fundingBand(total: number): string {
  if (total <= 0) return "no disclosed funding";
  if (total < 3_000_000) return "under $3M raised";
  if (total < 15_000_000) return "$3M–15M raised";
  if (total < 50_000_000) return "$15M–50M raised";
  if (total < 150_000_000) return "$50M–150M raised";
  return "over $150M raised";
}

/**
 * The block handed to every juror, byte-identical across the three seats.
 *
 * Framed as established and third-party so a juror weighs it as evidence rather
 * than as another marketing claim — and told plainly that it comes from
 * somewhere other than the site, because the rest of the prompt spends its time
 * teaching them to distrust the site.
 */
export function factsBlock(facts: CompanyFacts | null): string {
  if (!facts) return "";
  const lines = [
    `  funding    ${fundingBand(facts.totalFundingRaised)}`,
    facts.employeeCountRange ? `  headcount  ${facts.employeeCountRange}` : "",
    [facts.hqCity, facts.hqCountry].filter(Boolean).length
      ? `  based      ${[facts.hqCity, facts.hqCountry].filter(Boolean).join(", ")}`
      : "",
    facts.industries.length ? `  sectors    ${facts.industries.join(", ")}` : "",
  ].filter(Boolean).join("\n");

  return `
═══ ESTABLISHED FACTS ═══
Not from the company's website — these come from ${facts.source}, a third-party
database. Treat them as settled. Do not contradict them, and do not repeat them
back as if they were your finding.

${lines}
`;
}

/** Which stage band a raise implies, mirroring MODEL_BAND in classify.ts. */
export function bandFromFunding(total: number): "emerging" | "growth" | "mature" | null {
  if (total <= 0) return null;
  if (total < 5_000_000) return "emerging";
  if (total < 60_000_000) return "growth";
  return "mature";
}
