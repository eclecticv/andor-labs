# B2B Website Grader — Design Brief

**Date:** 2026-08-15
**Status:** Scoped, not approved for build
**Working name:** Benchmark
**Surface:** `andorlabs.ca/tools/benchmark/` (CF Pages + Worker + D1)

> This document is written to be resumable from cold context. It contains the
> research findings, the decisions, the reasoning behind them, and the known
> landmines. Nothing needed to start building is outside this file.

---

## 1. What this is

A commercial sibling to `rank-my-adtech`: **less entertaining, more commercial.**
It takes a B2B domain and grades it across five dimensions, then ends on a
capability gap table — *what you have vs. what your peer set has that you don't.*

The core insight driving the whole design: **two of the five dimensions are
already written, already cited, and cost nothing to run.** They come from the
`saas-grader` plugin. The new work is overwhelmingly the *evidence* layer for
the other three, not the *judgment* layer.

### The five dimensions

| | Dimension | Rules | Source | Vendor cost |
|---|---|---|---|---|
| **D1** | Brand & Design | PD-1..14 (14 rules, weights 2–6, Σ53) | `saas-grader` **verbatim** | **$0** |
| **D2** | Positioning & Messaging | BM-1..8 (8 rules, weights 2–5, Σ31) | `saas-grader` **verbatim** | **$0** |
| **D3** | Search & AI Citation Footprint | ~12 new (`SF-*`) | new rubric + DataForSEO + own DOM | metered |
| **D4** | Peer-set Competitive Ranking | percentile layer, not rules | DataForSEO Labs + D1/D2 re-run on peers | metered + compute |
| **D5** | MarTech/SalesTech Stack Maturity | ~8 new (`ST-*`) + gap table | BuiltWith (+ Sumble, deferred) | metered |

Plus two cross-cutting components added after the first pass:

| | Component | Purpose |
|---|---|---|
| **S** | **LLM Summary** | A narrative synthesis that **scores nothing**. Reads all five dimensions and writes the report's prose. |
| **C** | **Benchmark Corpus** | Persisted grades across all companies ever run. Backs D4 percentiles and D5's reference stack. Self-accumulating. |

**22 of ~42 graded rules already exist.**

---

## 2. Research findings

### 2.1 saas-grader (`~/Developer/saas-grader/`, v3.1.0)

Seven architectural decisions transfer wholesale. These are the hard part of any
grader and they are already solved:

| Pattern | Location | Why it matters here |
|---|---|---|
| **Step-0 classification before scoring** | `reference/shared-procedures.md:5-26` | ~half the rules are conditional. Decide B2B/utilitarian/maturity/monetization **once**, cite it in every conditional verdict. Prevents per-rule re-litigation — the #1 source of run-to-run drift. |
| **3-pass evidence ladder** | `:28-90` | Rendered DOM → screenshot → WebFetch, and **the pass that produced the evidence sets the confidence level** (High/Medium/Low). |
| **Four verdicts, not two** | `:98-118` | PASS / FAIL / N/A / **UNVERIFIED**. "A FAIL is a claim about the site, not about our visibility into it." |
| **Static scoring table** | `:152-200` | `weight = evidence grade + impact grade` (range 2–6), frozen at authoring time, never re-derived at runtime. |
| **`mech`/`judg`/`prac` tiers** | `:137-150` | `prac` rules aren't observable from a website → pushed to an **ungraded appendix**. Honest denominators. |
| **Computed fix priority** | `:234-245` | `weight + effort bonus` (copy +3 / design +2 / product +0). Ranks "add a proof number to the hero" above "restructure your trial." |
| **Machine-readable JSON tail** | `:247-258` | Run-over-run deltas, each flip labelled `site-changed` / `re-evaluation` / `procedure-changed`. |

`scripts/extract-signals.mjs` is **188 lines, zero-dependency regex** over a
`--dump-dom` HTML file. It emits: `title`, `metaDescription`, `headings`,
`ctas.{buttons,buttonLikeLinks}`, `navLinks`, `pricing.{prices,perUnitPricing}`,
`socialProof.{numbers,trustedBy,starRatings,starGlyphs}`,
`trial.{trialMentions,freeTrialMentioned,freemiumSignals}`, `media.{videoTags,embeds,gifs}`,
`fontFamilies`, `textStats.{totalVisibleWords,paragraphCount,longestParagraphWords}`,
`brandAge.{foundingSignals,copyrightYears}`.

