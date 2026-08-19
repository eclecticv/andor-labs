/**
 * Where a company sits: public or private, which stage band, which side of the
 * supply chain, which subcategory.
 *
 * Everything the leaderboard's structure depends on is decided here, and almost
 * none of it is left to a language model. That is deliberate. Cohorts only work
 * if classification is stable — a company that lands in "emerging sell-side" on
 * Monday and "growth independent" on Tuesday makes every rank around it wrong
 * too, and this pipeline has already been burned twice by inferring stage from
 * tone. Marketing copy is written to sound established, so a model reading it
 * for stage is biased upward by construction.
 *
 * So the order of authority is:
 *   1. Structural evidence in the markup   (regex, deterministic, wins)
 *   2. The model's read                    (only where 1 found nothing)
 *   3. A safe default                      (only where neither had anything)
 */

// ── Subcategories ───────────────────────────────────────────────────────────

/**
 * Adtech subcategories — a CLOSED set, because cohorts depend on it.
 *
 * Peer comparison ranks a company against others in its category, so a
 * free-text category is the same as no category: two companies doing the same
 * thing land in "AI curation platform" and "curation AI" and never meet.
 *
 * Moved here from the old scorer, which is gone. This list is the only part of
 * that module that outlived the four dimensions, and it belongs next to the
 * side lookup that reads it — the two are a single decision expressed twice.
 */
export const CATEGORIES = [
  { key: "publisher-monetization", label: "Publisher Monetization" },
  { key: "ssp",                    label: "Supply-Side Platforms" },
  { key: "header-bidding",         label: "Header Bidding" },
  { key: "ad-server",              label: "Ad Serving" },
  { key: "paywall",                label: "Paywall & Subscriptions" },
  { key: "adblock-recovery",       label: "Adblock Revenue Recovery" },
  // ── Buy-side ──
  // Was three keys against sell-side's seven, which is why the buy-side tab
  // looked empty: not because buy-side vendors were missing from the board,
  // but because there was nowhere for most of them to land. An MMP, a retail
  // media buying tool and a planning system all had to call themselves "DSP &
  // Media Buying" or fall through to "Other", and "Other" is independent.
  //
  // These five are additive on purpose. No existing key changes meaning and no
  // existing key changes side, so every score already on the board stays
  // exactly as comparable as it was — the fix costs no rerank.
  { key: "dsp",                    label: "DSP & Media Buying" },
  { key: "curation",               label: "Curation & Marketplaces" },
  { key: "creative",               label: "Creative & DCO" },
  { key: "mmp",                    label: "Mobile Measurement (MMP)" },
  { key: "retail-media-buying",    label: "Retail Media Buying Tools" },
  { key: "search-social",          label: "Search & Social Management" },
  { key: "planning-workflow",      label: "Media Planning & Workflow" },
  { key: "agentic-buying",         label: "Agentic Buying & Ad Protocols" },
  { key: "identity",               label: "Identity & Alt ID" },
  { key: "clean-rooms",            label: "Data & Clean Rooms" },
  { key: "contextual",             label: "Contextual & Semantic" },
  { key: "fraud-quality",          label: "Fraud & Traffic Quality" },
  { key: "consent-privacy",        label: "Consent & Privacy" },
  { key: "measurement",            label: "Measurement & Attribution" },
  { key: "retail-media",           label: "Retail & Commerce Media" },
  { key: "ctv-audio",              label: "CTV & Audio" },
  { key: "adops-agentic",          label: "Ad Ops & Agentic Tooling" },
  { key: "other",                  label: "Other" },
] as const;

/**
 * Where a category gets confused with its neighbour, said out loud.
 *
 * Categories that sound alike are the ones a model gets wrong, and it gets them
 * wrong from marketing copy — which is written to sound like the more
 * impressive neighbour. `agentic-buying` is the sharp case: without the guard
 * every vendor who bolted a chat box onto an existing UI lands in it, and the
 * newest category on the board becomes its least meaningful.
 *
 * Only categories with a real confusable neighbour appear here.
 */
