---
client:
  name: "Filament"
  url: "https://www.wearefilament.com"
  industry: "Human-verified brand safety for YouTube & CTV"
serviceLine: "Design Makeover"
summary: "Modernizing a WordPress site into a Next.js build, with Sanity CMS, and WebGL used to render a moving prism in the hero—signifying the brand's promise of illuminating waste."
before:
  image: "/case-studies/filament/before-hero.png"
  alt: "Filament's legacy WordPress homepage — bright purple and pink layout with a 'Reduce Wasted YouTube Ad Spend' headline"
after:
  type: "site"
  src: "https://www.wearefilament.com/us-en"
  alt: "Filament's new homepage hero — a dark, WebGL prism-light animation behind the headline"
stack:
  - label: "Framework"
    value: "Next.js 16"
  - label: "CMS"
    value: "Sanity"
  - label: "Styling"
    value: "Tailwind CSS v4"
  - label: "Codebase"
    value: "14,693 LOC / 148 files"
  - label: "Build window"
    value: "9 days (Mar 3–12, 2026)"
performance:
  - metric: "Accessibility (Lighthouse)"
    value: "93 / 100"
    source: "Live Lighthouse audit, mobile emulation, captured 2026-07-09"
  - metric: "SEO (Lighthouse)"
    value: "100 / 100"
    source: "Live Lighthouse audit, mobile emulation, captured 2026-07-09"
  - metric: "Largest Contentful Paint"
    value: "1.09s"
    source: "Live performance trace, unthrottled, captured 2026-07-09"
  - metric: "Cumulative Layout Shift"
    value: "0.00"
    source: "Live performance trace, unthrottled, captured 2026-07-09"
changes:
  - before: "Legacy WordPress, no structured content"
    after: "Sanity CMS with 13+ typed schemas, editable by non-engineers"
  - before: "No analytics instrumentation"
    after: "Standardized CTA event tracking + first-party-proxied PostHog"
  - before: "Static brand presentation"
    after: "Live WebGL hero animation, animated verification and stat counters"
publishedAt: 2026-07-09
---

## The problem

Filament sells human-verified brand safety—real people reviewing real inventory. Their own website was still running on WordPress. One market, zero analytics, no room for the two more markets already on the roadmap.

## The approach

We started March 3. What does "rebuilt" actually mean in nine days? Next.js and Sanity live, the old WordPress content migrated structure and all, three markets with real localized pages. Then we handed the keys over.

## The result

Nine days, start to handoff. Four months and sixty-one commits later, nobody's had to touch the bones—Filament's own team just keeps shipping on top of it.
