# Rank My AdTech — the panel design

Supersedes the four-dimension scorer in `2026-08-13-rank-my-adtech-design.md`.
That document's infrastructure sections (no-SSR-on-Pages, D1 over REST, the
deploy hook, why there is no root `wrangler.toml`) still hold and are not
repeated here.

## What changed, and why

The previous version scored companies on the four things And/or Labs sells
against — positioning, content, GTM stack maturity, innovation. It worked, and
it had a structural problem: a scoring tool published by the company that sells
the fix is not a neutral instrument, and three of its four dimensions improve
when you can afford to hire a marketer.

This version measures something the studio does not sell. Three models from
three different labs are handed the same pages and asked the same three
questions; a fourth writes it up. The output is an opinion with visible
provenance rather than a diagnosis with a service attached.

The commercial "here is what would raise your score" line is **deliberately
removed**. It was the single most valuable thing on the old page and it is
incompatible with the claim this version makes.

## The panel

| Seat | Lab | Model | Published spec |
|---|---|---|---|
| 1 | NVIDIA | `nvidia/nemotron-3-super-120b-a12b` | MoE, 120B total / ~12B active |
| 2 | DeepSeek | `deepseek-v4-pro` | MoE, open weights, tier size undisclosed |
| 3 | Google DeepMind | `gemini-3.5-flash` | Undisclosed |
| Writer | OpenAI | `gpt-5.6-luna` | Undisclosed |

Four labs across four roles. Bios carry **published specifications only** — two
of these models document their architecture and two disclose nothing, and the
ones that disclose nothing say so. A fabricated parameter count on a page whose
premise is transparency would discredit everything around it.

Gemini's seat is 3.5 rather than 3.6 because 3.6 and 3.7 return 503 on every
call as of 2026-08-15. The ladder keeps them as lower rungs, since capacity
comes back; see the comment in `providers.ts` for what would justify reverting.

## The nine ratings

Each panelist answers all three questions. Three panelists × three questions =
nine ratings, each `{score 0-10, summary, adjective}`, plus one overall
adjective per panelist.

| Question | Persona | Direction |
|---|---|---|
| Innovation | Commercial veteran, twenty years in adtech | high = novel |
| Hard to build | Distinguished engineer who has built ad servers | high = **difficult** |
| Would you invest | Adtech VC | high = would fund |

**The middle question is scored inverted from how it is asked.** The panelist is
asked whether someone could vibe-code the product in a weekend, but records the
*difficulty*: 10 is years of distributed systems work, 0 is a weekend and an API
key. Scored the other way round, a company could climb the leaderboard by being
trivial to clone, because the other two questions both run good-is-high.

Presentation: each question shows the panel's mean to one decimal, and the
total is the sum of the three means, out of 30. `total` is stored `REAL` — nine
integers averaged three ways land on values like 20.1, and rounding those to
whole numbers would discard exactly the granularity that keeps ranks distinct.

## Determinism

The brief was that re-runs land in roughly the same place and ties are rare.
Three mechanisms, in order of how much they actually contribute:

1. **Anchored scales.** Every band of every 0-10 scale is defined in the prompt
   ("8 — a real insight, executed conventionally"). This turns scoring into
   classification against fixed points instead of inventing a scale per call.
   It is the main lever, and it also spreads scores out, which is what reduces
   ties.
2. **Temperature 0** on identify and all three panel calls. Removes sampling
   noise. The writer runs at 0.8 — prose does not need to be repeatable, and a
   joke sampled greedily is the most obvious joke available. Nothing rankable
   moves when the writer varies.
3. **Pinned seats.** Each panelist's declared model leads its own ladder, so a
   run does not silently swap in a different model and change the answer.

Observed on the first real run: three labs independently returned exactly 4/10
for innovation on the same company. That is the anchors working.

What this does *not* buy: a provider updating a model behind its id will move
scores, and nothing here can detect that.

## Classification

Order of authority, deliberately not left to any single model:

1. **Structural evidence in the markup** — regex over announced rounds, raise
   amounts, accelerator batches, tickers, investor-relations links. Wins
   outright.
2. **The panel's majority recall** — two of three panelists independently naming
   the same round *and* the same year. Not an inference from tone; recall of a
   publicly reported fact, corroborated across three labs that could not see
   each other.
3. **A single model's read** — used only where 1 and 2 found nothing. Marked
   `inferred`.
4. **A safe default** — the middle band, also marked `inferred`.

### The panel votes on facts

Two questions are folded into the panel prompt and resolved by majority:
**subcategory** and **most recent funding round**. They are placed *last* in the
requested JSON so each model generates its three ratings before it thinks about
stage — otherwise "this is a Series C" anchors scores it has not written yet.

This costs zero extra calls and fixed the wobble that made pubX
`adops-agentic` on one run and `curation` on the next. Measured agreement on
category: 2/3 or 3/3 on every company tried.

The round vote requires the **year to match as well as the round**. "series-b"
alone is a coin flip between a handful of options and models collide on it by
chance; "series-b in 2021" is a narrow enough target that agreement is far more
likely to be recall than coincidence. A panelist that names a round but cannot
place a year is told to abstain, and its partial answer is not counted.

