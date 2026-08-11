/**
 * Openverse image search — CC-licensed stock photography for post heroes.
 *
 * https://api.openverse.org/v1/images/ needs no API key for the modest rate
 * limits a one-shot backfill script uses. Verified live 2026-08-11: the search
 * endpoint returns HTTP 200 anonymously and each result carries
 * `url`, `title`, `creator`, `creator_url`, `license`, `license_version`,
 * `license_url`, `foreign_landing_url`, `width`, `height`, `mature`.
 *
 * Attribution is a licence obligation, not decoration — `attributionLine()`
 * produces the string that goes into Sanity's `heroImage.credit`.
 */

const API = "https://api.openverse.org/v1/images/";

/**
 * Contact-ish UA. Openverse asks anonymous clients to identify themselves;
 * some upstream image hosts (Wikimedia especially) reject a default UA outright.
 */
const USER_AGENT =
  "andorlabs-blog-import/1.0 (+https://andorlabs.ca; hero image backfill)";

/**
 * Licences that permit commercial use *and* modification. Dithering is a
 * derivative work, so anything with an ND clause is unusable and anything with
 * NC is unusable on a company site. Mirrors `license_type=commercial,modification`
 * — we send that filter *and* re-check here, because a filter is a request and
 * this is the thing we actually rely on.
 */
const ALLOWED_LICENSES = new Set(["cc0", "pdm", "by", "by-sa", "sampling+"]);

export interface OpenverseResult {
  id: string;
  /** Direct URL to the full-size image file. */
  url: string;
  title: string;
  creator: string;
  creatorUrl: string;
  /** Openverse licence code, e.g. "by-sa", "cc0". */
  license: string;
  /** e.g. "2.0", or "" when the API reports "N/A". */
  licenseVersion: string;
  licenseUrl: string;
  /** Human-facing page for the work — where attribution should link. */
  foreignLandingUrl: string;
  width: number | null;
  height: number | null;
}

export interface SearchOptions {
  /** How many candidates to fetch before ranking. Default 20. */
  pageSize?: number;
  /** Preferred minimum width when the API exposes dimensions. Default 1600. */
  minWidth?: number;
  /** Request timeout in ms. Default 15000. */
  timeoutMs?: number;
}

interface RawResult {
  id?: string;
  url?: string;
  title?: string;
  creator?: string;
  creator_url?: string;
  license?: string;
  license_version?: string;
  license_url?: string;
  foreign_landing_url?: string;
  width?: number;
  height?: number;
  mature?: boolean;
}

function normalise(r: RawResult): OpenverseResult | null {
  if (!r.id || !r.url || !r.license) return null;
  const version = r.license_version && r.license_version !== "N/A" ? r.license_version : "";
  return {
    id: r.id,
    url: r.url,
    title: (r.title ?? "").trim(),
    creator: (r.creator ?? "").trim(),
    creatorUrl: r.creator_url ?? "",
    license: r.license.toLowerCase(),
    licenseVersion: version,
    licenseUrl: r.license_url ?? "",
    foreignLandingUrl: r.foreign_landing_url ?? "",
    width: typeof r.width === "number" ? r.width : null,
    height: typeof r.height === "number" ? r.height : null,
  };
}

/**
 * Rank candidates: landscape beats portrait, big beats small. The hero is
 * cropped to 16:9, so a portrait source loses most of its subject.
 */
function score(r: OpenverseResult, minWidth: number): number {
  let s = 0;
  if (r.width && r.height) {
    const ratio = r.width / r.height;
    if (ratio >= 1.6) s += 4;
    else if (ratio >= 1.2) s += 3;
    else if (ratio >= 1.0) s += 1;
    if (r.width >= minWidth) s += 3;
    else if (r.width >= minWidth * 0.75) s += 1;
  }
  // Public-domain marks need no attribution wrangling — mild preference.
  if (r.license === "cc0" || r.license === "pdm") s += 1;
  return s;
}