It ports to a Worker essentially as-is — it takes an HTML string and returns JSON.

**Key falsifiability observation:** the `mech`/`judg`/`prac` split is really a
*falsifiability tier*. A commercial grader lives or dies on whether a client can
argue with the score. `mech` rules are unarguable, `judg` rules need an anchored
scale, `prac` rules must never touch the grade.

**Key architectural difference from saas-grader:** its evidence is 100%
*first-party* (the site's own DOM). D3–D5 here are mostly *third-party* (SERPs,
LLM answers, tech stacks, peers). That requires a **fourth evidence rung:
`vendor`** — higher confidence than DOM, but it costs money and can be stale.

### 2.2 DataForSEO

- **Pay-per-request, no subscription.** SERP queued from ~$0.0006; Keywords Data
  from ~$0.05/1k; Backlinks from ~$0.025; OnPage from ~$0.0125/page. SERP tiers:
  Standard ~$0.60/1k (~5 min), Priority ~$1.20/1k (~1 min), Live ~$2.00/1k (~6 s).
- **AI Optimization API** (`docs.dataforseo.com/v3/ai_optimization/overview/`) —
  four groups:
  - **LLM Mentions API** — keyword/brand/website mentions in LLMs; AI search
    volume, impressions, mentions count. Endpoints: Search Mentions, Target
    Metrics, Top Mentioned Pages/Domains/Brands/Categories, Historical,
    Timeseries. **Live method only.**
  - **AI Keyword Data API** — search-volume estimates + intent from AI-tool usage.
  - **LLM Responses API** — structured responses from ChatGPT, Claude, Gemini,
    Perplexity. Standard + Live.
  - **LLM Scraper API** — scraped ChatGPT search results. Standard + Live.
  - ⚠️ Third-party reporting puts LLM Mentions around **~$1 per 1,000 rows**.
    **This is NOT confirmed** — `dataforseo.com/pricing/ai-optimization` did not
    render figures. **Verify before building a cost model on it.**
- **DataForSEO Labs `competitors_domain/live`** — input: target + location +
  language. Returns `intersections` (count of intersecting keywords),
  `avg_position`, rank distribution (`pos_1`, `pos_2_3`, `pos_4_10`, …), and
  per-channel metrics (`organic`/`paid`/`local_pack`/`featured_snippet`) with
  `etv` (estimated organic monthly traffic), `count`, `estimated_paid_traffic_cost`,
  and change flags (`is_new`, `is_up`, `is_down`, `is_lost`).
  Clickstream data **doubles** the request price.
  Siblings: `ranked_keywords`, `domain_rank_overview`, `relevant_pages`,
  `domain_intersection`.

**This endpoint solves peer-set discovery.** You never ask the user who their
competitors are — you derive them from keyword intersection.

### 2.3 BuiltWith

`api.builtwith.com` — core APIs:
- **Domain API** — current **and historical** technology + metadata (JSON/XML/CSV)
- **Lists API** — sites using a given technology
- **Relationships API** — sites linked together, by what, for how long
- **Trends API** (free), **Company to URL API**, **Free API** (counts by tech group)
- 15+ supplementary APIs incl. Change, Ask, MCP, Live Feed, Recommendations, Trust

Pricing is not published on the API index page — requires a Plans page or signup.

### 2.4 Sumble — **deferred to tier-2**

`docs.sumble.com/api` — four core endpoints: **Organizations** (resolve/search
companies; firmographics, technology, per-entity metrics, recent signals,
**confirmed-used tech stack**), **People**, **Job Posts** (postings + extracted
entities), **Teams** (attributes, ICP-fit score, related people, job posts).

Sumble resolves technology **to teams, not just companies** — from hiring data.
That makes "does anyone actually operate this stack" answerable.

⚠️ **Pricing inverts our incentives:** ~3 credits/job (~$0.03 on Pro) and
**5 credits per technology found**. A mature stack costs more to grade than an
immature one. Also: smaller coverage (~2.7M companies vs 9.5M+ elsewhere),
24-hour data lag, and the Jobs `/find` endpoint exposes only 4 filters.

**Decision: keep it off the default path.** Design the D5 schema so Sumble can
slot in later without a migration.

### 2.5 Context.dev (YC S26) — **fallback / corroboration**

`docs.context.dev` — three APIs:
- **Web API** — input URL; returns markdown, HTML, screenshots (1920×1080 PNG),
  **detected fonts**, **spacing values (4/8/16/24px scales)**, product extraction,
  AI answers
