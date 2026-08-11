# And/or Labs — Editorial blog

**Date:** 2026-08-11
**Branch:** `blog/editorial-template`
**Benchmark:** The Information — editorial hierarchy, a real byline, dense ruled lists, no card-grid mush.

## Goal

Replace the placeholder blog with a publication-grade template: full Portable Text
typesetting from Sanity, an attributable author, social sharing, prev/next, a Loops
subscribe box, dithered hero art on every post, and the on-page technical SEO/AEO
surface that lets both Google and answer engines resolve who wrote this and what it
claims.

## Starting state

- Repo `~/Developer/andor-labs` — Astro 7, static output, `site: https://andorlabs.ca`.
- Sanity project `2b9cfqwh`, dataset `production`. **11 posts already live**, all with
  `heroImage: null` and plain bodies (`h2` / `normal` / `bullet` / `link` only).
- 3 further posts sit un-migrated in `_archive/andor-labs-site/src/content/blog/`
  under a different frontmatter shape (`description` / `pubDate` vs `excerpt` /
  `publishedAt`).
- `blog/index.astro` (63 lines) and `blog/[slug].astro` (77 lines) are inline-styled
  placeholders. Article JSON-LD exists; nothing else does.
- `Newsletter.astro` posts to `/api/subscribe`, but **no `functions/` directory exists
  in the repo** — that Pages Function only ever existed at deploy, against Beehiiv.
- Dither exists twice: `DitherLine.astro` (SVG `░` pattern) and `Photo.astro`
  (client-side Bayer 4×4 canvas duotone, `#0A2EBF` → `#EEF1FF`).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | **Bake the dither at import**, upload the finished PNG to Sanity | The hero is the LCP element. Client-side canvas dithering leaves it blank until JS runs and depends on `cdn.sanity.io` CORS headers for `getImageData()`. Baking makes it a plain `<img>`. |
| 2 | **Enrich, don't rewrite** existing post bodies | Structural typesetting only — a pull quote may only *promote an existing sentence*. Enforced mechanically (see below). |
| 3 | **Featured lead + ruled list** for `/blog` | Scales past 50 posts; gives hierarchy a uniform grid can't. |
| 4 | Hero image doubles as the **OG image**, cropped by Sanity's CDN | Avoids adding a satori/resvg render pipeline for zero visual gain — the dithered duotone already looks like the brand. |
| 5 | **Openverse** for stock photography | CC-licensed, no API key, attribution capturable. Escalate to an Unsplash key only if results are unusable. |
| 6 | Split `excerpt` into `standfirst` + `excerpt` + `keyTakeaways` | One field currently serves three incompatible jobs. |

## Content model

### New document: `author`

EEAT is not a meta tag — it is whether a machine can resolve *who wrote this and why
they should be believed*. That needs an entity, not the hardcoded string the current
JSON-LD uses.

```
name, slug, role, photo, bio (portable text),
credentials[] (string), sameAs[] (url), email
```

### `post` — added fields

| Field | Type | Purpose |
|---|---|---|
| `author` | reference → author | Byline, author card, `Person` JSON-LD |
| `standfirst` | text | On-page deck under the H1. Human-facing. |
| `excerpt` | text ≤160 | Meta description + card blurb. SERP-facing. |
| `keyTakeaways` | string[] | "The gist" box; the highest-leverage AEO surface |
| `updatedAt` | datetime | `dateModified` — Google weights it |
| `faq` | {question, answer}[] | On-page FAQ + `FAQPage` JSON-LD |
| `relatedPosts` | reference[] | Manual override; falls back to shared tags |
| `heroImage` | image + `alt`, `caption`, `credit` | Alt is required by validation |
| `seo` | {metaTitle, metaDescription, noIndex} | Per-post override |

Reading time and word count are **derived at build** from the body, never stored — a
stored count silently goes stale the moment anyone edits in Studio.

### `post.body` — block content

```
styles     normal · h2 · h3 · h4 · blockquote
lists      bullet · number
marks      strong · em · code · link{href, newTab} · footnote
objects    pullQuote { text, attribution }
           divider   { rule | dither | asterism }
           callout   { tone: note|warning|key, title, body }
           codeBlock { language, filename, code }
           figure    { image, alt, caption, credit, dither }
           keyStat   { value, label, source }
```