/** One page of results, already normalised and licence-filtered. `null` = request failed. */
async function fetchPool(
  query: string,
  pageSize: number,
  timeoutMs: number,
  size?: "large",
): Promise<OpenverseResult[] | null> {
  const params = new URLSearchParams({
    q: query,
    license_type: "commercial,modification",
    page_size: String(Math.min(Math.max(pageSize, 1), 20)),
    mature: "false",
  });
  if (size) params.set("size", size);

  try {
    const res = await fetch(`${API}?${params}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as { results?: RawResult[] };
    return (payload.results ?? [])
      .filter((r) => r.mature !== true)
      .map(normalise)
      .filter((r): r is OpenverseResult => r !== null)
      .filter((r) => ALLOWED_LICENSES.has(r.license))
      .filter((r) => /^https?:\/\//i.test(r.url));
  } catch {
    return null;
  }
}

function best(pool: OpenverseResult[], minWidth: number): OpenverseResult | null {
  if (pool.length === 0) return null;
  // Stable: highest score wins, API relevance order breaks ties.
  return pool
    .map((r, i) => ({ r, i, s: score(r, minWidth) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)[0].r;
}

/**
 * Search Openverse for one usable image.
 *
 * Queries the `size=large` bucket first — measured on 2026-08-11, an unfiltered
 * search for "server racks data center" returns mostly 1024px-wide Flickr
 * uploads, while `size=large` returns 1536–5346px sources. A 1600px-wide hero
 * upscaled from a 1024px source looks soft, so the big bucket is tried first and
 * the unfiltered pool is only merged in if nothing there is landscape and large
 * enough.
 *
 * Returns `null` — never throws — when the API is unreachable, returns a
 * non-2xx, or has nothing commercially usable, so callers can fall back to a
 * different query or skip the post.
 */
export async function searchImage(
  query: string,
  opts: SearchOptions = {},
): Promise<OpenverseResult | null> {
  const { pageSize = 20, minWidth = 1600, timeoutMs = 15_000 } = opts;

  const large = await fetchPool(query, pageSize, timeoutMs, "large");
  const fromLarge = best(large ?? [], minWidth);
  // Good enough to stop: landscape and at least minWidth wide.
  if (fromLarge && fromLarge.width && fromLarge.height) {
    if (fromLarge.width >= minWidth && fromLarge.width / fromLarge.height >= 1.2) {
      return fromLarge;
    }
  }

  const any = await fetchPool(query, pageSize, timeoutMs);
  if (large === null && any === null) return null; // API unreachable

  const merged = [...(large ?? []), ...(any ?? [])];
  const deduped = [...new Map(merged.map((r) => [r.id, r])).values()];
  return best(deduped, minWidth);
}

const LICENSE_LABELS: Record<string, string> = {
  cc0: "CC0 1.0",
  pdm: "Public Domain Mark 1.0",
};

/** "CC BY-SA 2.0", "CC0 1.0", "Public Domain Mark 1.0". */
function licenseLabel(result: OpenverseResult): string {
  const fixed = LICENSE_LABELS[result.license];
  if (fixed) return fixed;
  const code = result.license.toUpperCase();
  return result.licenseVersion ? `CC ${code} ${result.licenseVersion}` : `CC ${code}`;
}

/**
 * The attribution string stored in `heroImage.credit`.
 *
 * e.g. `Photo by Jane Doe, CC BY 2.0`
 *      `Photo by Gwan Kho, CC BY-SA 2.0`
 *      `Photo via Openverse, CC0 1.0`   (no named creator)
 */
export function attributionLine(result: OpenverseResult): string {
  const who = result.creator ? `Photo by ${result.creator}` : "Photo via Openverse";
  return `${who}, ${licenseLabel(result)}`;
}

/**
 * Download the image bytes. Throws on a non-2xx or an empty body — a caller
 * that gets a Buffer back can trust it.
 */
export async function fetchImageBytes(url: string, timeoutMs = 30_000): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "image/*,*/*;q=0.8" },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`fetchImageBytes: ${res.status} ${res.statusText} for ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength === 0) {
    throw new Error(`fetchImageBytes: empty body for ${url}`);
  }
  return buf;
}
