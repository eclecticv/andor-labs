# AirOps → Sanity → Astro Blog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/blog` on andorlabs.ca where posts approved in AirOps publish autonomously via Sanity and a Cloudflare Pages rebuild — zero manual steps after VJ's approval click.

**Architecture:** Sanity (embedded Studio at `/admin`, schema-as-code in this repo) is the content system of record. Astro fetches posts with GROQ at build time only — the deployed site is fully static. A Sanity publish webhook hits a CF Pages deploy hook to rebuild. AirOps writes to Sanity through its native integration using a write-scoped token.

**Tech Stack:** Astro 7 (this repo), `@sanity/astro`, `sanity` (Studio v4), `astro-portabletext`, `@astrojs/sitemap`, Cloudflare Pages.

## Global Constraints

- Node >= 22.12 (repo `engines`); local is v22.23.1.
- `@astrojs/react` stays at `^6` — v5 breaks on Astro 7 (known repo gotcha).
- Dev server runs via `portless andor npm run dev` → https://andor.localhost (never raw `:4321` in docs/links).
- Blog templates use the existing design system: tokens in `src/styles/tokens/`, components in `src/components/ds/`, section rhythm alternates grid↔white, no white text on rose (use navy).
- Datasets: `production` and `staging`. Builds read public `production` — no read token in CI. The only secret anywhere is AirOps' write token, which lives in AirOps, never in this repo or CF Pages.
- Manual steps VJ must do himself (Sanity manage console, CF dashboard, AirOps UI) are marked **[VJ]** — they are part of the CMS-administration learning goal, don't automate them away.
- Verification is build-and-assert (`npm run build` + grep of `dist/`): this repo has no unit-test framework and templates/config don't warrant adding one.

---

### Task 1: Sanity project, embedded Studio, `post` schema

**Files:**
- Create: `sanity.config.ts`, `sanity/schemaTypes/index.ts`, `sanity/schemaTypes/post.ts`
- Modify: `astro.config.mjs`, `.gitignore` (ensure `.env` ignored), `tsconfig.json` only if `npx astro check` complains
- Test: build + browser check of `/admin`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: Sanity project ID (call it `PROJECT_ID` below); document type `post` with fields `title` (string), `slug` (slug), `excerpt` (text), `publishedAt` (datetime), `tags` (array of strings), `targetQuery` (string), `heroImage` (image, optional), `body` (Portable Text array). Later tasks import nothing from these files directly — they query via `sanityClient` from `sanity:client`.

- [ ] **Step 1 [VJ]: Create the Sanity project**

At https://www.sanity.io/manage → create project "And/or Labs" (free plan). Note the project ID. Create datasets: `production` (public) and `staging` (public). Paste the project ID into the chat so the implementer can substitute `PROJECT_ID` everywhere below.

- [ ] **Step 2: Install dependencies**

```bash
cd ~/Developer/andor-labs
npm install @sanity/astro sanity astro-portabletext styled-components @astrojs/sitemap
```

(`styled-components` is a required peer dep of Sanity Studio; `@astrojs/sitemap` is used in Task 4 but installed once here.)

- [ ] **Step 3: Write the schema**

`sanity/schemaTypes/post.ts`:
```ts
import {defineField, defineType} from "sanity";

export const post = defineType({
  name: "post",
  title: "Post",
  type: "document",
  fields: [
    defineField({name: "title", type: "string", validation: (r) => r.required()}),
    defineField({
      name: "slug",
      type: "slug",
      options: {source: "title", maxLength: 96},
      validation: (r) => r.required(),
    }),
    defineField({
      name: "excerpt",
      title: "Excerpt / meta description",
      type: "text",
      rows: 3,
      validation: (r) => r.required().max(160),
    }),
    defineField({name: "publishedAt", type: "datetime", validation: (r) => r.required()}),
    defineField({name: "tags", type: "array", of: [{type: "string"}]}),
    defineField({
      name: "targetQuery",
      title: "Target keyword / question",
      description: "The search query or AI-engine question this post answers.",
      type: "string",
    }),
    defineField({name: "heroImage", type: "image", options: {hotspot: true}}),
    defineField({
      name: "body",
      type: "array",
      of: [{type: "block"}, {type: "image", options: {hotspot: true}}],
      validation: (r) => r.required(),
    }),
  ],
  preview: {
    select: {title: "title", subtitle: "excerpt", media: "heroImage"},
  },
});
```

`sanity/schemaTypes/index.ts`:
```ts
import {post} from "./post";

export const schemaTypes = [post];
```

