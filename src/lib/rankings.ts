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

export type Division = "lightweight" | "middleweight" | "heavyweight";

/** Mirrored from functions/_lib/facts.ts. Change one, change the other. */
export const DIVISIONS: { key: Division; label: string; blurb: string }[] = [
  { key: "lightweight", label: "Lightweight", blurb: "Up to 50 people." },
  { key: "middleweight", label: "Middleweight", blurb: "51 to 500 people." },
  { key: "heavyweight", label: "Heavyweight", blurb: "More than 500 people." },
];

export const DIVISION_LABELS: Record<string, string> =
  Object.fromEntries(DIVISIONS.map((d) => [d.key, d.label]));

/** Years since founding, or 0 when unknown. The board's second filter axis. */
export function ageOf(foundedYear: number | null, now = new Date().getUTCFullYear()): number {
  if (!foundedYear || foundedYear < 1800 || foundedYear > now) return 0;
  return now - foundedYear;
}

export const BAND_LABELS: Record<string, string> =
  Object.fromEntries(BANDS.map((b) => [b.key, b.label]));
export const SIDE_LABELS: Record<string, string> =
  Object.fromEntries(SIDES.map((s) => [s.key, s.label]));

/**
 * The three questions, mirrored from functions/_lib/panel.ts.
 *
 * Duplicated rather than imported for the same reason the Loops list ids are:
 * Pages Functions bundle separately from the Astro build, and a cross-boundary
 * import is a thing to discover at deploy time. Change one, change the other.
 */
export const QUESTIONS = [
  { key: "innovation", label: "Innovation", icon: "lightbulb",
    question: "How innovative is this, really?" },
  { key: "difficulty", label: "Hard to build", icon: "laptop-code",
    question: "What is the single hardest thing here to replicate?" },
  { key: "outlook", label: "Future outlook", icon: "bank",
    question: "Where does this sit in three years?" },
] as const;

export type QuestionKey = (typeof QUESTIONS)[number]["key"];

/**
 * The panel, mirrored from functions/_lib/panel.ts.
 *
 * Declared upfront on the page — who is judging, and what they are — because a
 * score from an unnamed "AI" is an appeal to authority with no authority behind
 * it. Specs are published facts only; where a lab discloses nothing, this says
 * so rather than inventing a parameter count.
 *
 * Each seat is a CHARACTER holding one fixed lens across all three questions.
 * The character is not decoration: it is what stops a juror answering the
 * outlook question as a generic analyst and the engineering question as a
 * generic engineer, which is what the old per-question personas produced.
 */
export const PANELISTS = [
  { id: "nemotron", name: "Nemotron 3 Ultra", lab: "NVIDIA",
    model: "nvidia/nemotron-3-ultra-550b-a55b",
    character: "Nemo", title: "Staff Engineer, Seat 1",
    lens: "I judge by what breaks at 3am and who gets paged.",
    bio: "Nine years on the exchange side, most of it in the part of the stack nobody demos. Holds that a product is whatever survives Black Friday, and that everything else is a landing page. Reads the careers page before the homepage.",
    spec: "Mixture-of-experts, 550B total parameters with roughly 55B active per token — both numbers are published in the model's own name. Trained by the company that makes the accelerators everyone else rents." },
  { id: "glm", name: "GLM 5.3", lab: "Zhipu AI",
    model: "glm-5.3",
    character: "Atlas", title: "Partner, Seat 2",
    lens: "I judge by what this looks like at 10x revenue and whether anyone is left to buy it.",
    bio: "Partner at a fund you have heard of and cannot quite name. Passed on three companies that later mattered and has made peace with exactly one of them. Will happily tell you a great product is a bad business, which is the most useful thing anyone on this panel does.",
    spec: "Open weights with a published architecture, though the exact size of this tier is undisclosed. Built by a lab that spun out of Tsinghua and ships more than it announces." },
  { id: "gemini", name: "Gemini 3.5 Flash Lite", lab: "Google DeepMind",
    model: "gemini-3.5-flash-lite",
    character: "Juno", title: "Operator-in-Residence, Seat 3",
    lens: "I judge by whether this survives the renewal conversation eighteen months in.",
    bio: "Three exits, two of which are not up for discussion. Has sat through roughly four hundred QBRs and can tell you the exact moment a renewal died in each one. Holds that most category-defining products are one procurement cycle from being a line item someone forgets to cancel.",
    spec: "The smaller of Google's fast tiers. Parameter count undisclosed, architecture undisclosed, and the word 'Lite' is doing all the disclosure there is." },
] as const;

