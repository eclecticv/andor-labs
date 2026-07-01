# And/or Labs — "Final Polish" Pass (Design Spec)

**Date:** 2026-06-30
**Scope:** A detail/interaction polish pass on the one-page site (`andor-labs.localhost`), applying two skills in order — `emil-design-eng` (interaction craft) then `make-interfaces-feel-better` (micro-detail sweep).
**Mandate:** "Bolder — push it further," constrained by `.impeccable.md`: *refine within the system, never reinvent.* Every change reinforces the one brand idea — **the page behaves like a live technical instrument** (figures being plotted and measured). Anything that reads as generic SaaS (soft glow, springy/elastic easing, sans fallback, decorative motion, a second accent) is out of scope by definition.

## Constraints (from `.impeccable.md`, non-negotiable)
- Two type voices only: Newsreader serif (read) + Departure Mono (label/measure). No sans, no third face.
- Monotone ink ramp on pure white; blue `#1B4DFF` is the ONLY accent, ~10% weight.
- Hard offset **block** shadows only (`--shadow-hard*`); the one soft shadow is reserved for overlays.
- Radii cap ~5px; quick **mechanical** motion (`--ease-out`, no bounce/elastic — `--ease-snap` used sparingly, never for entrances).
- WCAG AA contrast; all motion gated on `prefers-reduced-motion`; keyboard-complete.
- Do not clobber the in-flight motion layer (`SiteMotion.astro`, `motion.css`) — layer onto it.

## Baseline (already strong — do not redo)
Focus trap + `inert` drawer, `:focus-visible` ring, hard-shadow press physics on buttons/cards, wavy blue links with arrow nudge, gated hero assembly + self-drawing growth curve, IntersectionObserver reveals, `::selection`, `text-wrap: balance/pretty`, reduced-motion kill-switch.

---

## Tier 1 — Invisible refinements (`make-interfaces-feel-better`)
Details a visitor feels but can't name. Low risk, confirmed against the codebase.

1. **Nav + footer link states.** `.site-nav-link` (SiteHeader) and footer/social links (SiteFooter, inline `linkStyle`) have **no** hover/active/transition. Add hover-to-blue (`--ink-700` → `--blue-600`) with `--dur-base`, plus a wavy-underline reveal on the footer links (matches the link vocabulary). Move the inline styles into `.site-nav-link` / a `.aol-flink` class in `site.css` so state rules can attach.
2. **FAQ summary hover tint.** `.faq-q` declares `transition: background` but has no `:hover` rule (dead transition, no pre-click affordance). Add `.faq-q:hover { background: var(--ink-050) }` (closed rows only; `[open]` keeps blue-050).
3. **Gate `scroll-behavior: smooth`** behind `@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto } }` in `site.css`.
4. **`font-variant-numeric: tabular-nums`** on the mono measuring voice (`.aol-eyebrow`, `.aol-mono`) and price figures (Offers) — reinforces the technical-figure identity; digits are proportional today.
5. **`-moz-osx-font-smoothing: grayscale`** on `body` (base.css) to match the webkit antialiasing already set.
6. **FAQ toggle `+`/`−` eased.** The `.faq-toggle` bg/color swap is instant while the panel height eases; add a `--dur-base` transition on background/color so they resolve together.
7. **`Link` no-JS `href` fallback.** `data-open-contact` links default `href="#"` (jump to top if JS off) — point at `#faq`/a real anchor as graceful degradation.

## Tier 2 — Signature moments (`emil-design-eng`)
Considered interaction; the page moves with one hand.

8. **Unified motion vocabulary.** `Button`'s hover arrow gets the same `translateX(3px)` nudge `Link.aol-link__arrow` already has (add `.aol-btn:hover .aol-btn__icon { transform: translateX(2px) }`, gated so it doesn't fight the `:active` press). Harmonize hover/press easing + durations across buttons, cards, quotes.
9. **Nav scroll-spy — "you are here."** The most on-brand sophistication beat: mark the active section in the technical register. A thin blue registration underline / `+` tick that snaps to the current nav item, driven by `aria-current="true"` set from the existing IntersectionObserver in `SiteMotion.astro` (extend it — do not add a second observer). Reduced-motion → instant swap, no slide.
10. **Extend figure-hover press** to the FounderNote `Quote sm` cards (they currently get no lift; only `.aol-quote--figure` does) — for hover-affordance consistency. Gated for reduced-motion like the existing card rules.

## Tier 3 — Bold beats (the requested "sophistication") — BOTH
11. **★ Hero FIG.01 live crosshair readout.** On pointer-move over the growth chart, a thin blue crosshair tracks the plotted curve with a small Departure-Mono readout (a coordinate like `T+18 · ▲ pipeline`). Makes the hero a live instrument you can probe. Progressive enhancement: pointer-only, keyboard/touch shows nothing extra (curve still animates on load), honors reduced-motion (crosshair appears but without transitions). Implemented as a small script in `Hero.astro` (or a co-located island) reading the existing SVG path; no new dependency.
12. **Section "plot-in" reveal.** Upgrade the uniform `translateY` reveal so each section's crop-tick frame / rule draws *first*, then content fills — sections assemble like drawings. Applied via a `.reveal` refinement in `motion.css` using the existing `.is-in` hook; keep it subtle and fast (≤ existing `--dur-slow`), fully gated on reduced-motion (→ instant, fully visible). Must not regress the no-JS fully-visible fallback.

---

## Skill sequencing
1. Invoke **`emil-design-eng`** → apply Tier 2 + Tier 3 (interaction craft, signature beats, easing/restraint calls).
2. Invoke **`make-interfaces-feel-better`** → apply Tier 1 (micro-detail sweep).

## Files touched
- `src/styles/tokens/base.css` — font-smoothing (Tier 1.5).
- `src/styles/tokens/typography.css` — tabular-nums on mono classes (Tier 1.4).
- `src/styles/site.css` — nav/footer link states, FAQ hover tint, reduced-motion scroll gate, faq-toggle easing (Tier 1.1/1.2/1.3/1.6), scroll-spy underline styles (Tier 2.9).
- `src/styles/components.css` — button arrow nudge (Tier 2.8), Offers price tabular-nums if needed.
- `src/styles/motion.css` — quote-sm hover (Tier 2.10), section plot-in reveal (Tier 3.12).
- `src/components/sections/SiteHeader.astro` — nav markup for scroll-spy + class extraction (Tier 1.1/2.9).
- `src/components/sections/SiteFooter.astro` — footer link class extraction (Tier 1.1).
- `src/components/sections/Hero.astro` — crosshair readout (Tier 3.11).
- `src/components/SiteMotion.astro` — extend observer to set `aria-current` for scroll-spy (Tier 2.9).
- `src/components/ds/Link.astro` — no-JS href fallback (Tier 1.7).

## Verification
- `astro dev` running; visually preview the rendered site (hover states, scroll-spy, crosshair, plot-in) before declaring done.
- Toggle `prefers-reduced-motion` and confirm every beat degrades to instant/visible.
- Keyboard-tab through nav/links/FAQ/drawer; confirm focus rings + no regressions.
- No new console errors; no-JS renders fully visible.

## Out of scope
New sections/content, copy changes, color/font changes, dark mode, any second accent, springy easing, soft shadows on non-overlay surfaces.