`sanity.config.ts` (repo root — project ID is a public identifier, safe to hardcode):
```ts
import {defineConfig} from "sanity";
import {structureTool} from "sanity/structure";
import {schemaTypes} from "./sanity/schemaTypes";

export default defineConfig({
  name: "andorlabs",
  title: "And/or Labs",
  projectId: "PROJECT_ID",
  dataset: "production",
  plugins: [structureTool()],
  schema: {types: schemaTypes},
});
```

- [ ] **Step 4: Wire the integration into Astro**

`astro.config.mjs` — replace the whole file:
```js
// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sanity from '@sanity/astro';

// https://astro.build/config
export default defineConfig({
  site: 'https://andorlabs.ca',
  integrations: [
    sanity({
      projectId: 'PROJECT_ID',
      dataset: 'production',
      useCdn: false, // static build — always fresh content
      studioBasePath: '/admin',
      studioRouterHistory: 'hash',
    }),
    // React powers the embedded Studio and the dev-only Agentation island (see Base.astro).
    react(),
  ],
});
```

- [ ] **Step 5: Verify dev server + Studio**

```bash
portless andor npm run dev
```
Open https://andor.localhost/admin — Studio loads, prompts Sanity login, shows "Post" in the structure pane. **[VJ]** log in with the Sanity account. If the page is blank, check the browser console (known repo gotcha: preamble errors don't show in curl).

- [ ] **Step 6: Verify build**

```bash
npm run build
```
Expected: completes without errors; `dist/admin/index.html` exists.

- [ ] **Step 7: Commit**

```bash
git add sanity.config.ts sanity/ astro.config.mjs package.json package-lock.json
git commit -m "feat: add Sanity integration, embedded Studio at /admin, post schema"
```

---

### Task 2: Seed content + `/blog` index page

**Files:**
- Create: `src/pages/blog/index.astro`
- Test: build + grep dist

**Interfaces:**
- Consumes: `post` documents in Sanity `production`; `sanityClient` from `sanity:client`.
- Produces: route `/blog`; GROQ list query other tasks reuse: `*[_type == "post" && defined(slug.current)] | order(publishedAt desc)`.

- [ ] **Step 1 [VJ]: Seed two posts in Studio**

At https://andor.localhost/admin create and **publish** two posts with real-ish titles, excerpts, a few body paragraphs, `publishedAt` set. (Two, so ordering is verifiable.)

- [ ] **Step 2: Write the index page**

`src/pages/blog/index.astro`:
```astro
---
import { sanityClient } from "sanity:client";
import Base from "../../layouts/Base.astro";

interface PostCard {
  title: string;
  slug: string;
  excerpt: string;
  publishedAt: string;
  tags?: string[];
}

const posts: PostCard[] = await sanityClient.fetch(
  `*[_type == "post" && defined(slug.current)] | order(publishedAt desc){
    title, "slug": slug.current, excerpt, publishedAt, tags
  }`
);

const fmt = (d: string) =>
  new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
---

<Base
  title="Blog — And/or Labs"
  description="Educational content on B2B marketing, content strategy, and sales ops for adtech founders."
>
  <main class="blog-index">
    <h1>Blog</h1>
    <ul>
      {posts.map((post) => (
        <li>
          <a href={`/blog/${post.slug}/`}>
            <h2>{post.title}</h2>
            <time datetime={post.publishedAt}>{fmt(post.publishedAt)}</time>
            <p>{post.excerpt}</p>
          </a>
        </li>
      ))}
    </ul>
  </main>
</Base>
```

This is functional markup — after it builds, restyle it with the design system (`src/components/ds/Card.astro`, `Link.astro`, section rhythm per `src/pages/index.astro`) and preview at https://andor.localhost/blog before calling the task done (visual-quality standard).

- [ ] **Step 3: Verify build output**

```bash
npm run build && grep -l "Blog — And/or Labs" dist/blog/index.html && grep -c "<li>" dist/blog/index.html
```
Expected: file path prints; `<li>` count is 2.

- [ ] **Step 4: Commit**

```bash
git add src/pages/blog/index.astro
git commit -m "feat: blog index page fed by Sanity GROQ at build time"
```

---

### Task 3: Post detail page with Portable Text + Article JSON-LD

**Files:**
- Create: `src/pages/blog/[slug].astro`
- Test: build + grep dist

**Interfaces:**
- Consumes: GROQ list query from Task 2; `PortableText` from `astro-portabletext`; `Base` layout props `title`, `description`.
- Produces: route `/blog/<slug>/`; JSON-LD `Article` in each post's `<head>`-adjacent markup.

