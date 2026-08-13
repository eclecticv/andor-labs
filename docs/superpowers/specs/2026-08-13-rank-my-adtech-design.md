# Rank My AdTech — design

**Date:** 2026-08-13
**Status:** approved design, not yet planned
**Surface:** `/tools/rank-my-adtech` on andorlabs.ca

---

## 1. What this is

A free tool that is also a public leaderboard. A visitor submits a work email and a
company domain. A cheap classifier decides whether the company is adtech. If it is,
three models from three independent providers score it on four axes, a fourth model
writes the verdict, and the ranking is published immediately into a public board.

The tool and the board live on one page. Every ranked company also gets its own page.

It is a bit. The tone is light and slightly over the top, and a company that scores
badly should finish reading and understand it was a joke at the expense of its
positioning rather than an attack on its people.

### Goal

Grade **who is truly innovative** in adtech, in a way that is fair to a company
incorporated last week and to The Trade Desk simultaneously.

### Non-goals

Being a rigorous analyst product. Being comprehensive. Being neutral in tone.

---

## 2. Decisions taken

| # | Decision | Choice |
|---|---|---|
| 1 | Who can be ranked | Anyone. Any company can be submitted; results auto-publish |
| 2 | Jury shape | Panel of 3 independent models, in parallel, then a synthesizer |
| 3 | Storage + render | D1, with `@astrojs/cloudflare` and per-route `prerender = false` |
| 4 | Scoring | Four axes to 100, weighted toward innovation |
| 5 | Non-adtech | Hard reject before the panel runs |
| 6 | Fair comparison | Three weight classes, each with its own ranked table |

Decision 1 was taken with the reputational exposure explicitly on the table. The
mitigations that survive are: comedic framing throughout, a visible "model-generated
opinion" disclosure on every row and every company page, and a removal path.

---

## 3. Tone

The register is a boxing undercard announced by someone who likes the sport.
Confident, quick, fond of the participants. Never sneering.

**Rules for the synthesizer prompt:**

1. Punch at the positioning, the category, or the copy. Never at named people.
2. Every roast leaves a door open — say what would raise the score.
3. No fabricated facts. Everything traces to the fetched page or a juror's words.
4. Short sentences. One joke per paragraph, not three.
5. Never claim a company is failing, fraudulent, or in financial trouble.

**Worked example of a low score:**

> **Vectorly** — 31/100 · Featherweight · *Provisional evidence*
>
> **The verdict.** Three models read your homepage. All three independently
> arrived at "retargeting, but it says AI now." That is not nothing! It is,
> however, also not much. The panel wants you to know it is rooting for you.
>
> **The split.** Nemotron was the kind one, arguing there's a real insight buried
> under the copy. Grok was not the kind one.
>
> *"Defensibility: a weekend, and one of the days is optional."* — grok-4.6

---

## 4. Scoring

Four axes, 100 points. 65 of those points are innovation proper.

| Axis | Pts | Question | Icon |
|---|---|---|---|
| **Paradigm** | 40 | Does this assume the world of 2026, or 2016 with an AI badge stapled on? | `shapes` |
| **Non-obviousness** | 25 | Is the insight one that wasn't already in everyone else's deck? | `lightbulb` |
| **Vibe-code test** | 20 | Could a competent engineer rebuild the core in a weekend with current tools? | `laptop-code` |
| **Conviction** | 15 | One real position, or hedging across five categories to look bigger? | `flag` |

### Why these axes and not the obvious ones

Defensibility, platform risk, wedge strength and traction all correlate with company
size. Scoring them means an incumbent maxes them by existing and a seed company loses
before anyone reads what it does — which would produce a leaderboard of large
companies and measure the opposite of innovation.

These four axes are **stage-neutral by construction**: each is something a
three-person team and a public company can both max out, and neither gets for free.
A large company can ship a thin wrapper. A tiny team can be doing something genuinely
hard. Defensibility survives, reframed as the vibe-code test. Platform risk is cut
from scoring and retained as an unscored note.

### Handling company age

Founding year, headcount signal and funding stage are extracted by the gate call and
passed to the panel as **context, not as a modifier**. The panel prompt states
explicitly: judge the idea, not the traction.

This must hold in both directions:

- A company incorporated last week gets **no automatic credit** for "new paradigm"
  merely for having no legacy to carry.
- A twenty-year-old company gets **no automatic penalty**. A genuine repositioning by
  an incumbent is exactly the thing this tool should reward.

---

## 5. Weight classes

