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
  quote: "VJ brought a thoughtful approach to the UX, positioning, and messaging during the site redesign process—and a much-needed ‘been-there-done-that’ perspective to many parts of our business."
  name: "Scott Konopasek"
  title: "Co-founder & COO, Filament"
publishedAt: 2026-07-09
---

## About

Filament helps brands and agencies improve their YouTube ROAS by eliminating 98% of low quality and unsuitable inventory using human-verified, daily updating exclusion lists. The WordPress site used an off-the-shelf theme that Scott Konopasek, Co-founder & COO of Filament, had to manually maintain. The design makeover, a sprint that helps startups revamp their positioning, messaging, and design system, was chosen as the right-fit.

## What we did

As part of the sprint, the founders were presented with three research-backed positioning approaches, with pros and cons highlighted for each. After a positioning was finalized, we drafted a wireframe, including homepage sections and secondary pages. We chose Next.js as the dev framework for its extensive documentation, SSG with pre-rendered HTML, and vast selection of components. For the hero, we used a WebGL-based prism taken from the Superdesign prompt library as the visual centrepiece. A micro-animation below demonstrates how the Filament "double-sweep"—an AI-based classification coupled with human verification—works in practice.

## The result

The core build for the website was completed in under two weeks, followed by QA passes for hardening, responsiveness, and ensuring token consistency. Out of the box, the site received excellent PageSpeed and CrUX scores during initial testing. Using Sanity as the headless CMS opens up the possibility of setting up autonomous content pipelines to optimize brand visibility across search and AI chatbots. The codebase and design system for the site are hosted in a GitHub repo, which makes for easy updates via coding agents like Codex, Claude Code, etc.