export const WRITER = {
  name: "GPT-5.6 Luna", lab: "OpenAI", model: "gpt-5.6-luna",
  character: "Vega", title: "Clerk of the Panel",
  bio: "Does not score. Records. Has one job: report what the three judges actually said, including — especially — where they disagreed.",
  mandate: "Never averages. When the panel splits, the split is the finding.",
  spec: "Parameter count undisclosed. Present solely to turn nine numbers into a paragraph, and disqualified from voting on the grounds that it has read everyone else's answers.",
};

/**
 * Who actually answered, keyed by the model id recorded on the take.
 *
 * Seats are now PINNED — one model each, no fallback, and a seat that cannot
 * answer fails the whole ranking rather than letting another lab sit in it.
 * So for anything ranked since the pin, `model_used` always equals the seat's
 * declared model and this table is a formality.
 *
 * It is kept, and kept complete, for rows ranked BEFORE the pin. The old open
 * ladder let GLM and Qwen answer in DeepSeek's seat on five of the first
 * twenty-three companies. Those rows are still in the database, and rendering
 * a character's bio above words that character's model never wrote is exactly
 * the lie the pin exists to prevent. Identity is resolved from the model that
 * ANSWERED: the seat is an intention, the model id is the fact.
 */
export const MODEL_IDENTITY: Record<string, { name: string; lab: string; spec: string }> = {
  "nvidia/nemotron-3-ultra-550b-a55b": {
    name: "Nemotron 3 Ultra", lab: "NVIDIA",
    spec: "Mixture-of-experts, 550B total parameters with roughly 55B active per token — both numbers are published in the model's own name. Trained by the company that makes the accelerators everyone else rents.",
  },
  "nvidia/nemotron-3-super-120b-a12b": {
    name: "Nemotron 3 Super", lab: "NVIDIA",
    spec: "Mixture-of-experts, 120B total parameters with roughly 12B active per token — the sparsity is published in the model's own name. Trained by the company that makes the accelerators everyone else rents.",
  },
  "nvidia/llama-3.3-nemotron-super-49b-v1.5": {
    name: "Nemotron Super 49B", lab: "NVIDIA",
    spec: "49B dense, derived from Llama 3.3 70B by neural architecture search — NVIDIA published both the pruning method and the result. Smaller than its sibling and noticeably quicker to commit.",
  },
  "deepseek-v4-pro": {
    name: "DeepSeek V4 Pro", lab: "DeepSeek",
    spec: "Mixture-of-experts with open weights and a published architecture, though the exact parameter count for this tier is undisclosed. Reasons at length before committing, which is either rigour or stalling depending on how the answer turns out.",
  },
  "qwen3.8-max": {
    name: "Qwen 3.8 Max", lab: "Alibaba",
    spec: "The closed top tier of the Qwen line; parameter count undisclosed. Alibaba open-weights most of this family and then declines to say anything about the biggest one.",
  },
  "glm-5.3": {
    name: "GLM 5.3", lab: "Zhipu AI",
    spec: "Open weights with a published architecture; the tier's exact size is undisclosed. Built by a lab that spun out of Tsinghua and ships more than it announces.",
  },
  "gemini-3.5-flash": {
    name: "Gemini 3.5 Flash", lab: "Google DeepMind",
    spec: "Parameter count undisclosed, architecture undisclosed. Google will tell you it is fast and will not tell you why.",
  },
  "gemini-3.5-flash-lite": {
    name: "Gemini 3.5 Flash Lite", lab: "Google DeepMind",
    spec: "The smaller Flash tier. Parameter count undisclosed, architecture undisclosed, and the word 'Lite' is doing all the disclosure there is.",
  },
  "gpt-5.6-luna": {
    name: "GPT-5.6 Luna", lab: "OpenAI",
    spec: "Parameter count undisclosed. Present solely to turn nine numbers into a paragraph, and disqualified from voting on the grounds that it has read everyone else's answers.",
  },
};