export const CATEGORY_NOT: Partial<Record<string, string>> = {
  dsp: "NOT curation or a trading desk — a DSP runs its own bidder rather than buying through someone else's seat.",
  curation: "NOT a DSP — curators package and resell deals bought through a DSP seat; they do not run the auction.",
  mmp: "NOT measurement — MMP is app install attribution and SKAdNetwork/AdAttributionKit postbacks specifically.",
  "retail-media-buying": "NOT retail-media — that is the retailer's own network selling its own inventory, which is sell-side. This is the advertiser-side tooling for buying across those networks.",
  /**
   * Two guards, and the second was learned the hard way.
   *
   * The first stops every vendor with a chat box landing here. The second
   * stops PUBLISHER-side agents landing here, which is a worse failure because
   * this category is buy-side: pubX, a publisher yield product, classified as
   * agentic-buying on the first re-rank and would have been moved from
   * sell-side to buy-side by a category note rather than by anything true
   * about the company.
   *
   * "Agentic" is the word of the moment on both sides of the supply chain, so
   * the discriminator has to be who the customer is, not what the product is
   * called.
   */
  "agentic-buying": "ADVERTISER-side only — the customer must be someone spending a media budget. A publisher-side agent that optimises yield, floors, or inventory is NOT this; it is publisher-monetization or ssp no matter how agentic the copy is. Also NOT adops-agentic, and NOT a chatbot bolted onto an existing UI: requires a protocol implementation or an agent that takes actions rather than drafting them.",
  "adops-agentic": "Neutral ad ops tooling sold to the ecosystem. If the product is advertisers buying media through an agent, that is agentic-buying.",
  measurement: "NOT fraud-quality — measurement asks whether the ad worked; verification asks whether it was viewable and safe.",
};

export type Category = (typeof CATEGORIES)[number]["key"];
export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);
export const categoryLabel = (key: string) =>
  CATEGORIES.find((c) => c.key === key)?.label ?? "Other";

// ── Side ────────────────────────────────────────────────────────────────────

export type Side = "buy" | "sell" | "independent";

export const SIDE_LABELS: Record<Side, string> = {
  buy: "Buy-side",
  sell: "Sell-side",
  // Renders as "Infrastructure" everywhere a reader sees it (site + OG card) —
  // "independent" reads as a maturity band. The KEY stays `independent`.
  independent: "Infrastructure",
};

/**
 * Side is DERIVED from subcategory, never asked for separately.
 *
 * Two questions with one right answer are one question. Asking a model for both
 * "what category" and "what side" invites the contradiction where a company is
 * an SSP on the buy side, and then the board has to decide which field it
 * believes. One lookup table removes the possibility.
 *
 * The old taxonomy's six-value `side` field collapses to three: anything that
 * sells inventory is sell-side, anything that spends a budget is buy-side, and
 * measurement, identity, privacy, fraud and tooling are independent because
 * their whole commercial premise is not being either.
 */
const SIDE_BY_CATEGORY: Record<Category, Side> = {
  "publisher-monetization": "sell",
  ssp: "sell",
  "header-bidding": "sell",
  "ad-server": "sell",
  paywall: "sell",
  "adblock-recovery": "sell",
  // Retail media networks and streamers sell their own inventory. They read as
  // "channels" rather than as supply, but commercially they are the supply.
  "retail-media": "sell",
  "ctv-audio": "sell",

  dsp: "buy",
  curation: "buy",
  creative: "buy",
  mmp: "buy",
  "retail-media-buying": "buy",
  "search-social": "buy",
  "planning-workflow": "buy",
  "agentic-buying": "buy",

  // Held on the independent side deliberately, and it is worth writing down
  // why, because the obvious argument runs the other way: measurement and
  // verification vendors mostly invoice advertisers, so "they take a buyer's
  // money" would move both to buy.
  //
  // The board's split is not who pays. It is whose interest the product serves.
  // A measurement vendor that reported only what its buyer wanted to hear would
  // be worthless to that buyer — the neutrality IS the product, same as fraud
  // detection, consent and identity. Moving them would also silently re-cohort
  // every company already scored under them, which is a rerank dressed as a
  // taxonomy edit.
  identity: "independent",
  "clean-rooms": "independent",
  contextual: "independent",
  "fraud-quality": "independent",
  "consent-privacy": "independent",
  measurement: "independent",
  "adops-agentic": "independent",
  other: "independent",
};

