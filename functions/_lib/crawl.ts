/**
 * Reading a company, not just its homepage.
 *
 * This is the single biggest quality lever in the pipeline and it costs
 * nothing. The old scores read as shallow because the model saw one marketing
 * page: a homepage is written to impress, so scoring from it alone measures
 * copywriting. The about, pricing, careers and blog pages are where a company
 * accidentally tells you the truth — how many people it has, whether anyone
 * writes for it, whether it will show you a price.
 *
 * No crawling service. Firecrawl would render JavaScript, which we cannot do,
 * but its free tier is a monthly cap on a public tool and the trade was not
 * worth taking. The cost of that choice is visible and named: a site that
 * renders client-side comes back thin, and `thin` is passed to the scorer so it
 * says so rather than inventing detail it never saw.
 */

const UA = "Mozilla/5.0 (compatible; AndorLabsResearchBot/1.0; +https://andorlabs.ca)";

/** Pages worth having, in the order we would give them up. */
const WANTED: { label: string; test: RegExp }[] = [
  { label: "About", test: /\/(about|company|team|who-we-are)\/?$/i },
  { label: "Pricing", test: /\/(pricing|plans)\/?$/i },
  { label: "Product", test: /\/(product|platform|features|solutions?)\/?$/i },
  { label: "Customers", test: /\/(customers?|case-stud(y|ies)|clients)\/?$/i },
  { label: "Careers", test: /\/(careers?|jobs|hiring|join-us)\/?$/i },
  { label: "Blog", test: /\/(blog|resources|insights|news)\/?$/i },
];

const MAX_EXTRA_PAGES = 4;

export interface SiteRead {
  /** Page text, each section headed, ready to drop into the prompt. */
  pages: string;
  /** Raw markup of everything fetched — what the stack detector reads. */
  html: string;
  finalUrl: string;
  titles: string[];
  sitemapUrlCount: number | null;
  /** The homepage rendered to almost nothing. Usually a client-side app. */
  thin: boolean;
}

async function get(url: string, timeoutMs = 10_000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
    });
    if (!res.ok) return null;
    return (await res.text()).slice(0, 400_000);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Strip markup to readable text. Same reduction the old single-page read used. */
export function toText(html: string, limit = 9_000): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

const title = (html: string) => /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? null;

/**
 * Same-origin links matching the pages we want, one per label.
 *
 * One per label matters: a blog index links forty posts, and forty blog posts
 * would crowd out the pricing page entirely. Breadth beats depth here — we are
 * establishing what exists, not reading the archive.
 */
export function pickLinks(html: string, baseUrl: string): { label: string; url: string }[] {
  const origin = new URL(baseUrl).origin;
  const hrefs = [...html.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)].map((m) => m[1]);
  const picked = new Map<string, string>();

  for (const href of hrefs) {
    let abs: URL;
    try {
      abs = new URL(href, baseUrl);
    } catch {
      continue;
    }
    if (abs.origin !== origin) continue;
    for (const want of WANTED) {
      if (!picked.has(want.label) && want.test.test(abs.pathname)) {
        picked.set(want.label, abs.toString());
      }
    }
  }
  return [...picked.entries()].map(([label, url]) => ({ label, url }));
}

/** A rough page count from the sitemap. Content-footprint evidence, free. */
async function countSitemap(origin: string): Promise<number | null> {
  const xml = await get(`${origin}/sitemap.xml`, 6_000);
  if (!xml) return null;
  const locs = xml.match(/<loc>/gi)?.length ?? 0;
  // A sitemap index points at more sitemaps rather than pages; the count of
  // children is not a page count, so report it as unknown rather than as 3.
  if (/<sitemapindex/i.test(xml)) return locs > 0 ? null : null;
  return locs;
}

export async function readSite(domain: string): Promise<SiteRead> {
  const homeUrl = `https://${domain}`;
  const home = await get(homeUrl);
  if (!home) {
    return { pages: "", html: "", finalUrl: homeUrl, titles: [], sitemapUrlCount: null, thin: true };
  }

  const origin = new URL(homeUrl).origin;
  const links = pickLinks(home, homeUrl).slice(0, MAX_EXTRA_PAGES);

  // Fetched together — these are independent GETs against one host and running
  // them in series would add seconds for no reason.
  const extras = await Promise.all(
    links.map(async (l) => ({ ...l, html: await get(l.url, 8_000) })),
  );

  const sitemapUrlCount = await countSitemap(origin);

  const homeText = toText(home, 10_000);
  const sections = [`## Homepage (${homeUrl})\n${homeText}`];
  const titles = [title(home)].filter((t): t is string => !!t);
  let html = home;

  for (const e of extras) {
    if (!e.html) continue;
    html += `\n${e.html}`;
    const t = title(e.html);
    if (t) titles.push(t);
    const text = toText(e.html, 5_000);
    if (text.length > 80) sections.push(`## ${e.label} (${e.url})\n${text}`);
  }

  return {
    pages: sections.join("\n\n"),
    html,
    finalUrl: homeUrl,
    titles,
    sitemapUrlCount,
    // Under 120 characters of homepage text means a shell: a client-rendered
    // app, a consent wall, or a bot block. Not an error, but the scorer has to
    // be told, or it will confidently score a page it never read.
    thin: homeText.length < 120,
  };
}
