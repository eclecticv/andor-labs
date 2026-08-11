// schema.org builders for the blog.
//
// Every function returns a plain object, never a string — the caller stringifies
// once, inside the `<script type="application/ld+json">`. Keeping serialisation
// out of here means a template can merge, inspect or assert on the graph before
// it ships, and the build-time JSON-LD check can parse what it was given.

/** The site's own identity. Hardcoded because there is exactly one publisher. */
const SITE_URL = "https://andorlabs.ca";
const SITE_NAME = "And/or Labs";
const LOGO_PATH = "/andor-mark.png";

/**
 * Google truncates a `headline` past 110 characters and reports the overflow as
 * a structured-data warning, so trim rather than let it flag. Cut on a word
 * boundary — a headline severed mid-word reads as a bug in any surface that
 * renders it verbatim.
 */
const MAX_HEADLINE = 110;

export interface SeoPost {
  title: string;
  slug: string;
  excerpt?: string;
  standfirst?: string;
  publishedAt: string;
  updatedAt?: string;
  tags?: string[];
  seo?: {metaTitle?: string; metaDescription?: string; noIndex?: boolean};
}

export interface SeoAuthor {
  name: string;
  slug?: string;
  role?: string;
  /** Plain text — run the Portable Text bio through `toPlainText` first. */
  bio?: string;
  credentials?: string[];
  /** LinkedIn, X, personal site. This is what ties the byline to a known entity. */
  sameAs?: string[];
  photoUrl?: string;
  email?: string;
}

export interface BlogPostingInput {
  post: SeoPost;
  author?: SeoAuthor | null;
  /** Absolute canonical URL of the post. */
  url: string;
  /** Absolute URL of the hero/OG image. */
  imageUrl?: string;
  wordCount: number;
  readingTimeMinutes: number;
}

export interface BreadcrumbItem {
  name: string;
  url: string;
}

export interface FaqItem {
  question: string;
  answer: string;
}

type JsonLdValue = unknown;

/**
 * Drops keys with no value.
 *
 * Google's validator flags null-valued properties as errors rather than ignoring
 * them, and an empty array or empty string is the same non-answer in a slower
 * form. `0` and `false` are real values and survive.
 */
function compact<T extends Record<string, JsonLdValue>>(obj: T): Record<string, JsonLdValue> {
  const out: Record<string, JsonLdValue> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (isPlainObject(value) && Object.keys(value).length === 0) continue;
    out[key] = value;
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function absolute(pathOrUrl: string): string {
  // Tolerates both "/andor-mark.png" and a full CDN URL, so callers never have to
  // know which shape they are holding.
  return new URL(pathOrUrl, SITE_URL).href;
}

/** Truncate to `max` characters without splitting a word; ellipsis is omitted. */
function truncateOnWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const clipped = text.slice(0, max);
  const lastSpace = clipped.lastIndexOf(" ");
  return (lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped).trimEnd();
}

/** ISO 8601 duration, e.g. 7 → "PT7M". schema.org rejects a bare integer here. */
function isoMinutes(minutes: number): string {
  return `PT${Math.max(1, Math.round(minutes))}M`;
}

export function organizationJsonLd(): Record<string, JsonLdValue> {
  return compact({
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
    logo: compact({
      "@type": "ImageObject",
      url: absolute(LOGO_PATH),
    }),
  });
}

export function websiteJsonLd(): Record<string, JsonLdValue> {
  // No `potentialAction`/SearchAction: the site has no search endpoint, and
  // declaring one that 404s is worse than declaring nothing.
  return compact({
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: SITE_URL,
    inLanguage: "en",
    publisher: compact({
      "@type": "Organization",
      name: SITE_NAME,
      url: SITE_URL,
    }),
  });
}

/**
 * `Person` for the byline.
 *
 * `url` is the person's canonical page, not the post's — this node gets reused
 * inside `BlogPosting.author`, where pointing back at the article would make the
 * author and the article the same entity.
 */
export function personJsonLd(author: SeoAuthor, url: string): Record<string, JsonLdValue> {
  return compact({
    "@context": "https://schema.org",
    "@type": "Person",
    name: author.name,
    url,
    jobTitle: author.role,
    image: author.photoUrl ? absolute(author.photoUrl) : undefined,
    sameAs: author.sameAs,
    description: author.bio,
    email: author.email,
    knowsAbout: author.credentials,
  });
}

function authorUrl(author: SeoAuthor): string {
  return author.sameAs?.[0] ?? SITE_URL;
}

function stripContext(node: Record<string, JsonLdValue>): Record<string, JsonLdValue> {
  const {["@context"]: _dropped, ...rest} = node;
  return rest;
}

export function blogPostingJsonLd(input: BlogPostingInput): Record<string, JsonLdValue> {
  const {post, author, url, imageUrl, wordCount, readingTimeMinutes} = input;

  // The author node is nested, so it drops its own @context — one context at the
  // root is what validators expect.
  //
  // There are no author-archive pages on this site (deliberately), so `url` falls
  // back to the first profile link: Google asks for a page that *uniquely
  // identifies* the author, and a LinkedIn profile does that where andorlabs.ca
  // homepage does not.
  const authorNode = author
    ? stripContext(personJsonLd(author, authorUrl(author)))
    : undefined;

  return compact({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: truncateOnWord(post.seo?.metaTitle ?? post.title, MAX_HEADLINE),
    description: post.seo?.metaDescription ?? post.excerpt ?? post.standfirst,
    datePublished: post.publishedAt,
    // Google weights freshness off dateModified; absent an edit, "modified" is
    // the publish date rather than nothing, which is the truthful answer.
    dateModified: post.updatedAt ?? post.publishedAt,
    image: imageUrl,
    wordCount,
    timeRequired: isoMinutes(readingTimeMinutes),
    // articleSection takes a single section; the first tag is the primary one.
    articleSection: post.tags?.[0],
    // Comma-joined rather than an array: that is the form in Google's own
    // examples, and both are valid schema.org.
    keywords: post.tags?.length ? post.tags.join(", ") : undefined,
    inLanguage: "en",
    isAccessibleForFree: true,
    mainEntityOfPage: compact({
      "@type": "WebPage",
      "@id": url,
    }),
    author: authorNode,
    publisher: compact({
      "@type": "Organization",
      name: SITE_NAME,
      url: SITE_URL,
      logo: compact({
        "@type": "ImageObject",
        url: absolute(LOGO_PATH),
      }),
    }),
  });
}

export function breadcrumbJsonLd(items: BreadcrumbItem[]): Record<string, JsonLdValue> {
  return compact({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) =>
      compact({
        "@type": "ListItem",
        // schema.org positions are 1-based; a 0 makes the whole list invalid.
        position: index + 1,
        name: item.name,
        item: item.url,
      })
    ),
  });
}

/**
 * `FAQPage`, or `null` when there is nothing to ask.
 *
 * Returning null rather than an empty FAQPage lets the caller skip the script
 * tag entirely — an FAQPage with no `mainEntity` is a structured-data error, not
 * an empty section.
 */
export function faqJsonLd(faq: FaqItem[]): Record<string, JsonLdValue> | null {
  const entries = faq.filter((item) => item.question?.trim() && item.answer?.trim());
  if (entries.length === 0) return null;

  return compact({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: entries.map((item) =>
      compact({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: compact({
          "@type": "Answer",
          text: item.answer,
        }),
      })
    ),
  });
}