export const sideFor = (category: Category): Side => SIDE_BY_CATEGORY[category] ?? "independent";

/**
 * Human corrections, by domain. These beat the panel.
 *
 * The panel votes on category and is right most of the time, but it reads a
 * website and a website is not always candid about who writes the cheque.
 * pubX is the worked example: its own copy says it "automates programmatic
 * buying and selling", so two of three models filed it under curation — a
 * buy-side box — when it is a publisher yield product. The clue the models
 * missed is in the name. "pub" is publisher.
 *
 * Without this table a correction survives exactly until the company is ranked
 * again, at which point the same three models make the same reasonable mistake
 * and quietly undo it. Domain expertise that cannot be written down is
 * expertise the tool loses every run.
 */
export const CATEGORY_OVERRIDES: Record<string, Category> = {
  // Publisher-side yield and pricing, despite the "buying and selling" copy.
  "pubx.ai": "publisher-monetization",
};

/** The panel's vote, unless a human has corrected this domain. */
export function categoryFor(domain: string, voted: string, fallback: Category): Category {
  const override = CATEGORY_OVERRIDES[domain.toLowerCase()];
  if (override) return override;
  return (CATEGORY_KEYS as readonly string[]).includes(voted) ? (voted as Category) : fallback;
}

// ── Bands ───────────────────────────────────────────────────────────────────

export type Band = "emerging" | "growth" | "mature";

export const BANDS: { key: Band; label: string; blurb: string }[] = [
  { key: "emerging", label: "Emerging", blurb: "Pre-seed and seed. Ideas with a landing page and a lot of nerve." },
  { key: "growth", label: "Growth", blurb: "Series A and B. Past the demo, not yet past the org chart." },
  { key: "mature", label: "Mature", blurb: "Series C and beyond, still private. Big enough to have politics." },
];

export const BAND_LABELS: Record<Band, string> = {
  emerging: "Emerging",
  growth: "Growth",
  mature: "Mature",
};

/**
 * Publicly listed companies are not startups, and are refused outright.
 *
 * These signals are strong and one-sided: a private company has no reason to
 * publish an investor-relations section or print a ticker in its footer. False
 * positives are near-impossible, which is what makes an outright refusal safe
 * here when it would not be for the band signals below.
 */
const PUBLIC_PATTERNS: [RegExp, string][] = [
  // Case matters here and the `i` flag would break it: under `i`, `[A-Z]{2,5}`
  // also matches lowercase, so "nasdaq: the listing rules" would read as a
  // ticker. The exchange names are therefore spelled the way sites actually
  // print them, and the ticker itself stays strictly uppercase.
  [/\b(NASDAQ|Nasdaq|NYSE|LSE|TSX|ASX|EURONEXT|Euronext)\s*[:.]\s*[A-Z]{2,5}\b/, "prints a stock ticker"],
  [/\binvestor\s+relations\b/i, "has an investor-relations section"],
  [/\b(our|the)\s+ipo\b|\bwent\s+public\b|\bpublicly\s+traded\b/i, "has gone public"],
  [/\bshareholder\s+(meeting|letter|report)\b/i, "publishes shareholder reports"],
  [/\b(sec|edgar)\s+filings?\b/i, "files with the SEC"],
  [/\b(annual|quarterly)\s+report\s+20\d\d\b/i, "publishes annual reports"],
];

/**
 * Funding-round signals, strongest first.
 *
 * Only explicit round language counts. Everything softer — team size, office
 * count, customer logos — was tried and dropped: a well-funded seed company
 * lists eight customers and a bootstrapped ten-year-old lists none, so those
 * signals sort by marketing budget rather than by stage.
 */