/**
 * Identity of whoever filled a seat — and whether the character may be shown.
 *
 * The character is the load-bearing part. A juror is a person now, and a person
 * cannot be swapped for a model from another lab and still be that person. So
 * `character` is returned ONLY when the recorded model is the seat's pinned
 * model. Where it is not — a row ranked before the pin — the answer is
 * attributed to the model that actually produced it, with no character and no
 * bio, and `stale` set so the page can say why.
 *
 * That asymmetry is deliberate. Attributing Qwen's words to Nemo Vasquez would
 * be a fabricated byline, which is a worse failure than an unglamorous row.
 */
export function identityFor(modelUsed: string, panelistId: string, rankingStale = false) {
  const seat = PANELISTS.find((p) => p.id === panelistId);
  const known = MODEL_IDENTITY[modelUsed];
  const pinned = !!seat && seat.model === modelUsed && !rankingStale;

  if (pinned && seat) {
    return {
      name: seat.name, lab: seat.lab, spec: seat.spec,
      character: seat.character, title: seat.title, bio: seat.bio, lens: seat.lens,
      stale: false,
    };
  }

  return {
    name: known?.name ?? seat?.name ?? modelUsed,
    lab: known?.lab ?? "",
    spec: known?.spec ?? "",
    character: null, title: "", bio: "", lens: "",
    stale: true,
  };
}

/**
 * True when a take predates the current pinned panel.
 *
 * Not "a substitute was seated" — that can no longer happen. This flags a row
 * whose scores came from a jury the board no longer uses, which is a staleness
 * problem rather than a disclosure one. Re-rank it; do not annotate it.
 */
export const isStaleTake = (modelUsed: string, panelistId: string): boolean =>
  !PANELISTS.some((p) => p.id === panelistId && p.model === modelUsed);

/**
 * Staleness belongs to the RANKING, not to the seat.
 *
 * A seat-by-seat check gets this wrong whenever a panel change leaves one seat
 * untouched. It did: the Gemini seat kept `gemini-3.5-flash-lite` across the
 * change, so on a row scored by the OLD jury two takes correctly rendered as
 * bare models and the third rendered as "Gemma Larkspur" — one page, three
 * jurors, two naming systems, and a character's byline over words written
 * while she did not exist.
 *
 * A ranking is a single event. Either the panel that produced it is the panel
 * the board now runs, or it is not, and every take on it inherits that answer.
 */
export const rankingIsStale = (takes: Take[]): boolean =>
  takes.some((t) => isStaleTake(t.model_used, t.panelist_id));

export const panelistName = (id: string) =>
  PANELISTS.find((p) => p.id === id)?.name ?? id;

/**
 * The panel's labs as prose: "NVIDIA, Alibaba and Google DeepMind".
 *
 * Exists because the roster was previously written out by hand in three
 * places, and a seat change left the landing page, the loading messages and
 * llms.txt each naming a different set — one of them a lab that had not been
 * on the panel for a full deploy. Any sentence naming the labs calls this.
 */
export function panelLabs(): string {
  const labs = PANELISTS.map((p) => p.lab);
  return labs.length > 1
    ? `${labs.slice(0, -1).join(", ")} and ${labs[labs.length - 1]}`
    : (labs[0] ?? "");
}

/** "Nemo is reading…" — one per seat, in panel order. */
export const panelLoadingMessages = (): string[] =>
  PANELISTS.map((p) => `${p.character} is reading…`);

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

export interface Rating {
  /** The word the juror chose — what the page shows. */
  verdict: string;
  /** Its position on the 0-10 scale — what the arithmetic uses. */
  score: number;
  summary: string;
}

