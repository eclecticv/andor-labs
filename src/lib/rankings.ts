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
 * See docs/superpowers/specs/2026-08-13-rank-my-adtech-design.md §9.
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

export type Division = "featherweight" | "middleweight" | "heavyweight";

export const DIVISIONS: { key: Division; label: string; icon: string; blurb: string }[] = [
  {
    key: "featherweight",
    label: "Featherweight",
    icon: "seedlings",
    blurb: "Pre-seed and seed. Under about twenty people.",
  },
  {
    key: "middleweight",
    label: "Middleweight",
    icon: "trending",
    blurb: "Series A through C. Visibly scaling.",
  },
  {
    key: "heavyweight",
    label: "Heavyweight",
    icon: "bank",
    blurb: "Public, PE-owned, or plainly operating at scale.",
  },
];

/**
 * The four dimensions, mirrored from functions/_lib/score.ts.
 *
 * Duplicated rather than imported for the same reason the Loops list ids are:
 * Pages Functions bundle separately from the Astro build, and a cross-boundary
 * import is a thing to discover at deploy time. Change one, change the other.
 */
export const AXES = [
  { key: "positioning", label: "Positioning", max: 25, icon: "shapes",
    question: "Can a stranger tell who this is for, and what it replaces?" },
  { key: "content", label: "Content strategy", max: 25, icon: "newspaper",
    question: "Is anything here written for a buyer rather than a crawler?" },
  { key: "gtm_stack", label: "GTM stack maturity", max: 25, icon: "laptop-code",
    question: "Could they tell you what is working, or is it a contact form?" },
  { key: "innovation", label: "Innovation", max: 25, icon: "lightbulb",
    question: "AI-native, or a wrapper with a badge?" },
] as const;

export const CATEGORY_LABELS: Record<string, string> = {
  "publisher-monetization": "Publisher Monetization",
  ssp: "Supply-Side Platforms",
  "header-bidding": "Header Bidding",
  "ad-server": "Ad Serving",
  paywall: "Paywall & Subscriptions",
  "adblock-recovery": "Adblock Revenue Recovery",
  dsp: "DSP & Media Buying",
  curation: "Curation & Marketplaces",
  creative: "Creative & DCO",
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

export const STAGE_LABELS: Record<string, string> = {
  "pre-seed": "Pre-seed", seed: "Seed", "series-a": "Series A", unknown: "Stage unknown",
};

export interface JurorTake {
  provider: string;
  model_id: string;
  lens: string;
  /** Several sentences of argument — the substance of the panel section. */
  reasoning: string | null;
  quote: string | null;
  /** One word for this juror's temperature, shown on leaderboard rows. */
  keyword: string | null;
  abstained: number;
}

export interface Entry {
  slug: string;
  name: string;
  domain: string;
  logo_url: string | null;
  one_liner: string | null;
  founded_year: number | null;
  division: Division;
  provisional: number;
  category: string | null;
  stage: string | null;
  total: number;
  positioning: number;
  content: number;
  gtm_stack: number;
  innovation: number;
  /** Per-dimension reasoning and the improvement line, as stored JSON. */
  detail_json: string;
  /** What the stack detector saw: category -> tool names. */
  stack_json: string;
  verdict: string;
  created_at: string;
}

/**
 * Score bands drive the icon on each row.
 *
 * `hockey-mask` for the bottom band is the tonal load-bearer: the tool is a bit,
 * and a sub-40 score has to read as a joke the company is in on rather than a
 * verdict delivered straight.
 */
export function scoreBand(total: number): { icon: string; label: string; solid: boolean } {
  if (total >= 85) return { icon: "fire-solid", label: "On fire", solid: true };
  if (total >= 70) return { icon: "star", label: "Genuinely interesting", solid: false };
  if (total >= 40) return { icon: "face-thinking", label: "The panel is thinking", solid: false };
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
    console.warn(
      "[rankings] CLOUDFLARE_D1_TOKEN unset — building an empty leaderboard.",
    );
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
  SELECT c.slug, c.name, c.domain, c.logo_url, c.one_liner, c.founded_year,
         c.division, c.provisional, c.category, c.stage,
         r.total, r.positioning, r.content, r.gtm_stack, r.innovation,
         r.detail_json, r.stack_json, r.verdict, r.created_at
  FROM company c
  JOIN ranking r ON r.company_id = c.id
  WHERE c.status = 'published'`;

/** Every published entry, best first. */
export async function getEntries(): Promise<Entry[]> {
  return query<Entry>(`${ENTRY_SELECT} ORDER BY r.total DESC, c.name ASC`);
}

/** Entries grouped into their divisions, each already ranked. */
export async function getBoard(): Promise<Record<Division, Entry[]>> {
  const all = await getEntries();
  return {
    featherweight: all.filter((e) => e.division === "featherweight"),
    middleweight: all.filter((e) => e.division === "middleweight"),
    heavyweight: all.filter((e) => e.division === "heavyweight"),
  };
}

/** Per-dimension detail for one entry, parsed from its stored JSON. */
export function detailFor(entry: Entry): Record<string, { reasoning: string; improve: string }> {
  try {
    return JSON.parse(entry.detail_json || "{}");
  } catch {
    return {};
  }
}

/** The GTM stack we detected, as category -> tool names. */
export function stackFor(entry: Entry): Record<string, string[]> {
  try {
    return JSON.parse(entry.stack_json || "{}");
  } catch {
    return {};
  }
}
