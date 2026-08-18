/**
 * Rank My AdTech — reading the board at build time.
 *
 * The site is fully static. `@astrojs/cloudflare` dropped Pages support in v13,
 * so there is no adapter that gives an Astro 7 site on Pages a request-time
 * route, and the D1 *binding* only exists inside the Workers runtime anyway —
 * never during `astro build`, which is plain Node.
 *
 * So the build talks to D1 over its REST API instead, and freshness comes from
 * rebuilding: the ranking Function fires a Pages deploy hook after it writes.
 *
 * Build-time environment:
 *   CLOUDFLARE_D1_TOKEN     — REQUIRED. An API token with D1 read on this
 *                             account. Set it with
 *                             `wrangler pages secret put CLOUDFLARE_D1_TOKEN
 *                              --project-name andorlabs`. Pages keeps build and
 *                             runtime variables in one namespace, so a secret is
 *                             visible to `astro build` as well as to Functions.
 *   CLOUDFLARE_ACCOUNT_ID   — optional; defaults below.
 *   CLOUDFLARE_D1_DATABASE  — optional; defaults below.
 *
 * The account and database ids are defaults rather than required variables
 * because neither is a secret, and because adding a plain variable to a Pages
 * project means PATCHing the env_vars map — which returns existing secrets with
 * empty values and would blank them on the way back in. One required secret is
 * also simply less to get wrong.
 */

const DEFAULT_DATABASE_ID = "662a14cc-7ed7-47d0-9dbb-a0e10d95ff43";
const DEFAULT_ACCOUNT_ID = "63956fb1f50aec70801897b5de548e8d";

// ── The board's structure ───────────────────────────────────────────────────

export type Band = "emerging" | "growth" | "mature";
export type Side = "buy" | "sell" | "independent";

/**
 * Which axis the board is organised by. ONE LINE, deliberately.
 *
 * The original design made stage bands the tabs, with sides as sections inside
 * them. Then three independent measurements across 28 real adtech sites came
 * back:
 *
 *   funding round stated in crawlable markup    7%
 *   round recalled by 2+ panelists with a year  ~0%
 *   founding year stated anywhere on the site   14%
 *
 * Stage simply is not on these websites. Banding on that would have put ~90% of
 * the board in the middle band by default and left two of three tabs
 * permanently empty — a structure advertising a distinction the data cannot
 * support. Side, by contrast, is derived from a subcategory the panel agrees on
 * (3/3 on most companies), so all three tabs populate immediately.
 *
 * Band is not thrown away: it still classifies, and it still shows on a company
 * page as a badge WHEN there is evidence for it. Flip this constant back to
 * "band" the day a funding-data source is wired in, and the original structure
 * returns with nothing else to change.
 */
export const BOARD_AXIS: "side" | "band" = "side";

/**
 * Bands: kept as an evidenced attribute rather than the board's spine.
 *
 * See BOARD_AXIS. A band only appears on a page when something actually
 * established it — an announced round, an accelerator batch, a raise amount, or
 * two panelists independently recalling the same round and year.
 */
export const BANDS: { key: Band; label: string; icon: string; blurb: string }[] = [
  { key: "emerging", label: "Emerging", icon: "seedlings",
    blurb: "Pre-seed and seed. Ideas with a landing page and a lot of nerve." },
  { key: "growth", label: "Growth", icon: "trending",
    blurb: "Series A and B. Past the demo, not yet past the org chart." },
  { key: "mature", label: "Mature", icon: "bank",
    blurb: "Series C and beyond, still private. Big enough to have politics." },
];

export const SIDES: { key: Side; label: string; icon: string; blurb: string }[] = [
  { key: "sell", label: "Sell-side", icon: "newspaper",
    blurb: "They own or represent the inventory." },
  { key: "buy", label: "Buy-side", icon: "analytics",
    blurb: "They spend somebody's media budget." },
  // "Infrastructure", not "Independent" — on a board of private startups,
  // "independent" reads as a maturity band (indie/small/unfunded). All eight
  // members are neutral plumbing: verification, identity, clean rooms,
  // measurement. The key stays `independent`; it is in every published URL row.
  { key: "independent", label: "Infrastructure", icon: "handshake",
    blurb: "They sell nobody's inventory and spend nobody's budget." },
];

/**
 * The board's tabs, whichever axis is in force.
 *
 * Both shapes carry the same four fields so the leaderboard renders one way
 * regardless — which is the whole point of BOARD_AXIS being a single constant.
 */
