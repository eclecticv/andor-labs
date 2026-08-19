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
  /**
   * The domain the search believes this company owns — the disambiguation
   * receipt, checked against the domain that was actually crawled.
   *
   * Replaced `isPubliclyTraded`, which was parsed and stored and then read by
   * nothing: the page builds its rows explicitly and never included it, and the
   * public-company refusal is markup-based and runs BEFORE this lookup. It was
   * occupying one of ten schema slots to no end.
   */
  officialWebsite: string;
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
  required: ["founded_year", "headcount_range", "hq_country", "what_they_do", "official_website"],
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
    official_website: {
      type: "string",
      description: "the domain of the company's own website, e.g. example.com",
    },
    total_funding_usd: { type: "integer" },
    last_funding: { type: "string", description: "round and year, e.g. Series B 2023" },
    acquired_by: { type: "string", description: "acquirer name, or empty string if independent" },
  },
};

const SYSTEM_PROMPT =
  "The company in question is the one that operates the website at the domain in the query, and no other. " +
  "If the sources describe a different company with a similar name, return empty values rather than that company's facts. " +
  "Prefer third-party sources over the company's own marketing. " +
  "If a field cannot be verified from a source, return an empty value rather than guessing. " +
  "Never infer a founding year from a copyright notice.";

/**
 * The domain is the subject of the question, not a token inside it.
 *
 * The first version asked `${name} ${domain} — what the company does, …`, which
 * put the strongest retrieval signal — a proper noun — on the one part of the
 * input that is not unique. `confiant.com` came back as "Confiant Solutions",
 * an Indian IT-training consultancy: founded 0, headcount 1-10, country India,
 * and a `whatTheyDo` about network certifications. Every field was internally
 * consistent and about the wrong company. A domain is unique and a company name
 * is not, so the domain leads, and repeats.
 *
 * ── Three retrieval-side constraints considered and rejected ──
 * `includeText: [domain]` is the constraint that would actually bind, and it is
 * NOT AVAILABLE: Exa refuses includeText, excludeText and excludeDomains under
 * `category: "company"`. Dropping the category to buy it would trade away the
 * parameter doing most of the retrieval work.
 *
 * `includeDomains: [domain]` IS permitted here, and is refused on purpose — it
 * would source the facts block entirely from the company's own marketing, which
 * is the one thing this module exists not to do. Note two of the five correct
 * rows on the board (adpushup, ezoic) are grounded wholly on linkedin.com.
 *
 * `userLocation: "US"` would have rescued Confiant and would systematically
 * mislead on every European vendor. Rejected as a fix that works by knowing the
 * answer in advance.
 *
 * So framing is persuasion, not enforcement, and `factsProblem` is the part that
 * actually holds.
 */
export const companyQuery = (domain: string, name: string) =>
  `${domain} — the company operating the website ${domain} (${name}): ` +
  `what it does, size, age, headquarters, funding, ownership`;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Bare host: no scheme, no `www.`, no port, no path. */
export const host = (v: string) =>
  v.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#:]/)[0];

/**
 * The same site, tolerating a subdomain in either direction.
 *
 * Deliberately loose. `go.acme.com` and `acme.com` are one company, and this
 * check exists to catch a DIFFERENT company, not to audit DNS. A strict equality
 * here would reject correct answers for cosmetic reasons and teach whoever hits
 * it to remove the check.
 */
export const sameSite = (a: string, b: string) => {
  const [x, y] = [host(a), host(b)];
  if (!x || !y) return false;
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
};

/**
 * The response body, mapped. No judgement — that is `factsProblem`'s job.
 *
 * Split out from the fetch so the gate below can be tested against the six real
 * payloads without a network or a key. No test in this repo mocks `fetch`, and
 * this is the same normalize/assert split `classify.ts` and `panel.ts` already
 * use — except these return null rather than throwing, because this module's
 * contract is to fail soft.
 */
export function normalizeFacts(body: any): CompanyFacts | null {
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
    officialWebsite: str(content.official_website),
    totalFundingUsd: num(content.total_funding_usd),
    lastFunding: str(content.last_funding),
    acquiredBy: str(content.acquired_by),
    confidence,
    sources,
    costUsd: num(body?.costDollars?.total),
  };
}

