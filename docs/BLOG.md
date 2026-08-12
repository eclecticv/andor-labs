# Writing — how the blog works

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
| Categories (labels, badges, Loops ids) | `src/lib/categories.ts` |
| Schema | `sanity/schemaTypes/` |
| Loops endpoint | `functions/api/subscribe.ts` |

Studio is at `/admin`.

The section is called **Writing**. "Field notes" is one of the three categories
inside it, not the whole thing — it is also the name of a Loops list, and the
two must keep matching.

## The three categories

Set on every post. `src/lib/categories.ts` is the single source of truth for
labels, badge variants, icons and Loops list ids.

| key | label | list | byline |
|---|---|---|---|
| `ai-newsletter` | `{ignore all previous instructions}` | weekly AI newsletter | agents author, VJ edits |
| `field-notes` | Field notes | occasional personal posts | VJ |
| `explainer` | Explainer | **none** | VJ |

Explainers get no subscribe box — there is no list to join, so the template
omits it rather than showing a form that promises nothing.

The category filter on `/blog/` hides itself while only one category has posts.
All 11 legacy posts were migrated to `field-notes`; a few of them (`what-is-*`)
are explainer-shaped and worth re-filing by hand in Studio.

## Bylines

`authors` is an array and `editor` is separate. `author.kind` is `person` or
`agent`, and drives the structured data: a model is emitted as
`SoftwareApplication` with its vendor as publisher, never as `Person`. A
validator may warn about that — it is the deliberate choice over claiming a
language model is a person on a site whose author schema exists to make byline
claims checkable.

A machine-written post shows no byline avatar, rather than borrowing the
editor's, which would read as "this person wrote it".

The legacy singular `author` field is retained, hidden and deprecated. It is
the rollback path; nothing reads it except the `coalesce` fallback in each
GROQ query.

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

**The secret is set.** It was applied with:

```bash
printf '%s' "$LOOPS_API_KEY" | npx wrangler@4.120.1 pages secret put LOOPS_API_KEY --project-name andorlabs
```

Pin the wrangler version — `wrangler@latest` currently fails to install. Note
that **a Pages Function only picks up a secret on the next deployment**; setting
it does not fix a running deployment, so push a commit afterwards.

The form shows both lists as ticked checkboxes with their real descriptions and
posts the selection. The endpoint falls back to ALL lists when `lists` is
absent, because a page rendered before the checkboxes existed can sit in a tab
for days and still post the old shape.

`source` distinguishes `homepage` / `blog-post` / `blog-index` / `footer` in
Loops. Add new values to `ALLOWED_SOURCES` **and deploy that first** — line 75
coerces an unknown source to `"unknown"` rather than erroring, so a front-end
that ships first loses attribution silently.

Loops list ids are duplicated in `src/lib/categories.ts` and
`functions/api/subscribe.ts` on purpose: Pages Functions bundle separately from
the Astro build. Change one, change the other.

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
| `create-agent-authors.ts` | The AI agent author documents |
| `migrate-categories-and-authors.ts` | Backfills `category` + `authors` (done) |
| `finalise-schema.ts` | Sets `author.kind`, audits whether required fields are safe to enforce |
| `tidy-excerpts.ts` | Re-truncates mid-word excerpts from source. Dry-run by default |
| `remove-scaffold-posts.ts` | Removes the three imported-by-mistake scaffold posts (done) |

`enrich-bodies.ts` asserts that the enriched body's plain text is byte-identical
to the original before writing, and that every pull quote and takeaway appears
verbatim in the post. It refuses to invent copy. Keep it that way.

## Deploy

`andorlabs.ca` is Cloudflare Pages project `andorlabs` tracking
`eclecticv/andor-labs`. **Pushing `main` deploys to production.**