export interface Cohort {
  key: string;
  label: string;
  icon: string;
  blurb: string;
}

export const COHORTS: Cohort[] = BOARD_AXIS === "side" ? SIDES : BANDS;

/** Which tab an entry belongs in. */
export const cohortKeyOf = (entry: Entry): string =>
  BOARD_AXIS === "side" ? entry.side : entry.band;

export const BAND_LABELS: Record<string, string> =
  Object.fromEntries(BANDS.map((b) => [b.key, b.label]));
export const SIDE_LABELS: Record<string, string> =
  Object.fromEntries(SIDES.map((s) => [s.key, s.label]));

/**
 * The five dimensions, mirrored from functions/_lib/grader.ts.
 *
 * Duplicated rather than imported for the same reason the Loops list ids are:
 * Pages Functions bundle separately from the Astro build, and a cross-boundary
 * import is a thing to discover at deploy time. Change one, change the other.
 */
export const DIMENSIONS = [
  { key: "originality",   label: "Originality",   icon: "lightbulb",
    question: "Was this first, or only?" },
  { key: "defensibility", label: "Defensibility", icon: "laptop-code",
    question: "What is the single hardest thing here to replicate?" },
  { key: "traction",      label: "Traction",      icon: "handshake",
    question: "What proof is there that anyone uses this?" },
  { key: "execution",     label: "Execution",     icon: "bolt",
    question: "Does this look built by people who ship?" },
  { key: "durability",    label: "Durability",    icon: "bank",
    question: "Does this still matter in three years?" },
] as const;

export type DimensionKey = (typeof DIMENSIONS)[number]["key"];
export const DIMENSION_KEYS = DIMENSIONS.map((d) => d.key);

/**
 * The grader, mirrored from functions/_lib/grader.ts.
 *
 * Declared upfront on the page — who is grading, and what it is — because a
 * score from an unnamed "AI" is an appeal to authority with no authority
 * behind it. That argument got stronger when the panel became one model, not
 * weaker: there is no longer a spread of opinions to hide a single model's
 * limits inside.
 */
export const GRADER = {
  id: "nemotron-ultra",
  name: "Nemotron 3 Ultra",
  lab: "NVIDIA",
  model: "nvidia/nemotron-3-ultra-550b-a55b",
  spec: "Mixture-of-experts, 550B total parameters with roughly 55B active per token — both numbers are published in the model's own name. Trained by the company that makes the accelerators everyone else rents, and served on NVIDIA's own inference.",
} as const;

/**
 * A row graded by a model that is no longer the pinned grader.
 *
 * The grader is pinned with no fallback, so in normal operation this is always
 * false and the check costs nothing. It exists for the day the pin moves: at
 * that moment every existing row was graded by a different instrument, and a
 * board that cannot say which rows those are is a board quietly comparing
 * incomparable numbers. `ranking.model_used` is stored per row precisely so
 * this question stays answerable.
 */
export const isStaleGrade = (modelUsed: string): boolean =>
  Boolean(modelUsed) && modelUsed !== GRADER.model;

export const graderLoadingMessages = (): string[] => [
  `Handing the pages to ${GRADER.name}…`,
  "Writing the case against them first…",
  "Scoring five dimensions against fixed anchors…",
  "Working out what the grade turns on…",
];

export const CATEGORY_LABELS: Record<string, string> = {
  "publisher-monetization": "Publisher Monetization",
  ssp: "Supply-Side Platforms",
  "header-bidding": "Header Bidding",
  "ad-server": "Ad Serving",
  paywall: "Paywall & Subscriptions",
  "adblock-recovery": "Adblock Revenue Recovery",
  // Buy-side. Mirrored from functions/_lib/classify.ts — change one, change
  // the other, same as QUESTIONS and PANELISTS above. A key missing here does
  // not throw; it renders as "Other", which is the quiet kind of wrong.
  dsp: "DSP & Media Buying",
  curation: "Curation & Marketplaces",
  creative: "Creative & DCO",
  mmp: "Mobile Measurement (MMP)",
  "retail-media-buying": "Retail Media Buying Tools",
  "search-social": "Search & Social Management",
  "planning-workflow": "Media Planning & Workflow",
  "agentic-buying": "Agentic Buying & Ad Protocols",
  identity: "Identity & Alt ID",
  "clean-rooms": "Data & Clean Rooms",
  contextual: "Contextual & Semantic",
  "fraud-quality": "Fraud & Traffic Quality",
  "consent-privacy": "Consent & Privacy",
  measurement: "Measurement & Attribution",
  "retail-media": "Retail & Commerce Media",
  "ctv-audio": "CTV & Audio",
  "adops-agentic": "Ad Ops & Agentic Tooling",
  other: "Other",
};
export const categoryLabel = (key: string | null) => CATEGORY_LABELS[key ?? ""] ?? "Other";