- **Brand API** — input domain/company/work email/ticker; returns logo files,
  **colour palettes with hex values**, company name, social handles, address,
  stock info, industry classification
- **Classification API** — NAICS + SIC codes

Free tier, no card to start. **Because D1 is reused from saas-grader (screenshot-
and DOM-based), Context.dev is not the primary source for brand/design.** Its
role is (a) a hosted substitute for the whole Chromium pass if Browser Run's
limits bite, and (b) cheap corroboration for **PD-6** (machine font) and **PD-2**
(brand-appropriate colour), which currently rest on a screenshot alone.

### 2.6 Lessons carried from `rank-my-adtech`

**Steal:**
- **Anchored 0–10 scale bands written into the prompt.** Three labs independently
  returned exactly 4/10 on the same company. Determinism came from the *scale*,
  not the temperature.
- **Facts placed LAST in the JSON** so classification doesn't anchor the ratings.

**Avoid:**
- **The multi-lab panel.** On rank-my-adtech the panel *is* the product —
  neutrality is the claim. Here it triples cost per run to buy a property nobody
  is paying for. One model at temp 0 against anchored scales, with vendor data as
  the tiebreaker, is the commercial shape.

**Heed:**
- Funding-stage bands proved **undetectable** across 28 real adtech sites (round
  in markup 7%, round recalled by 2+ panelists ~0%, founding year 14%) *after*
  the board axis had been designed around them. Measure before designing an axis.
  See §8.

---

## 3. Dimension detail

### D1 — Brand & Design (PD-1..14, reused verbatim)

Structure matches product type · brand-appropriate colours · layout adapted to
SaaS type · moderate complexity · rounded CTAs · machine font · CTA upper-right ·
before/after left-to-right · video for exciting software · video speed ·
above-the-fold prioritisation · content succinctness · scannable structure ·
signal-to-noise ratio.

Evidence: rendered DOM signals JSON + 1280×900 screenshot. **Cost: $0.**

### D2 — Positioning & Messaging (BM-1..8, reused verbatim)

Productized headline · top-3 benefits · present tense · newness signal · simple
language · social-proof numbers · 4–4.5 star rating · curated first testimonial.

Evidence: rendered DOM signals JSON. **Cost: $0.**

`fix-my-positioning`'s Dunford/JTBD/Raskin/VPC/Challenger + Fletch layer is a
**later addition**, not folded in now. Noted so it isn't rediscovered.

### D3 — Search & AI Citation Footprint (new, `SF-*`)

Two deliberately separate halves.

**Footprint — metered**
- `domain_rank_overview` → organic ETV, ranked-keyword count, pos_1 / pos_2_3 /
  pos_4_10 distribution
- `ranked_keywords` → **branded vs. non-branded split** (filter on brand token).
  A domain whose entire footprint is its own name has no search footprint, it has
  a nameplate.
- SERP `advanced` on *k* category keywords → does an **AI Overview** fire, and are
  you in it
- `ai_optimization/llm_mentions/target_metrics` + `search_mentions` → mention and
  citation count, AI search volume for the brand
- `top_mentioned_domains` → **who is getting cited on your topics instead of you**

**Citability hygiene — free, own DOM, all `mech`**
- `robots.txt` allows GPTBot / ClaudeBot / PerplexityBot / Google-Extended
- `llms.txt` present
- schema.org `Organization` / `Product` / `FAQPage` present and valid
- canonical present, single H1, correct heading nesting
- publish/update dates and author markup on content pages

**These hygiene rules are the most sellable output in the tool:** binary,
unarguable, commonly failed, fixable in a day. A site actively blocking `GPTBot`
while its CMO complains about AI visibility is a finding that sells the next
engagement by itself.

### D4 — Peer-set Competitive Ranking

1. `competitors_domain/live` on the target → candidates ranked by `intersections`
2. Filter out marketplaces, directories, aggregators, and anything whose
   intersection is dominated by generic terms
3. Take **N = 5** peers. **N is the single cost multiplier in the system** — a
   config constant, never a per-run decision
4. For each peer: run **D1 + D2 (free)** and one BuiltWith call (cheap).
   **Do NOT** run D3's metered half on peers
5. Report the target's **percentile within the peer set** per dimension, plus raw
   vendor deltas (organic ETV, intersections, LLM mention share)