Marketing copy is written to sound established, so a model inferring stage from
tone is biased upward by construction. This pipeline has been burned by that
twice.

**Publicly listed companies are refused.** The signals are one-sided — a private
company has no reason to publish an investor-relations section — which is what
makes an outright refusal safe here.

**Bands:** emerging (pre-seed/seed) · growth (Series A–B) · mature (Series C+,
private). Unknown defaults to **growth**, the middle. This is a decision, not a
fallback: emerging exists to let small teams be compared with small teams, so
filling it with unclassifiable companies would defeat its purpose. Mature has
the mirror problem.

**Sides** are derived from subcategory by lookup, never asked for separately.
Two questions with one right answer are one question; asking for both invites
the contradiction where a company is an SSP on the buy side.

Every band decision is stored with its evidence and an `inferred` flag, and the
company page prints both. A guessed band that looks identical to an evidenced
one is the page overstating what it knows.

## The two ranks

Every company carries a position in its cohort and a position in its
subcategory. Both are computed at build time from the sorted board rather than
stored, because a stored rank is wrong the moment the next company ranks.

The leaderboard makes the first rank structural: **tabs are the cohort axis**,
so "3rd in sell-side" is literally a position in one tab. Tabs are radio inputs,
not JavaScript — every tab stays in the HTML and stays crawlable, and a named
radio group is natively arrow-key navigable.

### Why the cohort axis is side, not stage

The original design made stage bands the tabs, with sides nested inside. Three
independent measurements across 28 real adtech sites killed it:

| Signal | Coverage |
|---|---|
| Funding round stated in crawlable markup | **7%** (2/28) |
| Round recalled by ≥2 panelists with a year | **~0%** (0/6) |
| Founding year stated anywhere on the site | **14%** (4/28) |

Stage is not on these websites. Banding on that would have put ~90% of the board
in the middle band by default and left two of three tabs permanently empty — a
structure advertising a distinction the data cannot support.

The tempting fix was to relax the recall requirement so the models would stop
abstaining. That was refused: the abstention is the hallucination filter
*working*, and loosening it manufactures data rather than finding it.

So `BOARD_AXIS` in `src/lib/rankings.ts` is a **one-line constant**, currently
`"side"`. Side derives from a subcategory the panel agrees on (2/3 or 3/3 on
every company measured), so all three tabs populate immediately. Band still
classifies and still appears on a company page — but only as a badge, and only
when something actually evidenced it. Flip the constant to `"band"` the day a
funding-data source is wired in and the original structure returns with nothing
else to change.

Restoring stage bands needs a funding API — Crunchbase, Harmonic, or the Sumble
/ context.dev tier already on hand. It is not obtainable from public pages.

## Tone

The writer's brief: clean, absurdist, tongue-in-cheek, **never punching down**.

That last clause is load-bearing and is not a politeness setting. This board is
mostly small companies, and a model told to be funny about a startup reaches for
the cruelty of scale — small team, no customers, obscure. Those jokes punch down
by definition and are also boring, because the target had no choice in any of
it. The prompt therefore *names* the legitimate targets (the category's
conventions, the claims, the language, how many companies do this same thing)
and names the illegitimate ones explicitly.

## Failure

A ranking publishes complete or not at all. The panel **refuses to sit short**:
if one lab is down, there is no ranking rather than a two-juror one, because
that company's mean would average two opinions while every row around it
averaged three, and the ranks between them would silently stop being comparable.

## Schema

`migrations/0005_panel.sql`. **Archives before it drops** —
`CREATE TABLE ranking_v2 AS SELECT * FROM ranking` — because 0004 dropped
`ranking` outright and cost six rows. Drop `ranking_v2` by hand when you are
sure.

D1 applies a migration atomically. A bare `CREATE INDEX` on an index that
survived from 0004 rolled the entire file back, which is how that was caught
rather than half-applied; indexes on `company` now use `IF NOT EXISTS`.

## Timeouts

Every model call carries a **75-second deadline**. Without one, a provider that
accepts the connection and then goes quiet hangs the ladder forever — it never
fails, so it never advances. Observed locally: a single call held a run for over
ten minutes without erroring.

In production the failure shape is worse than slow: the Function holds its
request open until Cloudflare kills it, so the visitor gets a dropped connection
instead of the designed failure card. A ladder built on "move on when a rung
fails" needs silence to count as failure.

## Known weaknesses

- **Stage is effectively unavailable.** See the coverage table above. Nearly
  every company on the board is `band_inferred = 1` and therefore shows no stage
  badge at all. This is honest but it is a real gap, and it is the reason the
  board is organised by side.
- **Latency is 45–90s** per ranking inside one HTTP request, and occasionally
  worse when a ladder rung has to time out first. Three panel calls run in
  parallel, so this is roughly the slowest single lab plus identify plus writer.
- **The public-company detector misses subdomain IR.** IAS (NASDAQ: IAS) was not
  caught, because its investor relations live on a subdomain the crawler never
  visits. Scibids *was* caught, correctly but incidentally — it links its
  parent's IR since the DoubleVerify acquisition.
- The board has no pagination. At 15 rows per tab with the rest behind a
  `<details>`, it will want revisiting somewhere north of a hundred companies.