// ── Shapes ──────────────────────────────────────────────────────────────────

export interface DimensionScore {
  score: number;
  /** What on the pages produced this band. One line. */
  reason: string;
}

export interface Entry {
  slug: string;
  name: string;
  domain: string;
  logo_url: string | null;
  one_liner: string | null;
  provisional: number;

  /** Subcategory — one of the 22 closed keys. */
  category: string | null;
  /** Size class. */
  band: Band;
  /** Category, in the board's three-level taxonomy. */
  side: Side;
  band_evidence: string | null;
  band_inferred: number;

  /** The mean of the five, 1-5, to one decimal. */
  grade: number;
  originality: number;
  defensibility: number;
  traction: number;
  execution: number;
  durability: number;

  /** Per-dimension reasons, keyed by dimension. */
  reasons_json: string;
  /** Three reasons the company is weaker than it looks, written before scoring. */
  case_against_json: string;

  summary: string;
  stack_json: string;
  model_used: string;
  created_at: string;
}

export const scoresFor = (entry: Entry): Record<DimensionKey, number> => ({
  originality: entry.originality,
  defensibility: entry.defensibility,
  traction: entry.traction,
  execution: entry.execution,
  durability: entry.durability,
});

export function reasonsFor(entry: Entry): Record<string, string> {
  try {
    return JSON.parse(entry.reasons_json || "{}");
  } catch {
    return {};
  }
}

export function caseAgainstFor(entry: Entry): string[] {
  try {
    const parsed = JSON.parse(entry.case_against_json || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export type Letter = "A" | "B" | "C" | "D" | "E";

/**
 * Letter bands sit ON TOP of the mean and never replace it.
 *
 * Mirrored from grader.ts, boundaries included: 3.5 is a B, not a C. That edge
 * is reachable (4,4,4,3,3 averages exactly 3.5), so an off-by-one here would
 * misgrade real rows rather than a theoretical one.
 */
export function letterFor(grade: number): Letter {
  if (grade >= 4.5) return "A";
  if (grade >= 3.5) return "B";
  if (grade >= 2.5) return "C";
  if (grade >= 1.5) return "D";
  return "E";
}

/**
 * The two ranks a company carries.
 *
 * Both are positions within a filtered, sorted list rather than stored numbers,
 * because a stored rank is wrong the moment the next company is ranked. Cheap
 * to compute at build time over a board this size, and always correct.
 */
export interface Ranks {
  cohortRank: number;
  cohortSize: number;
  cohortLabel: string;
  categoryRank: number;
  categorySize: number;
  categoryLabel: string;
}

/**
 * Score bands drive the icon on each row.
 *
 * Thresholds are on the 1-5 grade and line up exactly with the letter bands, so
 * the icon and the letter can never disagree — they are two renderings of one
 * decision. `hockey-mask` at the bottom is the tonal load-bearer: a low grade
 * has to read as a judgement the company can argue with rather than a sneer.
 */
export function scoreBand(grade: number): { icon: string; label: string; solid: boolean } {
  if (grade >= 4.5) return { icon: "fire-solid", label: "Exceptional", solid: true };
  if (grade >= 3.5) return { icon: "star", label: "Genuinely interesting", solid: false };
  if (grade >= 2.5) return { icon: "face-thinking", label: "Competent", solid: false };
  if (grade >= 1.5) return { icon: "face-thinking", label: "Thin", solid: false };
  return { icon: "hockey-mask", label: "Brutal", solid: false };
}

// ── D1 over REST ────────────────────────────────────────────────────────────

const env = (key: string): string | undefined =>
  (typeof process !== "undefined" ? process.env?.[key] : undefined) ?? undefined;

/**
 * Query D1.
 *
 * Returns [] rather than throwing when the credentials are absent. A
 * misconfigured build environment should cost the leaderboard, not the whole
 * site — every other page here is unrelated to this tool and must still ship.
 */
async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const account = env("CLOUDFLARE_ACCOUNT_ID") ?? DEFAULT_ACCOUNT_ID;
  const token = env("CLOUDFLARE_D1_TOKEN");
  const database = env("CLOUDFLARE_D1_DATABASE") ?? DEFAULT_DATABASE_ID;

  if (!token) {
    console.warn("[rankings] CLOUDFLARE_D1_TOKEN unset — building an empty leaderboard.");
    return [];
  }

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ sql, params }),
      },
    );
    if (!res.ok) {
      console.warn(`[rankings] D1 REST returned ${res.status} — building an empty leaderboard.`);
      return [];
    }
    const body = (await res.json()) as { result?: { results?: T[] }[] };
    return body.result?.[0]?.results ?? [];
  } catch (err) {
    console.warn("[rankings] D1 REST unreachable — building an empty leaderboard.", err);
    return [];
  }
}

