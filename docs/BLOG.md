# Field notes — how the blog works

## Where things live

| Thing | Path |
|---|---|
| Article template | `src/pages/blog/[slug].astro` |
| Index (lead + ruled list) | `src/pages/blog/index.astro` |
| RSS | `src/pages/blog/rss.xml.ts` |
| Blog components | `src/components/blog/` |
| Portable Text block renderers | `src/components/blog/pt/` |
| Styles | `src/styles/blog.css` |
| Derived facts (reading time, TOC) | `src/lib/portableText.ts` |
| JSON-LD builders | `src/lib/seo.ts` |
| Sanity CDN URLs | `src/lib/sanityImage.ts` |
| Schema | `sanity/schemaTypes/` |
| Loops endpoint | `functions/api/subscribe.ts` |

Studio is at `/admin`.

## Writing a post

Everything except `body`, `title` and `slug` is optional at render time, but the
schema requires `author`, `standfirst`, `excerpt` and `publishedAt`.

- **`standfirst`** — the deck under the H1. Written for a human deciding whether
  to read. The template **hides it** if it ends in an ellipsis or repeats the
  post's opening, so a machine-truncated excerpt never renders as a deck.
- **`excerpt`** — SERP meta description and card blurb only. Never shown on the
  article page. Max 160.
- **`keyTakeaways`** — renders as "The gist" and is the single highest-leverage
  field for answer engines. Write them as standalone claims that survive being
  quoted without the surrounding paragraph.
- **`faq`** — renders on-page and emits `FAQPage` JSON-LD.
- **`updatedAt`** — set only on a real revision. It becomes `dateModified`.
- **`heroImage`** — see below. `alt` is required by validation.

Reading time and word count are derived at build. Don't store them.

## Body blocks

`pullQuote` · `divider` (rule / asterism / dither) · `callout` (note / warning /
key) · `codeBlock` · `figure` · `keyStat`, plus h2–h4, blockquote, bullet and
numbered lists, links and footnotes.

Footnotes are numbered and collected automatically at the foot of the article.
Heading ids are de-duplicated and shared with the table of contents, so two
identically-worded h2s still get working anchors.

Pull quotes and figures break out wider than the reading column. **When adding a
new breakout block, use `margin-block`, never the `margin` shorthand** — the
shorthand resets `margin-left` and silently kills the centring.

## Hero images

Baked, not rendered live: sourced from Openverse, dithered to the house blue
duotone in Node, uploaded to Sanity as a 2-colour PNG (~16 KB for 1600×900). The
hero is the LCP element, so it must be a plain `<img>`, not a canvas.

```bash
npx sanity exec scripts/backfill-heroes.ts --with-user-token
```

Skips posts that already have a hero. The `credit` field is a licence
obligation — don't clear it.

To re-dither everything with a different palette, edit `ditherPreset.HERO` in
`scripts/lib/dither.ts`, clear `heroImage` on the posts, and re-run.

## Email capture

The form posts to `/api/subscribe`, a Cloudflare Pages Function that forwards to
Loops with `LOOPS_API_KEY`.

**Set the secret:** Cloudflare dashboard → Pages → `andorlabs` → Settings →
Variables and Secrets → `LOOPS_API_KEY`. Until it is set the endpoint returns
503 and the form shows a friendly message.

`source` distinguishes `homepage` / `blog-post` / `blog-index` / `footer` in
Loops. Add new values to `ALLOWED_SOURCES` or they collapse to `unknown`.

## Scripts

All idempotent, all run via `npx sanity exec <path> --with-user-token`.

| Script | What it does |
|---|---|
| `seed-blog.ts` | Original 11-post import (done) |
| `create-author.ts` | The author document |
| `import-remaining-posts.ts` | The 3 posts from the second archive (done) |
| `migrate-add-standfirst.ts` | Backfills `author` + `standfirst` |
| `backfill-heroes.ts` | Sources, dithers and uploads hero art |
| `enrich-bodies.ts` | Adds pull quotes, dividers, takeaways. **Dry-run by default**; `-- --apply` writes |

`enrich-bodies.ts` asserts that the enriched body's plain text is byte-identical
to the original before writing, and that every pull quote and takeaway appears
verbatim in the post. It refuses to invent copy. Keep it that way.

## Deploy

`andorlabs.ca` is Cloudflare Pages project `andorlabs` tracking
`eclecticv/andor-labs`. **Pushing `main` deploys to production.**
