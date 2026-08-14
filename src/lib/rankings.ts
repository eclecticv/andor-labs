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
 * Build-time environment (set these in the Pages build settings, not .dev.vars):
 *   CLOUDFLARE_ACCOUNT_ID
 *   CLOUDFLARE_D1_TOKEN     — an API token with D1 read on this account
 *   CLOUDFLARE_D1_DATABASE  — optional; defaults to the id below
 */

const DEFAULT_DATABASE_ID = "662a14cc-7ed7-47d0-9dbb-a0e10d95ff43";

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

export const AXES = [
  { key: "paradigm", label: "Paradigm", max: 40, icon: "shapes",
    question: "Does this assume 2026, or 2016 with an AI badge stapled on?" },
  { key: "non_obviousness", label: "Non-obviousness", max: 25, icon: "lightbulb",
    question: "Was the insight already in everybody else's deck?" },
  { key: "vibe_code", label: "Vibe-code test", max: 20, icon: "laptop-code",
    question: "Could a good engineer rebuild the core in a weekend?" },
  { key: "conviction", label: "Conviction", max: 15, icon: "flag",
    question: "One real position, or hedging across five categories?" },
] as const;

export interface JurorTake {
  provider: string;
  model_id: string;
  lens: string;
  quote: string | null;
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
  total: number;
  paradigm: number;
  non_obviousness: number;
  vibe_code: number;
  conviction: number;
  verdict: string;
  split_note: string | null;
  platform_note: string | null;
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
  const account = env("CLOUDFLARE_ACCOUNT_ID");
  const token = env("CLOUDFLARE_D1_TOKEN");
  const database = env("CLOUDFLARE_D1_DATABASE") ?? DEFAULT_DATABASE_ID;

  if (!account || !token) {
    console.warn(
      "[rankings] CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_D1_TOKEN unset — building an empty leaderboard.",
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
         c.division, c.provisional,
         r.total, r.paradigm, r.non_obviousness, r.vibe_code, r.conviction,
         r.verdict, r.split_note, r.platform_note, r.created_at
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

/** The panel behind one ranking, for the company page. */
export async function getJurors(slug: string): Promise<JurorTake[]> {
  return query<JurorTake>(
    `SELECT j.provider, j.model_id, j.lens, j.quote, j.abstained
     FROM juror_take j
     JOIN ranking r ON r.id = j.ranking_id
     JOIN company c ON c.id = r.company_id
     WHERE c.slug = ?
     ORDER BY j.abstained ASC, j.id ASC`,
    [slug],
  );
}
