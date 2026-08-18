# Rank My AdTech — radical simplification

**Date:** 2026-08-18
**Status:** approved, implementing
**Replaces:** the four-lab panel (`0005_panel`), which replaced the four-dimension
scorer (`0004_new_dimensions`), which replaced the original adtech-innovation axes.

## The change in one line

Four models producing nine ratings become **one model producing five grades**, and
the board stops being satire and starts being a reference.

## Why

The panel was built on a good argument: three models agreeing is stronger evidence
than one model asserting, and where they split, the split is the most interesting
thing on the page. That argument still holds. It is being given up anyway, for
three reasons the panel cannot answer.

**It bought agreement, not accuracy.** Nine ratings from three models is a wider
sample of the same kind of judgement, not a better one. The board's problem was
never variance.

**The latency budget was spent on redundancy.** `providers.ts` records the
consequence: the NIM ladder leads with a 49B rather than the 550B Ultra because
"a juror that times out is worth less than a slightly smaller juror that answers."
Four calls inside one Cloudflare Pages request forced every seat down-ladder. One
call inverts that — Ultra measured 76.4s against the real prompt on 2026-08-15,
comfortably inside the 120s deadline. **The simplification is what makes the best
available judge affordable.**

**"Would you invest" was measuring the wrong thing.** It asked the model to
imagine a transaction, so anything making that transaction impossible — already
acquired, bootstrapped, too mature — read as a defect in the company. It was a
liquidity question wearing a quality question's clothes.

## The rubric

Five dimensions, each an integer 1–5 against fixed anchors.

| Key | Dimension | The question | 5 requires | 1 means |
|---|---|---|---|---|
| `originality` | Originality | Was this first, or only? | A mechanism the category did not have, and who did not have it | The deck has been circulating since 2016 |
| `defensibility` | Defensibility | What is the single hardest thing here to replicate? | A named bottleneck from the closed list, evidenced on the pages | Nothing supports any bottleneck |
| `traction` | Traction | What proof exists that anyone uses this? | Named customers *and* named integrations, or public volume figures | No customer, integration or number anywhere |
| `execution` | Execution | Does the product surface look built by people who ship? | Real docs, changelog, status page, API reference | A landing page and a contact form |
| `durability` | Durability | Does this still matter in three years? | A structural reason it survives — data rights, contracts, accreditation, entrenchment | Depends on one platform decision going its way |

The closed bottleneck list for `defensibility` carries over from the panel
unchanged: sustained QPS at a latency SLA; count and depth of OpenRTB
integrations; data rights or contracts; compliance and accreditation posture;
supply or demand relationships; proprietary data accumulation.

### Scale mechanics

- Every dimension **starts at 3** and argues up or down with evidence. This is the
  panel's "start at 4, argue upward" recentred for a 1–5 scale, and it exists
  because optimism must cost something while vagueness earns nothing.
- Scoring **above 4** requires pointing at two *different* concrete things on the
  pages. Two restatements of the same claim is one thing.
- Headline grade is the **mean of the five, to one decimal**. Five integers in
  1–5 produce 21 distinct means in 0.2 steps, which ties far less often than a
  five-point scale sounds like it would.
- Letter bands: **A** ≥ 4.5, **B** ≥ 3.5, **C** ≥ 2.5, **D** ≥ 1.5, **E** below.

### The acquired-company rule

Stated in the prompt rather than left to inference, because inference is what
produced the bug:

> Acquisition is an OUTCOME, not a verdict. A company absorbed and still shipping
> under its own name scores high on durability — someone with money concluded it
> would keep mattering. A company absorbed and quietly folded into a suite scores
> low. Never score durability down merely because a company was acquired, and
> never score it up merely because a company is independent.

### What survives from the panel

**The case-against.** Three specific reasons the company is weaker than it looks,
written *before* any score exists. It works — a model that has just written down
what is wrong scores differently from one that has not. The panel generated it and
threw it away (`panel.ts`: "not persisted yet"). It is now **persisted and
published**: with no disagreement spread to show, the case-against becomes the
company page's proof that the grade was reasoned rather than vibed.