/**
 * Why this payload must not be trusted, or null when it may be.
 *
 * ── The grounding gate ──
 * Measured across the six companies on the board, counting fields with at least
 * one citation behind them:
 *
 *   blockthrough.com   9   founded 2015   cites blockthrough.com
 *   adpushup.com      10   founded 2014   cites www.linkedin.com
 *   mediatrust.com    10   founded 2005   cites mediatrust.com
 *   useadmesh.com      7   founded    0   cites useadmesh.com
 *   ezoic.com         10   founded 2010   cites www.linkedin.com
 *   confiant.com       0   founded    0   cites NOTHING
 *
 * Zero is not the low end of that distribution, it is off it — and it was the
 * one row describing a different company. The threshold sits at one citation
 * because that is where the gap is: useadmesh answered SPARSELY, with no
 * founding year at all, and still grounded seven fields. Sparse and ungrounded
 * are separable, and this gate catches only the second.
 *
 * The gate reads CITATIONS, not confidence. A confidence label with no citation
 * under it is precisely the failure already recorded above OUTPUT_SCHEMA:
 * `competitors` returned an HR recognition firm for The Media Trust, marked
 * HIGH. Confidence is the model's opinion of itself; a citation is a receipt.
 *
 * ── Two things this deliberately does NOT do ──
 * It does not require a citation on the crawled domain. Two of the five correct
 * rows are grounded wholly on linkedin.com, and such a rule would reject both.
 *
 * It does not reject field by field. The failure here was one wrong ENTITY —
 * every field consistent, all of them about someone else — so the gate is
 * entity-level too. Per-field stripping would also have quietly deleted
 * useadmesh's three ungrounded fields for no measured gain, while leaving
 * Confiant exactly as broken. `facts_json` is the audit record of what the
 * search actually said, and editing it at parse time makes the stored row a
 * fiction that can never be checked back against the provider.
 *
 * ── What rejection costs ──
 * A refused lookup means no facts block, a NULL founding year, and absence from
 * the board's age- and weight-filtered views. That is worse than correct facts
 * and strictly better than another company's, and it is the same call
 * `ageBucketOf` in src/lib/rankings.ts already makes: a company sorted into a
 * bucket because nothing was found would be the page asserting a fact it does
 * not have.
 */