const ROUND_PATTERNS: [RegExp, Band, string][] = [
  [/\bseries\s+[d-h]\b/i, "mature", "announces a late-stage round"],
  [/\bseries\s+c\b/i, "mature", "announces a Series C"],
  [/\bseries\s+b\b/i, "growth", "announces a Series B"],
  [/\bseries\s+a\b/i, "growth", "announces a Series A"],
  [/\bseed\s+round\b|\braised.{0,20}\bseed\b/i, "emerging", "announces a seed round"],
  [/\bpre-?seed\b/i, "emerging", "announces a pre-seed round"],
  // Accelerator batches are dated and public, and every one of them is
  // pre-seed or seed by definition.
  [/\b(y\s*combinator|techstars|500\s+startups|antler)\b/i, "emerging", "went through an accelerator"],
];

/**
 * Amounts, when no round is named.
 *
 * Plenty of announcements say "$12M in new funding" and never name a letter.
 * The amount is still explicit, structural and stated by the company, which is
 * the standard these patterns hold to — it is not an inference from tone.
 *
 * The thresholds are deliberately coarse, because the mapping from cheque size
 * to round genuinely is: a $10M seed and a $10M Series A both exist, and no
 * boundary here is going to separate them. They are set to be right about the
 * ORDER of magnitude, which is all the band needs.
 */
const AMOUNT_RE = /\braised?\b[^.]{0,40}?\$\s?(\d+(?:\.\d+)?)\s?(m|mm|million|bn|b|billion)\b|\$\s?(\d+(?:\.\d+)?)\s?(m|mm|million|bn|b|billion)\b[^.]{0,30}?\b(?:in\s+)?(?:new\s+)?(?:funding|round|investment|financing)\b/i;

function bandFromAmount(haystack: string): { band: Band; why: string } | null {
  const m = AMOUNT_RE.exec(haystack);
  if (!m) return null;
  const value = Number.parseFloat(m[1] ?? m[3] ?? "");
  const unit = (m[2] ?? m[4] ?? "").toLowerCase();
  if (!Number.isFinite(value)) return null;
  const millions = unit.startsWith("b") ? value * 1000 : value;

  if (millions >= 50) return { band: "mature", why: `announces a $${value}${unit.startsWith("b") ? "B" : "M"} raise` };
  if (millions >= 8) return { band: "growth", why: `announces a $${value}M raise` };
  return { band: "emerging", why: `announces a $${value}M raise` };
}

export interface Placement {
  /** False when the company is publicly listed. */
  eligible: boolean;
  reason: string;
  band: Band;
  /** How the band was decided, shown on the page so the call is auditable. */
  bandEvidence: string;
  /** True when nothing structural was found and the band is a guess. */
  bandInferred: boolean;
}

/**
 * Read the band off the markup.
 *
 * Returns `null` for the band when there is genuinely no structural evidence,
 * rather than guessing — the caller decides what to do with that, and the page
 * says so, because a silently-guessed band that looks identical to a
 * well-evidenced one is worse than an admitted gap.
 */
export function placeFromMarkup(html: string, text: string): {
  isPublic: string | null;
  band: Band | null;
  evidence: string | null;
} {
  const haystack = `${text}\n${html}`.slice(0, 200_000);

  for (const [pattern, why] of PUBLIC_PATTERNS) {
    if (pattern.test(haystack)) return { isPublic: why, band: null, evidence: null };
  }

  // Highest band wins. A company that mentions both its seed round and its
  // Series C is a Series C company with a history page, and the ROUND_PATTERNS
  // order encodes that: the first match is the most advanced round.
  for (const [pattern, band, why] of ROUND_PATTERNS) {
    if (pattern.test(haystack)) return { isPublic: null, band, evidence: why };
  }

  // A named round beats an amount, so this runs only after the loop above: a
  // page saying "our $30M Series A" should band on the letter, not the cheque.
  const byAmount = bandFromAmount(haystack);
  if (byAmount) return { isPublic: null, band: byAmount.band, evidence: byAmount.why };

  return { isPublic: null, band: null, evidence: null };
}

/**
 * The model's stage read, used only where the markup was silent.
 *
 * Deliberately narrow: the model is asked which round the company most recently
 * raised, not how big or impressive it seems, because the second question is
 * the one it answers badly.
 */
