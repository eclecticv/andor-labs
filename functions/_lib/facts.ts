/**
 * What the panel is told about a company before it reads a word of marketing.
 *
 * ── Why this exists ──
 * Everything else the jurors see comes off the company's own website, which is
 * the one source with an interest in the answer. That is fine for judgement and
 * useless for facts — and the panel was being asked for facts anyway: which
 * round, what year, how big. It was bad at it, measurably. Across 28 companies a
 * round recalled by two or more jurors WITH a matching year came back at roughly
 * zero, and nexx360.io logged `round none 0/3` — not one of three labs could
 * produce it, so the company banded "middle by default".
 *
 * Recall was the wrong instrument. Search answers the same question with a
 * source attached.
 *
 * ── Why search and not a company database ──
 * Measured 2026-08-19 against the two companies actually on this board:
 *
 *   indexed.vc   0 results for The Media Trust, 0 for Nexx360; found only Criteo
 *   Apollo       422 — no credits on the plan
 *   Wikidata     has Criteo, has neither of the others
 *   GLEIF        0 records; LEIs are issued to financial-market entities
 *   registries   France open and keyless, but per-jurisdiction with a US-shaped hole
 *
 * Exa answered all three at $0.007, structured, with a source URL and a
 * confidence label PER FIELD. The confidence is the part that matters: on
 * Nexx360 it returned funding marked `low`, and was right to.
 *
 * ── The schema is capped at ten properties ──
 * Exa's limit, and a good forcing function. The ten below were chosen by
 * measuring which come back correct; see the note above OUTPUT_SCHEMA for the
 * one that was cut and why.
 */

const ENDPOINT = "https://api.exa.ai/search";
const TIMEOUT_MS = 25_000;

export interface FactsEnv {
  EXA_API_KEY?: string;
}

/** How sure Exa is about one field. Carried to the page, never averaged away. */
export type Confidence = "low" | "medium" | "high";

export interface CompanyFacts {
  foundedYear: number;
  /** As Exa returns it — "11-50", "1001-5000". Bucketed on purpose. */
  headcountRange: string;
  hqCity: string;
  hqCountry: string;
  /** One neutral sentence from third-party sources, not the vendor's own line. */
  whatTheyDo: string;
  /** Segments served, rendered as "Serves publishers, adtech platforms, …". */
  serves: string[];
  isPubliclyTraded: boolean;
  totalFundingUsd: number;
  /** Round and year, e.g. "Series B 2023". */
  lastFunding: string;
  /** Empty when independent. */
  acquiredBy: string;
  /** Per-field confidence, keyed by the field names above. */
  confidence: Partial<Record<string, Confidence>>;
  /** Source URLs, keyed the same way. */
  sources: Partial<Record<string, string[]>>;
  /** What the lookup cost in dollars. Logged, so spend is never invisible. */
  costUsd: number;
}

/**
 * ── One field deliberately NOT fetched ──
 *
 * `competitors` returned "the bluebird group, the powers company, mtm
 * recognition, araya, accenture" for The Media Trust — an HR recognition firm
 * mistaken for an adtech vendor, marked HIGH confidence and completely wrong.
 *
 * `serves` survives because of the same test read correctly. Asked for as
 * "notable customers" it returned segments rather than companies, which looked
 * like a failure; asked for as what the company serves, those segments are the
 * right answer and make a usable line on the page.
 *
 * The pattern worth keeping: scalars ABOUT the company retrieve, lists about its
 * RELATIONSHIPS get constructed, and the confidence label does not tell the two
 * apart.
 */
const OUTPUT_SCHEMA = {
  type: "object",
  required: ["founded_year", "headcount_range", "hq_country", "what_they_do", "is_publicly_traded"],
  properties: {
    founded_year: { type: "integer" },
    headcount_range: {
      type: "string",
      description: "one of: 1-10, 11-50, 51-200, 201-500, 501-1000, 1001-5000, 5000+",
    },
    hq_city: { type: "string" },
    hq_country: { type: "string" },
    what_they_do: {
      type: "string",
      description: "one neutral sentence describing what the company sells, not marketing language",
    },
    serves: {
      type: "array",
      items: { type: "string" },
      description: "customer segments served, e.g. publishers, mobile app developers",
    },
    is_publicly_traded: { type: "boolean" },
    total_funding_usd: { type: "integer" },
    last_funding: { type: "string", description: "round and year, e.g. Series B 2023" },
    acquired_by: { type: "string", description: "acquirer name, or empty string if independent" },
  },
};

const SYSTEM_PROMPT =
  "Prefer third-party sources over the company's own marketing. " +
  "If a field cannot be verified from a source, return an empty value rather than guessing. " +
  "Never infer a founding year from a copyright notice.";

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * Look a company up. Returns null on every failure, deliberately.
 *
 * This sits on the critical path in front of four model calls, so a third-party
 * search having a bad afternoon must never cost a visitor their ranking. Absent
 * a key it is a no-op and the pipeline behaves as it did before this existed.
 */
