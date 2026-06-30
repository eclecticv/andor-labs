# And/or Labs — website

The And/or Labs homepage (andorlabs.ca). A fast, static, one-page marketing site
built with **Astro** and deployed to **Cloudflare Pages**.

## Design system

The visual language — retro-technical / editorial: white page, literary serif
(Newsreader) + Departure Mono, a faint engineering dot-grid, and a single
technical-blue accent (`#1B4DFF`) — comes from the **And/or Labs Design System**
(a Claude Design project). The React UI kit was ported to a zero-runtime static
implementation here:

- `src/styles/tokens/*` — the design tokens (colors, type, spacing, effects, fonts), verbatim.
- `src/styles/components.css` — component styles lifted from each DS component's `injectCSS` block.
- `src/components/ds/*` — the DS primitives re-authored as `.astro` (Button, Card, Quote, ComparisonTable, …).
- `src/components/sections/*` — the page sections (hero, founder note, comparison, offers, FAQ, chrome).

Only two things ship client JS: the contact drawer toggle and the founder-photo
Bayer dither. The FAQ is native `<details name="faq">` (exclusive accordion, no JS).

## Commands

| Command            | Action                                       |
| :----------------- | :------------------------------------------- |
| `npm install`      | Install dependencies                         |
| `npm run dev`      | Local dev server at `localhost:4321`         |
| `npm run build`    | Build the static site to `./dist/`           |
| `npm run preview`  | Preview the production build locally          |

## Deploy

Continuous deploy via GitHub → Cloudflare Pages.

- **Build command:** `npm run build`
- **Build output directory:** `dist`
- **Framework preset:** Astro

Every push to `main` triggers a Cloudflare Pages build.