const MODEL_BAND: Record<string, Band> = {
  "pre-seed": "emerging",
  seed: "emerging",
  "series-a": "growth",
  "series-b": "growth",
  "series-c": "mature",
  "series-d": "mature",
  later: "mature",
};

export interface PanelRecall {
  round: string;
  roundYear: number;
  roundVotes: number;
  evidence: string;
}

export function place(
  html: string,
  text: string,
  modelStage: string | null | undefined,
  /** The panel's majority recall, when two or more agreed. */
  recall?: PanelRecall | null,
): Placement {
  const found = placeFromMarkup(html, text);

  if (found.isPublic) {
    return {
      eligible: false,
      reason: `This is a public company — it ${found.isPublic}. The board is for startups, and a startup with a ticker symbol is just a company.`,
      band: "mature",
      bandEvidence: found.isPublic,
      bandInferred: false,
    };
  }

  if (found.band) {
    return {
      eligible: true,
      reason: "",
      band: found.band,
      bandEvidence: `The site ${found.evidence}.`,
      bandInferred: false,
    };
  }

  /**
   * Second tier: what two or more panelists independently recalled.
   *
   * This sits BELOW the markup and above any single model, which is the right
   * ordering for what it is. It is not an inference from tone — the ban on that
   * stands — it is recall of a publicly reported fact, corroborated across three
   * labs that could not see each other's answers. A single model asserting a
   * round is a guess; three generating independently and two landing on the same
   * round AND the same year is evidence.
   *
   * Not marked `inferred`, because it is not a guess. The page prints who
   * recalled it, so a reader can weigh the claim rather than take it.
   */
  if (recall?.round && recall.roundVotes >= 2) {
    const band = MODEL_BAND[recall.round];
    if (band) {
      return {
        eligible: true,
        reason: "",
        band,
        bandEvidence: recall.evidence,
        bandInferred: false,
      };
    }
  }

  const guessed = MODEL_BAND[String(modelStage ?? "").toLowerCase().replace(/\s+/g, "-")];
  if (guessed) {
    return {
      eligible: true,
      reason: "",
      band: guessed,
      bandEvidence: "No funding announcement on the site, and the panel could not agree on one. Band read from a single model's account of the company.",
      bandInferred: true,
    };
  }

  // Nothing found anywhere.
  //
  // This defaults to GROWTH, the middle band, and the choice matters. Emerging
  // exists to let a four-person seed team be compared against other four-person
  // seed teams; dropping every unclassifiable company in there would fill it
  // with exactly the incumbents it is meant to shield them from. Mature has the
  // mirror problem. The middle is where being wrong costs least in either
  // direction.
  return {
    eligible: true,
    reason: "",
    band: "growth",
    bandEvidence: "No funding signals found anywhere on the site. Placed in the middle band by default.",
    bandInferred: true,
  };
}

// ── Labels ──────────────────────────────────────────────────────────────────

/** "3rd in emerging sell-side" — the phrasing a row and a page both use. */
export const cohortLabel = (band: Band, side: Side) =>
  `${BAND_LABELS[band].toLowerCase()} ${SIDE_LABELS[side].toLowerCase()}`;

// ── The identification pass ─────────────────────────────────────────────────

/**
 * One cheap call before the panel, to work out WHAT this company is.
 *
 * Kept separate from the panel on purpose. The panelists are asked to judge,
 * and judging is a different job from identifying — folding both into one
 * prompt means a model that has just decided a company is unimpressive also
 * decides which category it belongs to, and category drives the cohort it is
 * ranked in. Splitting them keeps a bad opinion from moving a company into a
 * different table.
 *
 * It also fails cheap: an ineligible company is refused after one small call
 * rather than after three panel calls and a writer.
 */
export interface Identity {
  eligible: boolean;
  ineligibleReason: string;
  name: string;
  oneLiner: string;
  category: Category;
  /** The model's read of the most recent round. Advisory only — see place(). */
  stage: string;
}