Companies rank within their division. Each division renders as its own ranked table.

| Division | Definition | Icon |
|---|---|---|
| **Featherweight** | Pre-seed/seed, or under ~20 people | `seedlings` |
| **Middleweight** | Series A–C | `trending` |
| **Heavyweight** | Public, PE-owned, or plainly at scale | `bank` |

**Provisional** is a fourth state, not a division. When the site is a waitlist page
with no product detail, there is not enough evidence to score honestly. The entry is
published with a `provisional` badge and the panel says so plainly. This is the
correct handling of a genuinely day-old company, and it is funnier than a fake number.

---

## 6. Pipeline

| # | Step | Model | ~Time | ~Cost |
|---|---|---|---|---|
| 1 | Sync lead to Loops | — | 0.3s | — |
| 2 | Fetch homepage → text + logo | — | 1–2s | — |
| 3 | Gate: adtech? + stage + facts | NIM, cheap tier | 2s | ~$0 |
| 4 | Panel, parallel | Gemini · NIM · OpenCode | 8–10s | $0.022 |
| 5 | Synthesizer | OpenCode | 6–8s | $0.014 |
| 6 | Write to D1 | — | 0.1s | — |

**~20s, ~$0.04 per ranking.** Non-adtech submissions stop at step 3 and cost
approximately nothing.

**Step 1 runs before everything else**, inheriting the ordering established in Scout
(commit `2ee405e`, "Capture the lead before generating"). A flaky panel must not cost
the lead.

**Step 4 uses `Promise.allSettled`, not `Promise.all`.** If one juror fails, the
ranking publishes with two jurors and records which one abstained. Losing a juror
must not lose the ranking. This is Scout's failover philosophy applied to fan-out.

### The gate does three jobs in one call

Classification, weight-class assignment, and fact extraction (founding year, headcount
signal, funding stage, one-liner) all read from the same fetched HTML. Splitting them
into separate calls would triple the cost of the cheapest step in the pipeline for no
gain.

---

## 7. Models

Three independent providers, one juror each, so no single vendor outage can kill a
ranking. Keys available: `GEMINI_API_KEY`, `NVIDIA_API_KEY`, `OPENCODE_API_KEY`.

| Role | Provider | Family | Notes |
|---|---|---|---|
| Gate | NVIDIA NIM | cheap open-weights | Free tier, ~40 req/min |
| Juror — Google | Gemini direct | `gemini-3.5-flash-lite` | Already proven in Scout |
| Juror — open weights | NVIDIA NIM | Nemotron | Different training lineage entirely |
| Juror — spice | OpenCode Zen | `grok-4.6` | Least agreeable model available |
| Synthesizer | OpenCode Zen | `claude-sonnet-5` | Best comic writer in the set |

The jurors are chosen for **disagreement, not accuracy**. Three models from three
different labs, trained on different data with different RLHF taste, will diverge —
and where they diverge is the real signal that a company is genuinely contestable.
Three cheap models from one lab would agree with each other and say nothing.

Each juror is additionally given a distinct lens (the VC, the engineer, the adtech
lifer) so its quotes are attributable and legible. This is honest here because the
jurors really are different models; it would not be honest with one model in hats.

NVIDIA NIM is OpenAI-compatible, so it reuses the request shape Scout already has for
OpenCode Zen. **Exact NIM and OpenCode model IDs are pinned at implementation** by
querying `GET /v1/models`, following the discipline already documented in
`functions/api/subreddit-scout.ts` for Gemini.

---

## 8. Data model — D1

```sql
company     -- id, domain UNIQUE, name, slug UNIQUE, logo_url, one_liner,
            -- founded_year, division, provisional, status, created_at
ranking     -- id, company_id, total, paradigm, non_obviousness, vibe_code,
            -- conviction, verdict, split_note, platform_note, created_at
juror_take  -- id, ranking_id, model_id, provider, lens, scores_json,
            -- quote, abstained
submission  -- id, email, domain, ip_hash, created_at
```

`company.domain` is UNIQUE. One company is one row, permanently. Resubmitting an
already-ranked domain returns the existing row and spends nothing — this is
simultaneously the cost control and the thing that stops the board filling with
duplicates.

`company.status` is `published | removed`. Removal flips the flag rather than deleting
the row, so history survives and the company page can return 410 rather than 404.

`submission` is the lead record and the rate-limit counter in one table.

---

## 9. Routes and rendering

Add `@astrojs/cloudflare`. Mark exactly two routes `prerender = false`:

- `/tools/rank-my-adtech` — form plus three divisional tables
- `/tools/rank-my-adtech/[slug]` — one company, full reasoning, all juror quotes

Everything else — homepage, blog, `/work`, `/leaderboard` — continues to prerender
exactly as it does today. Adding an adapter does not convert the site to SSR; Astro
prerenders by default and only opted-out routes become dynamic.

Both dynamic routes are server-rendered so Google and the AI crawlers see the full
table and the full reasoning. Client-side fetching would make the highest-value part
of the tool invisible to the exact channel it exists to serve.

`/leaderboard` is untouched. That is the Organic Discovery Leaderboard, different data
and a different purpose. The two cross-link.

### API

`functions/api/rank-my-adtech.ts` — POST, runs the pipeline, writes to D1, returns the
ranking. Follows the existing Scout structure: origin check, normalisation, extraction
helpers, provider ladder.

---

## 10. Icons

Source: HackerNoon Pixel Icon Library, the only approved set. Geometry is hand-copied
into `src/components/ds/PixelIcon.astro`'s `PATHS` map, as with the existing 15.
Sizes 12/24/36/48. Regular renders in ink; solid renders in blue.

Already inlined and reusable: `seedlings`, `trending`, `robot`, `bolt`,
`flag-checkered`, `users-crown`.

To add:

| Use | Icon | Weight |
|---|---|---|
| Division leader | `crown` | solid — blue |
| Top score overall | `trophy` | solid — blue |
| Score 85+ | `fire` | solid — blue |
| Score 70–84 | `star` | regular |
| Score 40–69 | `face-thinking` | regular |
| Score under 40 | `hockey-mask` | regular |
| Paradigm axis | `shapes` | regular |
| Non-obviousness axis | `lightbulb` | regular |
| Vibe-code axis | `laptop-code` | regular |
| Conviction axis | `flag` | regular |
| Juror pull-quote | `quote-left` | regular |
| Panel split | `vote-yeah` | regular |
| Heavyweight division | `bank` | regular |
| Provisional badge | `question-circle` | regular |

Solid weight is reserved for celebration — crown, trophy, fire. Everything else stays
ink so the page has one loud note per row rather than a wall of blue.

**Risk:** the local design-system repo is a stale draft against canonical Claude Design
`951d1bec`. Icon additions here must be checked against canonical before they are
treated as design-system changes rather than local additions.

---

## 11. Cost and abuse controls

- One ranking per domain, permanently. Re-runs are out of scope for v1.
- Five submissions per IP per day, counted in `submission`.
- Work-email requirement retained as friction, though anyone may be submitted.
- Gate rejects non-adtech before the expensive calls, so junk costs ~$0.
- `status = removed` is the takedown path, executed as a SQL update.

---

## 12. Out of scope for v1

Re-ranking and score movement over time. The 2×2 Magic Quadrant visual. Radar charts.
Category grouping within divisions. Any moderation UI beyond a SQL update. Sharing
cards. All of these become easier once there is data, and none are needed to launch.

---

## 13. Testing

- **Gate:** fixture HTML for a clear adtech company, a clear non-adtech company, and a
  waitlist page. Assert classification, division, and provisional flag.
- **Panel:** mocked provider responses. Assert that one failing juror still produces a
  published ranking with `abstained` recorded.
- **Scoring:** assert the four axes sum to the total and that the total is bounded 0–100.
- **Dedup:** assert a resubmitted domain returns the existing row and makes zero model calls.
- **Rate limit:** assert the sixth submission from one IP in a day is refused.
- **Stage fairness:** fixture pair — a strong seed company and a strong incumbent —
  asserting neither is systematically advantaged across the four axes.

---

## 14. Known risks

1. **Preview has no secrets.** `GEMINI_API_KEY` and `LOOPS_API_KEY` are both set on
   production — an earlier note that Loops was unset was stale, verified 2026-08-13 via
   `wrangler pages secret list`. The preview environment, however, holds no secrets at
   all, so the pipeline cannot run on preview branches. Preview shares the production
   database for read-only rendering; if preview ever gets provider keys it needs its
   own database at the same time.
2. **Auto-publish of judgments about named companies** was chosen deliberately. Comedic
   framing, disclosure, and the removal path are the mitigations.
3. **First adapter on the site.** `@astrojs/cloudflare` enters the production build
   pipeline. Low risk, but it is a change to how every page ships.
4. **NIM free tier is ~40 req/min** and credit-limited. If the tool gets traffic, the
   gate and one juror need a paid path or a fallback.
