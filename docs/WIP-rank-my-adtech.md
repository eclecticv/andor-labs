# Rank My AdTech — WIP, shelved 2026-08-21

Taken off the site. The engine is intact in this repo; only the public surface
was removed. Restore the deleted routes from **`dff3811`**, the commit
immediately before the removal.

## Why it was shelved

It fails more often than it works. The dominant failure across every recent
submission is `"The panel did not sit"` — one of three pinned seats not
answering, which fails the whole ranking by design because a panel of two is not
comparable to a board of threes.

Recent `rank_job` history: `mediavine.com` failed, `scope3.com` failed twice
before landing on the third attempt, `ad-shield.io` failed, `stackadapt.com`
failed, `id5.io` failed. The same sentence every time.

## What was removed, and what to restore

Deleted (all recoverable from `dff3811`):

| Path | What it was |
|---|---|
| `src/pages/tools/rank-my-adtech.astro` | the tool's landing page and submit form |
| `src/pages/tools/rank-my-adtech/[slug].astro` | company profile pages |
| `src/pages/tools/rank-my-adtech/leaderboard.astro` | the board |
| `functions/api/rank-my-adtech.ts` | the submit + poll endpoint |
| `functions/og/rank/[slug].ts` | per-company OG cards |
| `src/pages/lab/og-rank-my-adtech.astro` | the OG design page |
| `tests/rank-my-adtech.test.ts` | covered the endpoint above |

Edited, each with a dated comment at the site:

- `src/components/sections/Hero.astro` — the homepage CTA is JSX-commented, not
  deleted, so uncommenting is the only step.
- `src/pages/tools/index.astro` — `TOOLS` is now empty and the page states an
  empty shelf rather than rendering an empty `<ul>`.
- `src/components/sections/SiteHeader.astro`, `SiteFooter.astro` — the Tools nav
  entry is gone under the header's own rule ("an index is worth a nav slot once
  it lands on more than one thing").
- `astro.config.mjs` — `/tools/` excluded from the sitemap.
- `src/pages/llms.txt.ts` — the interpolated board is gone. **This one mattered
  most:** it published the full standings as plain text to every crawler without
  rendering a page, so deleting the routes alone would have left the board being
  served.
- `tests/panel-copy.test.ts` — two drift tests are `it.skip`ped because the
  surfaces they compare no longer exist. Un-skip with the pages.

Static assets, which were served at guessable public URLs even with every route
gone:

- `public/og-rank-my-adtech.png` — the tool's social card. `git rm`'d, so it
  comes back from `dff3811` with everything else.
- `public/rank/panel/*.png` — the three dithered juror avatars. These were never
  tracked by git, so they were **moved** to `.scratch/rank-panel-avatars/` rather
  than deleted. They are also regenerable for zero API calls: the raw PixelLab
  PNGs are cached in `.scratch/avatars/` and `scripts/gen-panelist-avatars.mts`
  can re-dither from them without touching the API.

**Kept, deliberately** — this is the engine, not a public sign:
`functions/_lib/*` (facts, panel, classify, crawl, providers, writer, logo,
stack, bands), `src/lib/rankings.ts`, `src/components/ds/Rank*.astro` and
`PanelStrip.astro`, `scripts/rank-local.mts`, `scripts/refresh-facts.mts`,
`migrations/`, and the remaining tests.

**D1 is untouched.** Every company, ranking and panel take is still in
`andor-rankings`. Nothing was dropped.

## Open faults, worst first

**1. A pinned seat misses and the ranking dies.** The panel gives one attempt in
the parallel round and one targeted retry. `mediavine.com` reproduces locally: it
ranks 16/30 in **216s**, but only after Nemotron missed once and the retry
covered it. In production that retry did not save it.

Two contributing causes, one of them self-inflicted:

- The voice samples added to each seat on 2026-08-19 grew every system prompt by
  **81–86%** (~1,200 chars). `dff3811`'s own message ties GLM returning empty to
  exactly this — "after the seats were given personas" — and raised `max_tokens`
  8000 → 16000 to absorb it. Reasoning seats spend that budget thinking before
  they emit a character of JSON.
- `PROVIDER_TIMEOUT_MS` gives **opencode 180s** but leaves **nvidia and gemini at
  `CALL_TIMEOUT_MS` (120s)**. OpenCode got its headroom for precisely the failure
  Nemotron now shows — a reasoning seat overrunning a cap tuned to fast seats.
  Nemotron runs `detailed thinking on` and its brief nearly doubled; its deadline
  did not move. **Untested hypothesis** — the probe that would settle whether
  Nemotron times out or returns no JSON was not run. Run that first.

**2. Zombie `running` rows.** The staleness rule is read-side only: a job flips to
`failed` only when something polls it. With the pipeline held inside its request,
a client that goes away leaves the worker cancelled and the terminal `UPDATE`
never runs — and the job id died with the tab, so nothing will ever poll it. The
row sits `running` forever and the user sees nothing happen at all. This is what
"it still doesn't work" looked like from outside. Needs a write-side terminal
state, or a sweeper.

**3. The board is judged by two different juries.** Voice samples shipped with
*push now, re-rank later* agreed. The six rows ranked before 2026-08-19 were
scored by the old panel; anything after was not. `PANELISTS`' own docblock says
this makes rows incomparable. **Re-rank the whole board before it is public
again.**

**4. The scores are inside their own noise.** Same corpus, same facts,
temperature 0, pinned seats: four runs of one company gave 20, 21, 22, 22, with
individual seat-dimensions moving 3 points between byte-identical inputs. The
Media Trust 22.3 and Confiant 22.0 are separated by less than one company's
spread on identical input. The top of the board was never ordered.

**5. The top score rung has never been used.** `extremely` is 0 of 63 ratings;
83% are `kinda` or `yes`. Effective range is 0–8 on a scale printed as /10. The
rubric gives `yes` and `extremely` one shared evidence bar and never says what
earns the higher one. **The obvious fix was tested and failed** — licensing the
top band moved the ceiling not at all and collapsed the scale to two values. Do
not retry it; the remaining options are structural.

Full measurements and raw runs: `.scratch/facts-experiment/FINDING-2026-08-19.md`.

## What is actually working

Worth keeping in mind, because it is not the reason this was shelved:

- **Entity resolution is fixed.** The Exa lookup used to resolve by company name
  and published an Indian IT-training consultancy as Confiant. It is now anchored
  on the domain, returns `official_website` as a receipt, and refuses any payload
  with zero citations. Verified on `mediavine.com`: founded 2004, New York,
  101-500, 8 grounded fields.
- **The seats are no longer interchangeable.** Unanimity across three lenses fell
  from 44% to 8%, and the three now read as three different people.