/**
 * The category menu the IDENTIFIER sees, disambiguation included.
 *
 * The notes have to be here and not only in the panel prompt. Category is
 * resolved from the identifier's answer and the panel's recall together, so a
 * guard the identifier never sees is a guard that only works half the time —
 * which is how pubX, a publisher yield product, was still landing in
 * `agentic-buying` after the note was written for the panel alone.
 */
const CATEGORY_LINES = CATEGORIES.map((c) => {
  const note = CATEGORY_NOT[c.key];
  return `    ${c.key} — ${c.label}${note ? `\n        ${note}` : ""}`;
}).join("\n");

/** The side hints, grouped from the lookup rather than typed out beside it. */
const KEYS_BY_SIDE = (side: Side): string =>
  CATEGORIES.filter((c) => sideFor(c.key) === side && c.key !== "other")
    .map((c) => c.key)
    .join(", ");

export function buildIdentifyPrompt(domain: string, pages: string, thin: boolean): string {
  return `Identify a company from its website. You are not judging it — another
panel does that. Answer factually and briefly.

Return JSON only.

═══ ELIGIBILITY ═══
Set eligible=false if ANY of these hold, and give one dry, friendly sentence in
ineligibleReason saying which:
  - It is not ADTECH: the business of buying, selling, serving, measuring,
    verifying, targeting or monetising digital advertising. A company that
    merely BUYS ads is not adtech. A general analytics, CRM or sales tool is
    not adtech.
  - It is not a company with a product: agencies, consultancies, studios,
    portfolios, personal sites, open-source projects with no company behind them.

Note what is NOT a disqualifier: being large, being well funded, being old, or
not using AI. The board covers all private adtech startups.

═══ CLASSIFY ═══
category: EXACTLY ONE of these keys:
${CATEGORY_LINES}
  Decide by ONE question: WHO SIGNS THE CHEQUE?
    - Publishers, broadcasters, retailers with their own inventory → sell-side:
      ${KEYS_BY_SIDE("sell")}
    - Advertisers, agencies, or anyone spending a media budget → buy-side:
      ${KEYS_BY_SIDE("buy")}
    - Neither, because the product referees between them → neutral:
      ${KEYS_BY_SIDE("independent")}

  ⚠ Most adtech copy describes BOTH sides of the transaction, because every
  auction has two. "We optimise buying and selling" tells you nothing about
  which side is the customer. Ignore the description of the mechanism and ask
  who is being invoiced.

  Use "other" only when nothing genuinely fits.

stage: the company's MOST RECENT funding round, if the site states one. One of:
  pre-seed, seed, series-a, series-b, series-c, series-d, later, unknown
  ⚠ Report only what the site actually SAYS. Do not infer a round from how
  polished, large or established the company seems — marketing copy is written
  to sound established and inferring from it is wrong far more often than it is
  right. "unknown" is a perfectly good answer and the correct one by default.

name: the company's name.
oneLiner: what it does, under 90 characters, plain language, no marketing words.
${thin ? "\n⚠ The site barely rendered. Say unknown rather than guess.\n" : ""}
JSON shape:
{"eligible":bool,"ineligibleReason":str,"name":str,"oneLiner":str,
 "category":str,"stage":str}

DOMAIN: ${domain}

PAGES:
${pages.slice(0, 20_000)}`;
}

const text = (v: unknown, max: number): string => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
};

export function normalizeIdentity(raw: unknown): Identity {
  const o = (raw ?? {}) as Record<string, unknown>;
  const category = String(o.category ?? "").toLowerCase();
  return {
    eligible: o.eligible === true,
    ineligibleReason: text(o.ineligibleReason, 240),
    name: text(o.name, 80) || "This company",
    oneLiner: text(o.oneLiner, 120),
    category: (CATEGORIES.map((c) => c.key) as readonly string[]).includes(category)
      ? (category as Category)
      : "other",
    stage: String(o.stage ?? "unknown").toLowerCase().replace(/\s+/g, "-"),
  };
}

export function assertIdentityUsable(id: Identity): Identity {
  if (!id.eligible) {
    if (!id.ineligibleReason) throw new Error("refused without a reason");
    return id;
  }
  if (id.name === "This company") throw new Error("no company name");
  return id;
}