Because D1+D2 cost nothing but compute, peers can be graded **on our own rubric** —
so D4 is a ranking on positioning and design, not merely on DataForSEO's traffic
numbers. This is the unlock that makes the dimension worth having.

### D5 — Stack Maturity + the gap table

**Maturity is capability coverage, not tool count.** Detected technology maps onto
a fixed capability model, never a vendor list:

`analytics · product analytics · tag management · CDP · CRM · marketing automation ·
conversational/chat · ABM/intent · attribution · consent/CMP · A/B testing ·
session replay · reverse ETL · enrichment · scheduling · e-sign · revenue intelligence`

The deliverable:

| Capability | You | Peer coverage | Verdict |
|---|---|---|---|
| Tag management | GTM | 5/5 | ✅ |
| Product analytics | — | 4/5 | ❌ **Gap** |
| Consent/CMP | — | 5/5 | ❌ **Gap — compliance risk** |
| Session replay | Hotjar | 2/5 | ✅ ahead |
| CDP | — | 1/5 | ➖ not table stakes in your set |

**The reference stack is computed from the peer set, not hardcoded.** That is what
makes "you're missing X" defensible rather than a vendor pitch — X isn't missing
against an ideal, it's missing against the five companies you actually compete with.

**The blind spot, stated in the report and not buried:** BuiltWith detects
client-side markup. Server-side and in-app martech (most CRM and MAP backends) is
invisible. The defence is that the blind spot is **symmetric** — peers' server-side
stacks are equally invisible — so *relative* coverage stays fair even though
*absolute* coverage is understated. The report says this in plain language.

BuiltWith and Sumble are **not** redundant: BuiltWith answers *"what's on the
page,"* Sumble answers *"what do they operate."* Maturity is precisely the gap
between them — many tags plus no owning team is tag sprawl, not maturity.

### S — LLM Summary (scores nothing)

A dedicated writer pass, modelled on rank-my-adtech's fourth lab.

- **Input:** the complete scored JSON for all five dimensions, the classification
  block, the peer percentiles, and the gap table.
- **Output:** the report's narrative prose — an executive summary, a "what this
  adds up to" paragraph per dimension, and the ordered fix list rendered as
  argument rather than as a table dump.
- **It assigns no scores and cannot change a verdict.** Scores are computed
  deterministically before the writer ever runs. The writer is downstream of
  scoring, always.
- **Temperature ~0.8.** Prose need not be reproducible; scores must be. This is
  the one place in the pipeline where a non-zero temperature is correct.
- **Anti-fabrication rule:** the writer may only cite evidence present in the
  input JSON. Every number in the prose must be traceable to a scored field. Any
  dimension whose verdicts are `UNVERIFIED` is described as unmeasured, never
  inferred.

Run cost is one call per report and it is the single highest-leverage token spend
in the product — it is what makes the output read like a consultant's memo rather
than a linter's output.

### C — Benchmark Corpus

Persisted grades for every company ever run, in D1.

- **Backs D4** — percentile ranks are computed against the corpus, not recomputed
  per run.
- **Backs D5** — the category reference stack is the modal capability coverage
  across corpus members in the same category.
- **Self-accumulating.** Every run adds the target *and* its five peers. Peers
  recur heavily inside a category, so cache hit rate climbs and the marginal cost
  of a run falls over time.
- **Seeded** by `scripts/grade-local.mts` (see §5) over an initial 150–300 B2B
  domains. Seeding D1+D2 is free; seed D5 selectively.
- **Freshness:** entries carry a graded-at timestamp; 90-day TTL before a domain
  is re-graded rather than served from cache.
- **Category assignment** comes from the Step-0 classification, majority-checked
  against the peer set — a company whose five peers are all in one category and
  which claims another is flagged, not silently reassigned.
- The corpus is a **dataset we own**. Its value compounds independently of the
  tool's conversion rate.

---

## 4. Scoring

Inherits saas-grader's model wholesale, plus one addition:

- **Four verdicts** — PASS / FAIL / N/A / **UNVERIFIED**. N/A and UNVERIFIED leave
  the denominator. **Uncertainty never becomes a FAIL.** On a commercial tool this
  is the clause that stops us invoicing for a defect we invented.
- **Static weight table** — `weight = evidence grade + impact grade`, frozen at
  authoring time.
- **Tiers** `mech` / `judg` / `prac`. `prac` never touches a grade.
- **Fifth evidence tier: `vendor`** — High confidence, but every vendor-fed verdict
  is stamped with that vendor's own data-freshness date. BuiltWith historical data
  can be months stale and the report must say so.