- [ ] **Step 1: Write the detail page**

`src/pages/blog/[slug].astro`:
```astro
---
import { sanityClient } from "sanity:client";
import { PortableText } from "astro-portabletext";
import Base from "../../layouts/Base.astro";

export async function getStaticPaths() {
  const posts = await sanityClient.fetch(
    `*[_type == "post" && defined(slug.current)]{
      title, "slug": slug.current, excerpt, publishedAt, tags, targetQuery, body
    }`
  );
  return posts.map((post: any) => ({ params: { slug: post.slug }, props: { post } }));
}

const { post } = Astro.props;

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: post.title,
  description: post.excerpt,
  datePublished: post.publishedAt,
  author: { "@type": "Person", name: "Vishveshwar Jatain", url: "https://andorlabs.ca" },
  publisher: { "@type": "Organization", name: "And/or Labs", url: "https://andorlabs.ca" },
  mainEntityOfPage: new URL(`/blog/${post.slug}/`, Astro.site).href,
};
---

<Base title={`${post.title} — And/or Labs`} description={post.excerpt}>
  <script type="application/ld+json" set:html={JSON.stringify(jsonLd)} />
  <main class="blog-post">
    <article>
      <header>
        <h1>{post.title}</h1>
        <time datetime={post.publishedAt}>
          {new Date(post.publishedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
        </time>
        <p class="excerpt">{post.excerpt}</p>
      </header>
      <PortableText value={post.body} />
    </article>
  </main>
</Base>
```

Answer-first structure: the excerpt renders directly under the H1 before the body — keep that in the design pass (AEO: engines lift the first on-page answer).

- [ ] **Step 2: Verify build output**

```bash
npm run build && ls dist/blog/ && grep -l 'application/ld+json' dist/blog/*/index.html
```
Expected: one directory per seeded slug; both post files contain JSON-LD.

- [ ] **Step 3: Validate the structured data**

Paste one built post's HTML (or the deployed preview URL later) into https://validator.schema.org — `Article` parses with no errors.

- [ ] **Step 4: Design-system pass + visual preview**

Restyle index + detail with `ds/` components and tokens; preview https://andor.localhost/blog and one post page. Do not mark done without looking.

- [ ] **Step 5: Commit**

```bash
git add src/pages/blog/
git commit -m "feat: blog post pages with Portable Text and Article JSON-LD"
```

---

### Task 4: AEO/SEO plumbing — sitemap, llms.txt, real 404

**Files:**
- Create: `src/pages/llms.txt.ts`, `src/pages/404.astro`
- Modify: `astro.config.mjs` (add sitemap integration)
- Test: build + file assertions

**Interfaces:**
- Consumes: GROQ list query from Task 2.
- Produces: `dist/sitemap-index.xml`, `dist/llms.txt`, `dist/404.html` (CF Pages automatically serves `404.html` with a real 404 status for unknown routes — this replaces the current serve-index-with-200 behavior).

- [ ] **Step 1: Add sitemap integration**

In `astro.config.mjs`, add to imports and integrations:
```js
import sitemap from '@astrojs/sitemap';
// integrations: [ sanity({...}), react(), sitemap() ]
```

- [ ] **Step 2: Write the llms.txt endpoint**

`src/pages/llms.txt.ts`:
```ts
import type { APIRoute } from "astro";
import { sanityClient } from "sanity:client";

export const GET: APIRoute = async ({ site }) => {
  const posts: { title: string; slug: string; excerpt: string }[] =
    await sanityClient.fetch(
      `*[_type == "post" && defined(slug.current)] | order(publishedAt desc){
        title, "slug": slug.current, excerpt
      }`
    );

  const lines = [
    "# And/or Labs",
    "",
    "> The GTM OS for adtech startups: positioning, content engineering, and sales intelligence for early-stage adtech companies.",
    "",
    "## Blog",
    "",
    ...posts.map((p) => `- [${p.title}](${new URL(`/blog/${p.slug}/`, site).href}): ${p.excerpt}`),
  ];
  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
```

- [ ] **Step 3: Write the 404 page**

`src/pages/404.astro`:
```astro
---
import Base from "../layouts/Base.astro";
---
<Base title="Page not found — And/or Labs" description="That page doesn't exist.">
  <main class="not-found">
    <h1>404</h1>
    <p>That page doesn't exist. <a href="/">Back to the homepage</a> or <a href="/blog/">read the blog</a>.</p>
  </main>
</Base>
```

- [ ] **Step 4: Verify build artifacts**