**Anchored scales at temperature 0.** Determinism comes from naming what each band
means, not from sampling settings alone.

## Architecture

One call. `crawl` → `classify` → **`grade`** → D1.

`functions/_lib/panel.ts` and `functions/_lib/writer.ts` are deleted and replaced
by `functions/_lib/grader.ts`, which returns in a single response: the
case-against, five grades with one-line justifications, the category, the funding
read, and the verdict prose.

The writer existed because nine ratings from three models needed synthesis. Five
grades from one model do not.

**Model:** `nvidia/nemotron-3-ultra-550b-a55b`, pinned, no ladder beneath it. NIM
is NVIDIA's own inference for NVIDIA's own models, and And/or Labs is an NVIDIA
Inception member — the badge is already in the site hero. A ladder was considered
and rejected: a board whose rows were graded by different models is a board whose
numbers are not comparable to each other, which is the same argument that pinned
each panel seat. A grader that cannot answer fails the submission loudly instead.

**Grader identity is published.** Model name, published specs, temperature and the
full rubric appear on the page. A score from an unnamed "AI" is an appeal to
authority with no authority behind it — that argument gets stronger with one
model, not weaker.

## Data model

Taxonomy is unchanged and already in D1 — no new inference paths:

| Level | Column | Values |
|---|---|---|
| Size class | `company.band` | `emerging` / `growth` / `mature` |
| Category | `company.side` | `buy` / `sell` / `independent` (renders "Infrastructure") |
| Subcategory | `company.category` | the 22 closed keys in `classify.ts` |

`migrations/0006_five_dimensions.sql`:

- `CREATE TABLE ranking_v3 AS SELECT * FROM ranking` — archive before dropping,
  following 0005's precedent. 0004 dropped outright and cost six unrecoverable
  rows; that is not repeated.
- Archive `juror_take` to `juror_take_v3` for the same reason, then drop it. There
  are no jurors now.
- Rebuild `ranking` with `grade REAL CHECK (grade BETWEEN 1 AND 5)` and five
  `INTEGER CHECK (… BETWEEN 1 AND 5)` dimension columns, plus `case_against` (JSON
  array of three strings), `model_used`, and the per-dimension justifications.
- SQLite cannot alter a CHECK constraint, so this is a rebuild, not a rename.

**The 28 existing rows are archived, not re-scored.** There is no honest
arithmetic converting a 0–30 sum of three panel means into five 1–5 grades. The
board therefore ships **empty** and refills from live submissions. This is a
deliberate, accepted trade: an empty leaderboard is a weak advert, and the
alternative was 28 re-crawls of sites that have themselves changed since August.

## Pages

**Board — one dense table, client filter/sort.** Every company on one page: rank,
logo, name, grade, the five dimension marks, subcategory, size class. All rows
ship in the HTML so they stay crawlable and work with scripting off; JS adds
search, sort and filter chips on top. This holds into four figures, where the
current design — one flat `<ol>` per cohort tab with the overflow in a
`<details>` — does not.

`RankRow`'s current payload is three panelist adjectives and a disagreement
spread. Both die with the panel, so the row is rebuilt rather than adjusted.

**Company page** — grade and letter, the five dimensions with their
justifications, the published case-against, the classification with its evidence,
and the grader's identity and rubric.

**Design language.** Built from the site's own tokens and `src/components/ds/*`.
The canonical design-system repo was synced to the site on 2026-08-18 and is a
mirror, not an authority — where they disagree, the site is right.

## Testing

- Rubric shape: five keys, integers 1–5, mean arithmetic, letter-band boundaries
  at exactly 4.5 / 3.5 / 2.5 / 1.5.
- Grader parsing: a valid response, a response with a missing dimension, a
  response with an out-of-range score, prose where JSON was expected.
- Migration: archive tables exist and carry the old row count before the drop.
- The existing `panel-copy` drift test is retargeted at the grader.

## Explicitly not doing

- Re-scoring the 28 archived companies.
- A fallback model ladder for the grader.
- Per-category static pages — the dense table is the whole board.
- Touching the Rank My AdTech WIP in the working tree beyond what this replaces.