const ENTRY_SELECT = `
  SELECT c.slug, c.name, c.domain, c.logo_url, c.one_liner, c.provisional,
         c.category, c.band, c.side, c.band_evidence, c.band_inferred,
         r.grade, r.originality, r.defensibility, r.traction, r.execution,
         r.durability, r.reasons_json, r.case_against_json, r.summary,
         r.stack_json, r.model_used, r.created_at
  FROM company c
  JOIN ranking r ON r.company_id = c.id
  WHERE c.status = 'published'`;

let cache: Entry[] | null = null;

/**
 * Every published entry, best first.
 *
 * ONE query now. The panel needed two — ranking rows, then three takes per row,
 * stitched in memory — because a join would have repeated every company row
 * three times. With the grade and its five dimensions all on the ranking row,
 * there is nothing left to stitch. Still memoised: `getStaticPaths` and each
 * page body would otherwise re-fetch the whole board over the network for every
 * company on it.
 */
export async function getEntries(): Promise<Entry[]> {
  if (cache) return cache;

  /**
   * Tie-break, in order: defensibility, traction, originality, then name.
   *
   * Ties are rarer than they were but not rare. Five integers in 1-5 average
   * onto 21 values in 0.2 steps — far better than the old lattice, where nine
   * integers averaged three ways collapsed 6/6/6, 6/8/4 and 8/4/6 all onto 18
   * and put three of seven companies on 17.3 — but two companies sharing 3.4 is
   * entirely ordinary.
   *
   * Alphabetical alone was the worst available answer: arbitrary, but it LOOKS
   * ordered, so a reader infers a judgement that was never made. These keys are
   * defensible instead, and the order encodes what the board is FOR: at the same
   * grade, the company that is harder to replicate ranks above the one with more
   * logos, and both rank above the one whose only edge is being first.
   */
  const rows = await query<Entry>(
    `${ENTRY_SELECT}
     ORDER BY r.grade DESC, r.defensibility DESC, r.traction DESC,
              r.originality DESC, c.name ASC`,
  );

  cache = rows;
  return cache;
}

export function ranksFor(entry: Entry, all: Entry[]): Ranks {
  const key = cohortKeyOf(entry);
  const cohort = all.filter((e) => cohortKeyOf(e) === key);
  const category = all.filter((e) => e.category === entry.category);
  return {
    cohortRank: cohort.findIndex((e) => e.slug === entry.slug) + 1,
    cohortSize: cohort.length,
    cohortLabel: COHORTS.find((c) => c.key === key)?.label ?? key,
    categoryRank: category.findIndex((e) => e.slug === entry.slug) + 1,
    categorySize: category.length,
    categoryLabel: categoryLabel(entry.category),
  };
}

/**
 * A company's stage band, or null when nothing established one.
 *
 * Returns null for an inferred band on purpose. An inferred band is the
 * middle-band default wearing a label, and printing it next to a genuinely
 * evidenced one would make the page claim knowledge it does not have. Absent is
 * the honest rendering of absent.
 */
export const bandBadgeFor = (entry: Entry): { label: string; evidence: string } | null =>
  entry.band_inferred || !entry.band
    ? null
    : { label: BAND_LABELS[entry.band] ?? entry.band, evidence: entry.band_evidence ?? "" };

/** "3rd", "1st", "22nd" — ranks read as ordinals or they read as scores. */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

/** The GTM stack we detected, as category -> tool names. */
export function stackFor(entry: Entry): Record<string, string[]> {
  try {
    return JSON.parse(entry.stack_json || "{}");
  } catch {
    return {};
  }
}

/** A number like 7 renders as "7", 7.3 as "7.3". Never "7.0". */
export const fmt = (n: number): string =>
  Number.isInteger(n) ? String(n) : n.toFixed(1);

