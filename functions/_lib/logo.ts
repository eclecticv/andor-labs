/**
 * Finding a company's logo, from the page we already fetched.
 *
 * No enrichment vendor. Clearbit's free logo API — the obvious choice — was
 * sunset in December 2025, and every paid alternative would become a
 * load-bearing dependency of a free tool. The markup we already have names the
 * logo in four or five different places; the work is knowing which to trust and
 * which to refuse.
 *
 * ── Why refusal matters as much as extraction ──
 * pubx.ai is the case that prompted this. It declares a perfectly good logo in
 * JSON-LD — pointing at `http://18.205.7.45/app/uploads/.../company-logo.png`,
 * a misconfigured WordPress leaking its origin IP over plain HTTP. Extracting
 * that "successfully" is worse than finding nothing: the board renders an
 * <img> that the browser blocks as mixed content, and a broken image is uglier
 * than the blank placeholder we fall back to. So a candidate has to survive
 * validation before it counts as found.
 */

export interface LogoCandidate {
  url: string;
  /** Where it came from, for logging when a company's logo looks wrong. */
  source: "apple-touch-icon" | "json-ld" | "link-icon" | "og-image" | "favicon";
}

const attr = (tag: string, name: string): string | null =>
  new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(tag)?.[1] ?? null;

/**
 * Candidates in order of how likely they are to be an actual square logo.
 *
 * og:image sits LOW deliberately. It is usually a social card — wide, with a
 * headline baked into it — and a card stretched into a 28px row avatar looks
 * like a mistake. It is a fallback, not a preference.
 */
export function logoCandidates(html: string, baseUrl: string): LogoCandidate[] {
  const out: LogoCandidate[] = [];
  const abs = (href: string): string | null => {
    try {
      return new URL(href, baseUrl).toString();
    } catch {
      return null;
    }
  };
  const push = (href: string | null | undefined, source: LogoCandidate["source"]) => {
    if (!href) return;
    const u = abs(href);
    if (u && !out.some((c) => c.url === u)) out.push({ url: u, source });
  };

  // 1. apple-touch-icon — purpose-built, square, and usually the largest.
  const touch = [...html.matchAll(/<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]*>/gi)]
    .map((m) => m[0])
    // Biggest declared size first; `sizes` is often absent, which sorts last.
    .sort((a, b) => (Number.parseInt(attr(b, "sizes") ?? "0", 10) || 0) - (Number.parseInt(attr(a, "sizes") ?? "0", 10) || 0));
  for (const tag of touch) push(attr(tag, "href"), "apple-touch-icon");

  // 2. schema.org Organization logo — explicitly the logo, when it is honest.
  for (const m of html.matchAll(/"logo"\s*:\s*\{([^}]{0,400})\}/gi)) {
    const block = m[1];
    push(/"(?:contentUrl|url)"\s*:\s*"([^"]+)"/i.exec(block)?.[1], "json-ld");
  }
  // The shorthand form, where logo is a bare string.
  push(/"logo"\s*:\s*"(https?:\/\/[^"]+)"/i.exec(html)?.[1], "json-ld");

  // 3. Any declared icon. Prefer svg/png over .ico, which is usually 16px.
  const icons = [...html.matchAll(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]*>/gi)]
    .map((m) => m[0])
    .sort((a, b) => Number((attr(b, "href") ?? "").match(/\.(svg|png)$/i) !== null) - Number((attr(a, "href") ?? "").match(/\.(svg|png)$/i) !== null));
  for (const tag of icons) push(attr(tag, "href"), "link-icon");

  // 4. og:image — a social card, not a logo. Last real resort.
  const og = [...html.matchAll(/<meta[^>]+property=["']og:image["'][^>]*>/gi)].map((m) => m[0]);
  for (const tag of og) push(attr(tag, "content"), "og-image");

  // 5. The convention, when the page declares nothing at all.
  push("/favicon.ico", "favicon");

  return out;
}

/** Hosts we will not link to from a public page. */
const RAW_IP = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * A candidate is only usable if the browser will actually render it.
 *
 * https only: the board is served over https, so an http image is blocked as
 * mixed content and shows as broken. A raw-IP host is refused too — it is
 * almost always a misconfiguration leaking an origin server, and it will not
 * survive the company's next deploy.
 */
export function isUsable(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    if (RAW_IP.test(u.hostname)) return false;
    if (u.hostname === "localhost") return false;
    return true;
  } catch {
    return false;
  }
}

type Fetcher = (url: string) => Promise<{ ok: boolean; contentType: string | null }>;

const defaultFetcher: Fetcher = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow", signal: controller.signal });
    return { ok: res.ok, contentType: res.headers.get("content-type") };
  } catch {
    return { ok: false, contentType: null };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * The first candidate that is both usable and actually there.
 *
 * Verifying costs a HEAD request per attempt, which is worth it: a stored URL
 * that 404s renders as a broken image on the board forever, and nothing in the
 * pipeline would ever notice. Capped at three attempts so a site with a long
 * list of dead icons cannot stall a ranking.
 */
export async function resolveLogo(
  html: string,
  baseUrl: string,
  fetcher: Fetcher = defaultFetcher,
): Promise<LogoCandidate | null> {
  const candidates = logoCandidates(html, baseUrl).filter((c) => isUsable(c.url));
  for (const candidate of candidates.slice(0, 3)) {
    const { ok, contentType } = await fetcher(candidate.url);
    // Some servers answer HEAD with 405 but serve the image happily on GET, so
    // a missing content-type is not disqualifying — only an explicit non-image.
    if (ok && (!contentType || contentType.startsWith("image/"))) return candidate;
  }
  return null;
}