## Article template

720px column (`--content-width`). Pull quotes and figures break out wider. On ≥1280px
a sticky TOC rail (generated from the h2s) and a sticky share rail flank the column;
both collapse inline below that. Thin reading-progress bar at the top.

```
breadcrumb   Home / Field notes / <title>
eyebrow      <tag>
H1           <title>                        Instrument Serif
standfirst   <standfirst>                   Newsreader, ink-600
byline       [photo] Name · Role · Published · Updated · N min
──────────   share: X · LinkedIn · Copy link · Email
[ dithered hero, caption + credit in mono ]
┌ THE GIST ────────────────┐
│ ▪ keyTakeaways[]         │
└──────────────────────────┘
body
──────────   author card: photo, bio, credentials, sameAs links
FAQ          (when present)
subscribe    (Loops)
──────────   ← previous · next →
related      3 posts, by shared tag
```

## Index

Featured lead story (large dithered hero, tag, title, standfirst, byline) above a
hairline-ruled list of the remainder, each row a small dithered thumbnail + title +
excerpt + date. Tag filter chips.

## SEO / AEO

- `BlogPosting` JSON-LD: `headline`, `description`, `datePublished`, `dateModified`,
  `image`, `wordCount`, `articleSection`, `keywords`, `inLanguage`,
  `isAccessibleForFree`, `mainEntityOfPage`, `author` → Person with `sameAs`,
  `publisher` → Organization with `logo`.
- `BreadcrumbList` on every post.
- `FAQPage` when `faq` is populated.
- Per-post OG/Twitter image from the hero via `?w=1200&h=630&fit=crop`, falling back
  to `/og.png`.
- RSS at `/blog/rss.xml` (`@astrojs/rss`).
- `llms.txt` extended to enumerate posts with their `targetQuery`.
- Semantic HTML: one `h1`, ordered heading levels, `<article>`, `<time datetime>`.
- Accessibility: alt text required by schema validation; muted text resolves to
  `--ink-500`, never `--ink-400` (2.90:1, fails AA — noted in `colors.css`).

## Email capture

`functions/api/subscribe.ts` — Cloudflare Pages Function, `POST` → Loops
`/api/v1/contacts/create` with `Bearer ${LOOPS_API_KEY}`, tagging `source` so blog
signups are distinguishable from homepage ones. The key is a Cloudflare secret,
supplied by VJ after this lands; until then the function returns a clean error and the
form shows a friendly failure rather than a stack trace.

## Import & enrichment

`scripts/` gains three one-shot, idempotent scripts (deterministic `_id`s +
`createOrReplace`, same pattern as the existing `seed-blog.ts`):

1. **`import-remaining-posts.ts`** — the 3 posts from `_archive/andor-labs-site`,
   mapping `description`→`excerpt`, `pubDate`→`publishedAt`.
2. **`enrich-bodies.ts`** — adds `pullQuote` / `divider` / `callout` blocks.
   **Invariant, asserted in code:** the concatenated plain text of the enriched body
   must equal that of the original. A pull quote can only be a promotion of an
   existing sentence; the script aborts if a single character differs. Writes a
   reviewable diff before touching Sanity.
3. **`backfill-heroes.ts`** — Openverse search → download → Bayer-dither to the house
   duotone → upload to Sanity → patch `heroImage` with `alt`, `caption`, `credit`.

Sources under `_archive/` are read-only and never modified.

## Also in scope

- "Blog" nav link in `SiteHeader` and `SiteFooter`.
- Homepage section: three recent stories + the subscribe box.

## Out of scope

- Comments, search, pagination (14 posts doesn't need it), author-archive pages,
  category landing pages, generated OG cards.

## Verification

`astro build` green · dev server via `portless andor-labs npm run dev` · Sanity query
confirms 14 posts each with a hero image and an author reference · JSON-LD validated
by parsing the built HTML · screenshots for VJ.

## Deploy

VJ authorised deploy on completion. `andorlabs.ca` is Cloudflare Pages project
`andorlabs` tracking `eclecticv/andor-labs` — **merging to `main` and pushing ships to
production.**