- **Five letter grades + one composite**, with published dimension weights.
  **Denominators printed next to every grade, always** — grade movement caused by a
  denominator change is noise, not signal.
- **Anchored 0–10 bands written into the prompt** for every `judg` rule. The scale
  is the determinism lever, not the temperature. **Temp 0 on all rule judgment.**
- **Computed priority** per FAIL: `weight + effort bonus` (copy +3, design +2,
  product/stack +0). Critical ≥ 8 · Medium 5–7 · Low ≤ 4.
- **Rigor protocol** (saas-grader `:120-134`) applies unchanged: before finalising
  any verdict, argue the other side.

---

## 5. Architecture

```
andorlabs.ca/tools/benchmark      Astro on CF Pages
        │  POST /api/run  → { runId }
        ▼
   CF Worker  ──►  Cloudflare Workflow  (durable, retried, multi-step)
        │              ├─ step: Browser Run → snapshot + screenshot (target)
        │              ├─ step: extract-signals  (ported .mjs, logic unchanged)
        │              ├─ step: Step-0 classification
        │              ├─ step: D1 + D2 rule pass                  [free]
        │              ├─ step: D3 hygiene (own DOM)               [free]
        │              ├─ step: D3 footprint — DataForSEO fan-out  [metered, cached]
        │              ├─ step: peer discovery → N=5
        │              ├─ step: peer D1/D2 + BuiltWith             [cache-first]
        │              ├─ step: D5 capability map + gap table
        │              ├─ step: D4 percentiles vs. corpus
        │              ├─ step: LLM Summary (writer, temp 0.8)
        │              └─ step: persist to corpus + compose report + JSON tail
        ▼
       D1  ── runs · companies · grades · evidence · vendor_response_cache · corpus
        │
   GET /api/run/:id  → poll → report
```

**Why Workflows, not a plain Worker.** A full run is a DOM fetch, a screenshot,
six-plus BuiltWith calls, several DataForSEO calls, ~22 rule judgments across six
domains, and a writer pass. That cannot complete inside one HTTP request —
rank-my-adtech already hit provider-hang problems at a fraction of this weight.
Workflows gives durable steps with retries and survives the request lifecycle.
**Submit-then-poll is the only honest UX here.**

**Why Browser Run replaces local Chromium.** saas-grader's pipeline assumes a
local binary (`--dump-dom`, `--screenshot`). Cloudflare **Browser Run** (formerly
Browser Rendering) exposes REST quick actions for screenshot, snapshot, scrape,
markdown, PDF, links and structured JSON, plus Puppeteer/Playwright/CDP via a
Worker binding. Free and Paid plans; billed on browser time.
**Fallback:** Context.dev Web API — one call returns markdown, HTML, screenshot,
detected fonts, and the spacing scale.

**Model calls need an explicit deadline** (rank-my-adtech uses 75 s). A provider
that accepts the connection then goes quiet never *fails*, so a retry ladder never
advances — observed hanging a run 10+ minutes.

---

## 6. Cost model per run (N = 5 peers)

| Item | Calls |
|---|---|
| Browser Run | 6 (target + 5 peers, cache-first) |
| DataForSEO Labs | 3 (rank overview, ranked keywords, competitors) |
| DataForSEO SERP advanced | k ≈ 5 category keywords |
| DataForSEO LLM Mentions | 2 |
| BuiltWith Domain | 6 (cache-first) |
| Model tokens | 22 rules × 6 domains (cached peers excluded) + 1 writer pass |

**Peer caching is what makes this viable.** Within a category, run #2 onward mostly
hits cache. Instrument actual cost per run from day one and treat **N** as the throttle.

**Every vendor response is written to `vendor_response_cache` before parsing.**
Augment, never re-run. Metered calls are never spent twice on the same question.

---

## 7. Build order

1. **Port the free half.** extract-signals → Worker; D1 + D2 rules; report
   renderer; corpus schema. Ships as a working free grader with **zero vendor spend.**
   Complete product on its own.
2. **D3 citability hygiene.** Still free, still no vendor. Immediately sellable findings.
3. **LLM Summary.** Once there are two dimensions' worth of structured input, the
   writer has enough to be worth running. Adding it early sets the report's voice
   before the metered work distorts priorities.
4. **D3 footprint.** First metered dimension. **Wire the cache and cost
   instrumentation here**, before spend can run away.