export async function lookupCompany(
  env: FactsEnv,
  domain: string,
  name: string,
): Promise<CompanyFacts | null> {
  if (!env.EXA_API_KEY) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.EXA_API_KEY}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        query: `${name} ${domain} — what the company does, size, age, headquarters, funding, ownership`,
        /* `fast` measures ~450ms against `auto`'s ~1s, but outputSchema adds
           synthesis latency on top of either, so the base type is not where the
           time goes. `auto` is the accuracy default and this runs once. */
        type: "auto",
        category: "company",
        numResults: 8,
        contents: { highlights: true },
        systemPrompt: SYSTEM_PROMPT,
        outputSchema: OUTPUT_SCHEMA,
      }),
    });
    if (!res.ok) {
      console.warn(`[facts] exa ${res.status} for ${domain}`);
      return null;
    }

    const body = (await res.json()) as any;
    const content = body?.output?.content;
    if (!content || typeof content !== "object") return null;

    const confidence: Record<string, Confidence> = {};
    const sources: Record<string, string[]> = {};
    for (const g of body?.output?.grounding ?? []) {
      const field = str(g?.field);
      if (!field) continue;
      if (g?.confidence) confidence[field] = g.confidence as Confidence;
      const urls = (g?.citations ?? []).map((c: any) => str(c?.url)).filter(Boolean);
      if (urls.length) sources[field] = urls.slice(0, 3);
    }

    return {
      foundedYear: num(content.founded_year),
      headcountRange: str(content.headcount_range),
      hqCity: str(content.hq_city),
      hqCountry: str(content.hq_country),
      whatTheyDo: str(content.what_they_do),
      serves: Array.isArray(content.serves) ? content.serves.map(str).filter(Boolean).slice(0, 6) : [],
      isPubliclyTraded: content.is_publicly_traded === true,
      totalFundingUsd: num(content.total_funding_usd),
      lastFunding: str(content.last_funding),
      acquiredBy: str(content.acquired_by),
      confidence,
      sources,
      costUsd: num(body?.costDollars?.total),
    };
  } catch (err) {
    console.warn(`[facts] lookup failed for ${domain}:`, err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Weight classes ──────────────────────────────────────────────────────────

export type Division = "lightweight" | "middleweight" | "heavyweight";

export const DIVISIONS: { key: Division; label: string; blurb: string }[] = [
  { key: "lightweight", label: "Lightweight", blurb: "Up to 50 people." },
  { key: "middleweight", label: "Middleweight", blurb: "51 to 500 people." },
  { key: "heavyweight", label: "Heavyweight", blurb: "More than 500 people." },
];

/**
 * Headcount, not capital, decides the weight class.
 *
 * The board banded on funding stage until now, and funding stage is not on these
 * websites: a round appears in crawlable markup on 7% of them and jurors recall
 * one about 0% of the time, so `place()` kept falling through to "middle band by
 * default" — a division that classified nothing.
 *
 * Headcount resolves on every company Exa has answered, at high confidence, and
 * it is the more honest axis anyway. A reader comparing two vendors on this
 * board wants to know whether they are comparing nine people to nine hundred.
 */
export function divisionFor(headcountRange: string): Division | null {
  const first = Number((headcountRange.match(/\d+/) ?? [])[0]);
  if (!Number.isFinite(first)) return null;
  if (first >= 501) return "heavyweight";
  if (first >= 51) return "middleweight";
  return "lightweight";
}

/** Years since founding, or 0 when unknown. The board's second filter axis. */
export function ageOf(foundedYear: number, now = new Date().getUTCFullYear()): number {
  if (!foundedYear || foundedYear < 1800 || foundedYear > now) return 0;
  return now - foundedYear;
}

// ── What the jurors are handed ──────────────────────────────────────────────

const CONF_NOTE: Record<Confidence, string> = {
  high: "",
  medium: " (reported, not corroborated)",
  low: " (uncertain)",
};

/**
 * The facts block, byte-identical across the three seats like the rest of the
 * rubric.
 *
 * Marked as third-party and carrying its own uncertainty, because the rest of
 * the prompt spends its time teaching jurors to distrust the site — a block that
 * arrived without provenance would read as one more claim.
 */
export function factsBlock(facts: CompanyFacts | null): string {
  if (!facts) return "";

  const line = (label: string, value: string, key: string) => {
    if (!value) return "";
    const conf = facts.confidence[key];
    return `  ${label.padEnd(11)}${value}${conf ? CONF_NOTE[conf] : ""}`;
  };

  const rows = [
    line("does", facts.whatTheyDo, "what_they_do"),
    line("serves", facts.serves.join(", "), "serves"),
    line("founded", facts.foundedYear ? String(facts.foundedYear) : "", "founded_year"),
    line("size", facts.headcountRange ? `${facts.headcountRange} people` : "", "headcount_range"),
    line("based", [facts.hqCity, facts.hqCountry].filter(Boolean).join(", "), "hq_city"),
    line("funding", facts.totalFundingUsd ? `$${(facts.totalFundingUsd / 1e6).toFixed(1)}M raised` : "", "total_funding_usd"),
    line("last round", facts.lastFunding, "last_funding"),
    line("owner", facts.acquiredBy ? `acquired by ${facts.acquiredBy}` : "", "acquired_by"),
  ].filter(Boolean).join("\n");

  if (!rows) return "";

  return `
═══ ESTABLISHED FACTS ═══
Gathered by search from third-party sources, NOT from the company's website.
Treat them as settled. Do not contradict them and do not present them back as
your own finding. Where a line is marked uncertain, weigh it as such.

${rows}
`;
}
