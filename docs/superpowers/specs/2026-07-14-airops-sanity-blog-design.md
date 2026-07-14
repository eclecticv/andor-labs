# AirOps → Sanity → Astro Blog: Autonomous SEO/AEO Growth System (v1, blog-only)

**Date:** 2026-07-14
**Status:** Approved (brainstorm 2026-07-13/14)
**Repo:** `~/Developer/andor-labs` (Astro 7 one-page redesign — the future andorlabs.ca)

## Goal

An autonomous content pipeline: AirOps generates editorial SEO/AEO posts for the And/or Labs audience (adtech founders + GTM), VJ approves each piece inside AirOps, and approved posts publish to a new `/blog` section on andorlabs.ca with no further manual steps. Sanity is the content system of record — chosen deliberately as a headless-CMS administration learning vehicle (skill compounds with Filament, which also runs Sanity).

## Decisions made (with rationale)

| Decision | Choice | Why |
|---|---|---|
| Publish target | `andor-labs` repo (redesign), not the live `website` repo | Nothing built twice; ships with the redesign |
| Autonomy level | Review gate in AirOps | Human taste gate protects the brand; And/or Labs sells content quality |
| Content scope (v1) | Editorial blog posts only | Programmatic library (`libraryEntry` + AirOps Grids) and case-study migration deferred; both layer in later as new schema + route, no rework |
| CMS | Sanity | Native AirOps integration ("fetch, create, update documents"); hosted (no ops liability in an autonomous system); schema-as-code + GROQ + datasets/roles = the content-engineering skillset worth learning; reinforces Filament stack. Strapi rejected (self-host ops burden, reliability weak link); Contentful rejected (shallow admin learning, tight free tier); Payload rejected (no AirOps native integration) |
| Hosting/deploy | Existing Cloudflare Pages (`andorlabs-website` project) | Already git-integrated auto-deploy; Sanity webhook → CF Pages deploy hook = zero custom pipeline code. NOT DigitalOcean — that's Nazdar infrastructure only |
| AEO strategy/monitoring | AirOps' wheelhouse, not ours | Per VJ; we only build on-site plumbing that must live in our HTML |

## Architecture

```
AirOps (topics → drafts → VJ approval → AEO monitoring)
   │  native Sanity integration (write token)
   ▼
Sanity — project with `production` + `staging` datasets, `post` document type
   │  publish webhook
   ▼
Cloudflare Pages deploy hook → Astro static rebuild (GROQ fetch at build time, read token)
   ▼
andorlabs.ca/blog — static pages, JSON-LD, llms.txt, sitemap
```

The live site never depends on Sanity or AirOps at runtime. Failure modes are soft: Sanity down → builds retry, live site untouched; build fails → previous atomic deploy stays live; AirOps misfires → nothing publishes without the approval click.

## Components

### 1. Sanity workspace
- One project; datasets `production` and `staging`.
- Document type `post`: title, slug, excerpt/meta description, body (Portable Text), publish date, tags/topic, SEO fields (target keyword/question), optional hero image.
- Studio lives in this repo, schema as code, versioned in git.
- Tokens: write-scoped for AirOps, read-only for Astro builds (never one god-token).

### 2. Astro integration (the only custom code)
- `@sanity/astro` + Portable Text renderer; build-time GROQ only.
- Routes: `/blog` index + `/blog/[slug]`; templates follow the existing design system (grid↔white section rhythm, Departure Mono / Instrument Serif, prism restraint).
- AEO plumbing in templates: JSON-LD `Article`, answer-first structure, `llms.txt`, sitemap entries.
- Proper 404 for unknown slugs — fix the CF Pages catch-all-200 fallback (SEO crawl hygiene).

### 3. AirOps configuration (no code)
- Brand kit + knowledge base: positioning, VJ voice, ICP (adtech founders + GTM).
- One editorial workflow: keyword/topic → brief → draft → **approval step (VJ)** → publish to Sanity as `post`.
- AI-visibility monitoring configured inside AirOps; citation gaps feed its own topic queue.

### 4. Wiring
- Sanity publish webhook → CF Pages deploy hook URL.
- Note: the CF Pages project currently points at the old `website` repo; repointing to `andor-labs` happens when the redesign ships (out of scope here, but the deploy hook we create survives it).

## Explicitly not building (v1)
Programmatic `libraryEntry` pages, case-study migration, custom webhook receivers, CI workflows, AEO dashboards, cron/scheduling, any CMS UI beyond Sanity Studio.

## Sequencing
Buildable and testable now against CF Pages previews / staging dataset; content can accumulate in Sanity before the redesign launches, so the SEO clock starts pre-launch.

## Success criteria
1. A post approved in AirOps appears on the deployed `/blog` with zero manual steps.
2. Live site survives Sanity/AirOps outages (verify: block network at build, confirm previous deploy persists).
3. Blog pages pass Rich Results / schema validation; `llms.txt` and sitemap serve correctly.
4. VJ can administer Sanity (schema change → deploy → content migration) end to end.