export function factsProblem(facts: CompanyFacts, domain: string): string | null {
  if (!Object.keys(facts.sources).length) {
    return "no citations — nothing returned was tied to a source";
  }
  /* Only a CONFIDENT mismatch rejects. An empty official_website is a field the
     search declined to fill, which the citation check above already speaks to;
     treating absence as a mismatch would let one unmeasured field veto the whole
     lookup. */
  if (facts.officialWebsite && !sameSite(facts.officialWebsite, domain)) {
    return `wrong company — answered about ${host(facts.officialWebsite)}, asked about ${domain}`;
  }
  return null;
}

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
        query: companyQuery(domain, name),
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

    const facts = normalizeFacts(await res.json());
    if (!facts) return null;

    const problem = factsProblem(facts, domain);
    if (problem) {
      console.warn(`[facts] rejected for ${domain}: ${problem}`);
      return null;
    }
    return facts;
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

  /**
   * The founding year is named rather than dropped when it is missing.
   *
   * Every other line here may simply be absent — a juror who is not told the
   * funding total does not go looking for one. The founding year is different,
   * because the innovation question INSTRUCTS jurors to "judge against the
   * category in their founding year, not today". Filtering the empty line out
   * left that question asking for an anchor the prompt had not supplied, and
   * nothing anywhere said so; the juror simply supplied a year from its priors.
   *
   * That is the fail-open shape of this whole bug in miniature. Wrong facts were
   * survivable on confiant.com because the site corpus contradicted them loudly.
   * An ABSENT fact is not, because nothing contradicts an absence. So an absence
   * that the rubric depends on is stated, and the juror is told what to do with
   * it instead of being left to improvise.
   */
  const founded = facts.foundedYear
    ? line("founded", String(facts.foundedYear), "founded_year")
    : "  founded    NOT ESTABLISHED — say so rather than assuming a year";

  const rows = [
    line("does", facts.whatTheyDo, "what_they_do"),
    line("serves", facts.serves.join(", "), "serves"),
    founded,
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

// ── What the press has said ─────────────────────────────────────────────────

export interface PressItem {
  /** Which question this evidence speaks to. Printed, so a juror knows why. */
  angle: "engineering" | "origin";
  title: string;
  url: string;
  excerpt: string;
  publishedAt: string;
}

/**
 * A second search, over news rather than company pages, returning EXCERPTS.
 *
 * ── Why this is not the spoon-feeding the rubric just removed ──
 * The menu that was cut told jurors what kinds of answer to give. This tells
 * them nothing; it hands over other people's sentences with the URLs attached
 * and leaves the judgement alone.
 *
 * ── Why it is needed ──
 * Blockthrough scored "no" on difficulty because its own site does not describe
 * a barrier, and three jurors said so. But the press does: a Deloitte
 * Companies-to-Watch award, the acquisition of a competitor, 11th
 * fastest-growing company in Canada, named publisher partnerships. A panel
 * reading the homepage alone cannot see any of it, so it scored the marketing
 * rather than the company.
 *
 * ── Why there is no outputSchema here ──
 * Deliberately. Asking for synthesis is what produced "the bluebird group, the
 * powers company, mtm recognition" as this company's competitors — high
 * confidence and entirely invented. Highlights are spans lifted out of real
 * articles, so there is nothing for a model to construct.
 */
/**
 * Two aimed searches, not one grab bag.
 *
 * ── Why the first version failed ──
 * It asked for "awards, recognition, funding, acquisitions, notable engineers
 * and leadership, partnerships" and got back exactly what press-release genres
 * produce: a Deloitte growth award, an acquisition, 11th fastest-growing company
 * in Canada, two partnership announcements. Every item commercial, not one
 * describing how anything works. The jurors read it and correctly declined to
 * treat a growth award as evidence that something is hard to build — so
 * Blockthrough kept scoring "no" on difficulty while its filtering engine was
 * built by a co-creator of Prebid.js.
 *
 * ── Why two and not one merged query ──
 * Measured. A merged query returned founder interviews and category history for
 * Blockthrough and lost the engineering hit entirely; asked on its own, the
 * engineering query surfaced both the detection flow and "Blockthrough Names
 * Prebid.js Co-Creator Matt Kendall". Specificity is what finds these, and a
 * query covering two things is specific about neither.
 *
 * Three results each, so the prompt grows by roughly what the single call cost.
 * Prompt length on this tool is a latency budget, not a preference.
 */
const EVIDENCE_ANGLES: { angle: PressItem["angle"]; ask: string }[] = [
  {
    angle: "engineering",
    ask: "how the technology works, its architecture, and the engineers who built it",
  },
  {
    angle: "origin",
    ask: "when it launched, what it was first to do, and how the category looked before it",
  },
];

/**
 * The domain rides along as a disambiguator, not as a filter.
 *
 * `${name} — ${ask}` was a bare proper noun, with `excludeDomains` pushing
 * results AWAY from the one site that would have settled which company was
 * meant. That is the same name-collision exposure that put an Indian IT-training
 * consultancy in `lookupCompany`'s answer for confiant.com, and here it would
 * feed another company's press to all three jurors verbatim.
 *
 * Parenthesised rather than made the subject, unlike `companyQuery`: press
 * coverage writes "Confiant", not "confiant.com", so leading with the domain
 * would cost recall on the very sources this call exists to find.
 */
export const pressQuery = (name: string, domain: string, ask: string) =>
  `${name} (${domain}) — ${ask}`;

async function searchAngle(
  key: string,
  domain: string,
  name: string,
  angle: PressItem["angle"],
  ask: string,
): Promise<PressItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      signal: controller.signal,
      body: JSON.stringify({
        query: pressQuery(name, domain, ask),
        type: "auto",
        numResults: 5,
        contents: { highlights: true },
        /* The company's own site is already the panel's main input. This call
           exists to find what everyone else published.

           No `category` is set on this call, and that is load-bearing rather
           than an oversight: Exa refuses excludeDomains under
           `category: "company"` and `"people"`. Adding one here would silently
           stop this exclusion from applying. */
        excludeDomains: [domain],
      }),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as any;
    return (body?.results ?? [])
      .map((r: any) => ({
        angle,
        title: str(r?.title),
        url: str(r?.url),
        excerpt: (Array.isArray(r?.highlights) ? r.highlights.join(" ") : "")
          .replace(/\s+/g, " ").trim().slice(0, 200),
        publishedAt: str(r?.publishedDate).slice(0, 10),
      }))
      .filter((p: PressItem) => p.title && p.excerpt)
      .slice(0, 3);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function lookupPress(
  env: FactsEnv,
  domain: string,
  name: string,
): Promise<PressItem[]> {
  if (!env.EXA_API_KEY) return [];
  const groups = await Promise.all(
    EVIDENCE_ANGLES.map((a) => searchAngle(env.EXA_API_KEY!, domain, name, a.angle, a.ask)),
  );
  return groups.flat();
}

const ANGLE_HEADING: Record<PressItem["angle"], string> = {
  engineering: "HOW IT WORKS, AND WHO BUILT IT",
  origin: "WHERE IT CAME FROM",
};

/**
 * Grouped by angle, because an excerpt is only evidence for a particular
 * question and a juror should not have to guess which.
 */
export function pressBlock(press: PressItem[]): string {
  if (!press.length) return "";

  const sections = (Object.keys(ANGLE_HEADING) as PressItem["angle"][])
    .map((angle) => {
      const items = press.filter((p) => p.angle === angle);
      if (!items.length) return "";
      const rows = items
        .map((p) => `  · ${p.title}${p.publishedAt ? ` (${p.publishedAt})` : ""}\n    "${p.excerpt}"\n    ${p.url}`)
        .join("\n");
      return `── ${ANGLE_HEADING[angle]} ──\n${rows}`;
    })
    .filter(Boolean)
    .join("\n\n");

  return `
═══ WHAT OTHERS HAVE PUBLISHED ═══
Third-party coverage, excerpted verbatim. Not the company's own newsroom.

This is evidence the website does not carry. A site that never explains its
engineering is not the same as a company that has none, and a category's history
is not on the homepage of anyone currently selling into it.

It is still someone's writing, and a press release is still marketing. Weigh it.

${sections}
`;
}