5. **D4 peers + corpus seeding.** Reuses everything from 1–4.
6. **D5 stack + gap table.** Last — depends on the peer set from 5.

Steps 1–3 are a shippable tool with **no API bill at all.**

---

## 8. Measure before committing — the D5 probe

`rank-my-adtech` designed a board axis around funding-stage bands, then measured
and found stage undetectable on 28 real sites (7% / ~0% / 14%). ~90% landed in one
band and two of three tabs were empty. The axis had to be replaced post-build.

**The same risk lives in D5.** Before committing stack maturity as a *graded*
fifth of the composite, run a **20-site probe** on BuiltWith coverage for
mid-market B2B and check whether detected capability coverage actually separates
companies.

- **If it separates:** D5 is graded normally.
- **If it doesn't:** D5 ships as the **ungraded gap table only** — still the
  artifact that was asked for, just not carrying a letter, and reported in the
  `prac` appendix style.

Do the same sanity check on D3's LLM Mentions data before weighting it heavily:
if most mid-market B2B brands return zero mentions, the dimension discriminates on
noise.

---

## 9. Decisions and assumptions

**Decided:**
- Public web tool on `andorlabs.ca`, so **every API call is our cost.** This drives
  the caching, the corpus, and the free/metered split.
- D1 and D2 are `saas-grader` rules **repurposed verbatim** — not new rubrics
  inspired by them.
- The free/metered boundary and the paywall are **the same line**: D1+D2 open,
  D3–D5 gated. Never gate what cost nothing; never give away what was paid for.

**Assumed — flip freely:**
- **Private report, email-gated on D3–D5. No public board.** "Less entertaining,
  more commercial" reads as *not* a leaderboard, and publicly assigning brand
  grades to named companies is a materially different risk posture than a novelty
  adtech score. The corpus stays internal.
- **N = 5 peers**, config constant.
- **One model at temp 0** for scoring, not a multi-lab panel.
- **Sumble deferred** to tier-2 on its per-technology pricing.
- **BM-1..8 reused as-is**; `fix-my-positioning`'s framework layer added later.

**Open — must verify before a cost model is trusted:**
- DataForSEO AI Optimization pricing (the ~$1/1k rows figure is third-party and
  unconfirmed; the vendor's own pricing page did not render figures).
- BuiltWith Domain API per-lookup pricing and plan minimums.
- Cloudflare Browser Run concurrency and duration limits at our expected volume.

---

## 10. Landmines (carried forward — do not rediscover)

- ⚠️ **Never add a root `wrangler.toml`** to the And/or Labs repo. A root wrangler
  config takes over the `env_vars` namespace holding **all** production secrets.
  Add bindings via the Cloudflare API instead.
- ⚠️ **`wrangler pages dev` cannot bind remote D1.** The corpus is seeded by
  `scripts/grade-local.mts`, which runs the whole pipeline outside Workers and
  emits SQL. Do not make the deploy the test. Filter `^\[grade\]` lines out of stdout.
- ⚠️ **Migrations are atomic in D1.** A bare `CREATE INDEX` on an index surviving
  from an earlier migration rolls the entire file back. Use `IF NOT EXISTS` on
  every index.
- ⚠️ **Archive before dropping.** rank-my-adtech's migration 0004 dropped 6 rows
  because it didn't.
- ⚠️ **Model calls need an explicit deadline** (75 s). Silent providers hang runs.
- ⚠️ **Metered APIs:** save every response, augment don't re-run, and ask before
  any batch above ~1k calls.
- Satori cannot read woff2 — if a share card is added, it is Departure Mono only,
  strings folded to ASCII.

---

## 11. Reference paths

- saas-grader repo: `~/Developer/saas-grader/` — rules in
  `skills/saas-grader/reference/{brand-messaging,page-design}.md`, procedures in
  `reference/shared-procedures.md`, extractor at `scripts/extract-signals.mjs`
- And/or Labs repo: `~/Developer/andor-labs/` (canonical since 2026-07-08)
- rank-my-adtech spec: `docs/superpowers/specs/2026-08-14-rank-my-adtech-panel.md`
- fix-my-positioning plugin: `~/Developer/fix-my-positioning/`

## 12. Next step

Approve or amend this brief, then run `superpowers:writing-plans` to produce the
implementation plan for **Step 1 only** (the free half). Do not plan steps 4–6
until the §8 probes have been run.