```bash
npm run build && ls dist/sitemap-index.xml dist/llms.txt dist/404.html && grep -c "blog/" dist/llms.txt
```
Expected: all three files exist; llms.txt references both seeded posts.

- [ ] **Step 5: Commit**

```bash
git add src/pages/llms.txt.ts src/pages/404.astro astro.config.mjs
git commit -m "feat: sitemap, llms.txt endpoint, and real 404 page"
```

---

### Task 5: Deploy — CF Pages project + Sanity publish webhook

**Files:** none in repo (dashboard configuration) — record outcomes in `docs/superpowers/plans/2026-07-14-airops-sanity-blog.md` as checked boxes.

**Interfaces:**
- Consumes: the repo on GitHub; Sanity project from Task 1.
- Produces: a live preview URL (`andor-labs.pages.dev` or similar); a deploy-hook URL consumed by Sanity's webhook; the pattern AirOps publishes into in Task 6.

- [ ] **Step 1: Ensure the repo is on GitHub**

```bash
git remote -v
```
If no remote: `gh repo create eclecticv/andor-labs --private --source=. --push`. Otherwise `git push`.

- [ ] **Step 2 [VJ]: Create the CF Pages project**

Cloudflare dashboard (And/or Labs account) → Workers & Pages → Create → Pages → connect `eclecticv/andor-labs`. Build command `npm run build`, output `dist`, production branch `main`. No env vars needed. First deploy runs; note the `*.pages.dev` URL. (Domains stay on the old `andorlabs-website` project until the redesign ships — this project runs in parallel until then.)

- [ ] **Step 3 [VJ]: Create the deploy hook**

Pages project → Settings → Builds & deployments → Deploy hooks → create hook named `sanity-publish` targeting `main`. Copy the URL.

- [ ] **Step 4 [VJ]: Create the Sanity webhook**

https://www.sanity.io/manage → project → API → Webhooks → create:
- URL: the deploy-hook URL from Step 3 (method POST)
- Dataset: `production`
- Trigger on: create, update, delete
- Filter: `_type == "post"`

- [ ] **Step 5: End-to-end publish test**

In Studio, edit a seeded post's title and publish. Watch CF Pages start a build within ~1 min; when it finishes, the changed title is live on `https://<project>.pages.dev/blog/`. Also verify `curl -s -o /dev/null -w "%{http_code}" https://<project>.pages.dev/nonexistent` returns **404**.

---

### Task 6: AirOps — connection, brand kit, editorial workflow, E2E

**Files:** none (AirOps + Sanity dashboards). All steps **[VJ]** with the implementer guiding.

**Interfaces:**
- Consumes: Sanity `post` schema (field names from Task 1 exactly: `title`, `slug`, `excerpt`, `publishedAt`, `tags`, `targetQuery`, `body`); the live pipeline from Task 5.
- Produces: the operating system — an AirOps workflow whose approval step is the only human action between topic and live page.

- [ ] **Step 1 [VJ]: Create the AirOps write token**

Sanity manage → API → Tokens → new token "airops-publisher", role **Editor** (write, no admin). Paste it only into AirOps' Sanity connection screen. It must never appear in this repo, CF Pages, or chat.

- [ ] **Step 2 [VJ]: Connect Sanity in AirOps**

AirOps → integrations → Sanity → project ID + `production` dataset + the token. Confirm AirOps can list the `post` type.

- [ ] **Step 3 [VJ]: Load brand context**

Brand kit / knowledge base: And/or Labs positioning (verbatim from Site structure.md — no paraphrasing), ICP (adtech founders + GTM), voice notes (from `vj-writing-voice` material), 2–3 seeded posts as exemplars.

- [ ] **Step 4 [VJ]: Build the editorial workflow**

Topic/keyword input → brief → draft → **approval step (VJ)** → publish to Sanity mapping: post title→`title`, slugified title→`slug`, meta description→`excerpt` (≤160 chars — schema validation will reject longer), now→`publishedAt`, topic→`targetQuery`, body→`body`. Configure AirOps' AI-search monitoring per their onboarding — their wheelhouse, not spec'd here.

- [ ] **Step 5: Full E2E acceptance test**

Run the workflow on one real topic → approve in AirOps → post appears in Sanity → webhook fires → CF build → post live on `/blog` with valid JSON-LD, listed in `llms.txt` and sitemap. **Zero manual steps after the approval click = success criterion #1 met.**

- [ ] **Step 6: Record completion**

Update this plan's checkboxes; add a review section to the spec noting deviations, if any.