export interface Take {
  panelist_id: string;
  model_used: string;
  innovation: number;
  difficulty: number;
  outlook: number;
  ratings: Record<QuestionKey, Rating>;
  adjective: string;
}

export interface Entry {
  slug: string;
  name: string;
  domain: string;
  logo_url: string | null;
  one_liner: string | null;
  provisional: number;

  category: string | null;
  band: Band;
  side: Side;
  band_evidence: string | null;
  band_inferred: number;

  /**
   * The board's two filter axes, both from third-party search rather than from
   * the company's own pages.
   *
   * Null when the lookup established nothing — the page shows a weight class or
   * an age only when there is one, instead of defaulting to the middle and
   * quietly asserting it. That default is what the funding-derived band did, and
   * it classified every company identically.
   */
  founded_year: number | null;
  division: Division | null;
  /** Headcount band as reported, kept beside the class it produced. */
  headcount: string | null;
  /** Everything else the search returned. See factsFor(). */
  facts_json: string | null;

  /** Sum of the three means, 0-30, to one decimal. */
  total: number;
  innovation: number;
  difficulty: number;
  outlook: number;

  split_question: string | null;
  split_spread: number;

  summary: string;
  created_at: string;

  /** Three rows, nine ratings. Attached by getEntries. */
  takes: Take[];
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
 * Thresholds are out of 30, not 100. `hockey-mask` at the bottom is the tonal
 * load-bearer: the tool is a bit, and a low score has to read as a joke the
 * company is in on rather than a verdict delivered straight.
 */
export function scoreBand(total: number): { icon: string; label: string; solid: boolean } {
  if (total >= 24) return { icon: "fire-solid", label: "On fire", solid: true };
  if (total >= 19) return { icon: "star", label: "Genuinely interesting", solid: false };
  if (total >= 12) return { icon: "face-thinking", label: "The panel is thinking", solid: false };
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

interface EntryRow extends Omit<Entry, "takes"> {
  ranking_id: number;
}

interface TakeRow {
  ranking_id: number;
  panelist_id: string;
  model_used: string;
  innovation: number;
  difficulty: number;
  outlook: number;
  ratings_json: string;
  adjective: string;
}

const ENTRY_SELECT = `
  SELECT c.slug, c.name, c.domain, c.logo_url, c.one_liner, c.provisional,
         c.category, c.band, c.side, c.band_evidence, c.band_inferred,
         c.founded_year, c.division, c.headcount, c.facts_json,
         r.id AS ranking_id, r.total, r.innovation, r.difficulty, r.outlook,
         r.split_question, r.split_spread, r.summary, r.created_at
  FROM company c
  JOIN ranking r ON r.company_id = c.id
  WHERE c.status = 'published'`;

let cache: Entry[] | null = null;

/**
 * Every published entry, best first, with its panel attached.
 *
 * Two queries rather than a join, then stitched in memory. A join would repeat
 * every company row three times and the stitching would happen anyway; this way
 * the ranking rows arrive once and the takes are attached to them. Memoised
 * because `getStaticPaths` and each page body would otherwise re-fetch the whole
 * board over the network for every company on it.
 */
export async function getEntries(): Promise<Entry[]> {
  if (cache) return cache;

  /**
   * Tie-break, in order: innovation, difficulty, agreement, then name.
   *
   * Ties are commoner than the decimals suggest. Nine integers averaged three
   * ways can only land on thirds, so totals collapse onto a coarse lattice —
   * 6/6/6, 6/8/4 and 8/4/6 all total 18 — and at seven companies the board
   * already had three rows on 17.3.
   *
   * Alphabetical alone was the worst available answer: arbitrary, but it LOOKS
   * ordered, so a reader infers a judgement that was never made. These keys are
   * all defensible instead. Innovation leads because it is the question the
   * tool leads with; `split_spread ASC` puts a company the panel agreed on
   * above one it argued over at the same score, which is the honest reading of
   * two identical numbers with different confidence behind them.
   */
  const rows = await query<EntryRow>(
    `${ENTRY_SELECT}
     ORDER BY r.total DESC, r.innovation DESC, r.difficulty DESC,
              r.split_spread ASC, c.name ASC`,
  );
  if (!rows.length) {
    cache = [];
    return cache;
  }

  const takes = await query<TakeRow>(
    `SELECT ranking_id, panelist_id, model_used, innovation, difficulty, outlook,
            ratings_json, adjective
     FROM panel_take WHERE ranking_id IN (${rows.map(() => "?").join(",")})`,
    rows.map((r) => r.ranking_id),
  );

  const byRanking = new Map<number, Take[]>();
  for (const t of takes) {
    let ratings: Record<QuestionKey, Rating>;
    try {
      ratings = JSON.parse(t.ratings_json || "{}");
    } catch {
      ratings = {} as Record<QuestionKey, Rating>;
    }
    const list = byRanking.get(t.ranking_id) ?? [];
    list.push({ ...t, ratings });
    byRanking.set(t.ranking_id, list);
  }

  cache = rows.map(({ ranking_id, ...entry }) => ({
    ...entry,
    // Ordered by the declared panel so every page reads the same way, rather
    // than by whatever order the database handed the rows back.
    takes: (byRanking.get(ranking_id) ?? []).sort(
      (a, b) =>
        PANELISTS.findIndex((p) => p.id === a.panelist_id) -
        PANELISTS.findIndex((p) => p.id === b.panelist_id),
    ),
  }));
  return cache;
}

/** The board as the page renders it: one ranked list per tab. */
export async function getBoard(): Promise<Record<string, Entry[]>> {
  const all = await getEntries();
  const board: Record<string, Entry[]> = {};
  for (const cohort of COHORTS) {
    board[cohort.key] = all.filter((e) => cohortKeyOf(e) === cohort.key);
  }
  return board;
}

/** Both of a company's ranks, computed against the full board. */
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

/**
 * One adjective per panelist, in panel order, with repeats collapsed.
 *
 * This is a row's real payload. A score says how a company did; three words
 * from three different labs say how much they agreed about it — and a row
 * reading "assured / derivative / promising" tells you more at a glance than
 * any single number can.
 *
 * The collapsing matters more than it looks. Two panelists independently
 * reaching for the same word is the strongest signal a row can carry, but
 * rendered literally it reads "credible credible reskinned", which a reader
 * parses as a duplication bug rather than as agreement. Counting it — "credible
 * ×2" — turns the same fact into the thing it actually is.
 */
export function adjectivesFor(entry: Entry): { word: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const t of entry.takes) {
    if (t.adjective) counts.set(t.adjective, (counts.get(t.adjective) ?? 0) + 1);
  }
  // Insertion order is panel order, so the roster still reads left to right.
  return [...counts].map(([word, count]) => ({ word, count }));
}

/** Scores for one question across the panel, for the per-question breakdown. */
export const scoresFor = (entry: Entry, key: QuestionKey): number[] =>
  entry.takes.map((t) => t[key]);

/** A number like 7 renders as "7", 7.3 as "7.3". Never "7.0". */
export const fmt = (n: number): string =>
  Number.isInteger(n) ? String(n) : n.toFixed(1);

/** One looked-up fact, with the confidence and sources behind it. */
export interface CompanyFacts {
  whatTheyDo?: string;
  serves?: string[];
  hqCity?: string;
  hqCountry?: string;
  totalFundingUsd?: number;
  lastFunding?: string;
  acquiredBy?: string;
  isPubliclyTraded?: boolean;
  confidence?: Record<string, "low" | "medium" | "high">;
  sources?: Record<string, string[]>;
}

/**
 * The looked-up profile, defended.
 *
 * `JSON.parse` succeeding does not make the result the shape this returns, and a
 * single malformed row must not take the static build down with it — every
 * failure degrades to an empty object and the page simply shows less.
 */
export function factsFor(entry: Entry): CompanyFacts {
  if (!entry.facts_json) return {};
  try {
    const parsed = JSON.parse(entry.facts_json);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as CompanyFacts;
  } catch {
    return {};
  }
}
