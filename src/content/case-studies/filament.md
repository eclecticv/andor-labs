---
client:
  name: "Filament"
  url: "https://www.wearefilament.com"
  industry: "Human-verified brand safety for YouTube"
serviceLine: "Design Makeover"
summary: "Modernizing a WordPress site into a Next.js build, with Sanity CMS, and WebGL used to render a moving prism in the hero section; signifying the brand's promise of illumination."
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
  - label: "Analytics"
    value: "PostHog"
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
testimonial:
  quote: "VJ brought a thoughtful approach to the UX, positioning, and messaging during the site redesign—and a much-needed ‘been-there-done-that’ perspective to many parts of our business."
  name: "Scott Konopasek"
  title: "Co-founder & COO, Filament"
publishedAt: 2026-07-09
---

## About

Filament helps brands and agencies get more for every dollar spent on YouTube by eliminating 98% of low quality and unsuitable inventory using human-verified, daily updating exclusion lists. The WordPress site used an off-the-shelf theme that Scott Konopasek, Co-founder & COO of Filament, had to manually update and maintain. The design makeover, a focussed sprint that helps adtech startups revamp their positioning, product messaging, design system, and technical architecture, was chosen as the best-fit engagement given the scope of work.

## What we did

As part of the sprint, the founders were presented with three research-backed positioning approaches for the product, with respective pros and cons. After a choice was finalized, we drafted a wireframe, including proposed structure and order of homepage sections and secondary site pages. We chose Next.js as the dev framework for its extensive documentation, SSG with pre-rendered HTML, and vast selection of component samples. For the hero, we implemented a WebGL-based rotating prism taken from the Superdesign prompt library. A micro-animation below the fold visually demonstrates how Filament's double-sweep scan, an AI-based classification followed by human verification, works in practice.

## The result

The core build for the website was completed in just under two weeks, followed by a round of feedback and QA passes for hardening, device responsiveness, and token consistency across the build. Out of the box, the site received excellent PageSpeed and CrUX scores.
