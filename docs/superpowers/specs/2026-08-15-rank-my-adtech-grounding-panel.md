# Rank My AdTech — grounding, panel, and rerank spec

**Date:** 2026-08-15
**Origin:** claude.ai session, repo not in context. Written against described behaviour, not against the code.
**Status:** Source spec. See `.scratch/rank-my-adtech-spec-reconciliation-2026-08-15.md` for what survives contact with the repo.
**Scope:** category schema, judging panel design, evidence grounding, rerank protocol

> The author of this spec did not have the repo. Field names, model seats, and
> the shape of `side` are all asserted rather than observed. Validate before
> wiring. The reconciliation note records which assertions are wrong and why.

---

## The brief

1. **Buy-side categorization is thin.** Everything lands in one subcategory. Needs a richer schema — IAB, G2, or another source.
2. **Fixed-persona panel.** Nemotron Ultra (engineer), Gemini Pro (exec), Grok 4.5 (VC). Personalities must not change by dimension — Nemo answers the investment question as an engineer, Rook answers the buildability question as a VC. They don't break character. GPT Luna summarizes. Model descriptions need tech specs, personality, and company logos.
3. **No real-world grounding.** Models are quick to dismiss on innovation but hand out rave reviews on engineering ("can it be vibe coded") because they found some buzzwords.

Constraints: add an evidence packet display, give the panel fictional names and bios, don't blow up scope, don't introduce bugs, don't pay for anything. Rerank only after diffing a handful and seeing marked improvement.

---

## 1. Category schema

**Source note.** IAB isn't the right source — its taxonomies are content and audience, not vendor. The usable sources are the LUMAscape side-split, G2's ad-tech category tree, and AdExchanger-style landscape maps for the newer categories.

**Two structural fixes beyond just adding subcategories:**

- Vendors carry a **primary** and up to two **secondary** categories.
- `sides` becomes **multi-valued**. Half the interesting vendors operate on both sides, and forcing a single value is why buy-side looked thin in the first place.

Buy-side expands from one bucket to eleven: DSP, curation & trading desks, creative/DCO, measurement & attribution, MMP, verification & fraud, identity & data, retail/commerce buying, search & social management, planning & workflow, and agentic buying.

Each category carries a `not_to_be_confused_with` field and a `signals_of_real_membership` list, so placement is evidence-driven rather than copy-driven. The agentic buying category in particular needs the guard — otherwise every vendor who bolted a copilot onto an existing UI lands in it.

**Sell-side deliberately untouched.** Renaming those IDs would invalidate every existing score and force a full rerank. Out of scope.

---

## 2. The panel

Persona in the **system prompt**, rubric in the **user turn**. Personas never change by dimension.

| Seat | Character | Model |
|---|---|---|
| Engineer | **Nemo Vasquez** | Llama 3.1 Nemotron Ultra 253B |
| Operator | **Gemma Larkspur** | Gemini 3.1 Pro |
| Investor | **Rook Callaghan** | Grok 4.5 |
| Clerk | **Luna Marchetti** | GPT-5.6 Luna |

Each judge carries three things:

- a **lens** — "I judge by what breaks at 3am and who gets paged"
- a **disqualifier** — "I say no when the integration count IS the product"
- a **forbidden moves** list — "never cite market size," "never invoke the AI wave"

The disqualifier is load-bearing. Without a specific "here is what makes me say no," personas drift into generic-analyst voice by the third dimension. The forbidden-moves list is what stops the VC scoring up on macro tailwinds and the engineer calling things "innovative" instead of describing a mechanism.

**Luna's mandate: disagreement is the signal, don't average it.** Three judges converging at 8 means something categorically different from 9/8/2, and a mean of 6.3 destroys the only interesting information on the page. She names the dissenter, states their reason, leaves the split unresolved. Panel spread is worth surfacing as a visible metric.

### Logos

HackerNoon has good coverage for the majors but is patchy on xAI and NVIDIA model marks. Lobe Icons (MIT) fills the gaps. Self-host the SVGs — a 404 on a third-party logo host is a broken panel card on every vendor page simultaneously.

---

## 3. Grounding

**Diagnosis.** Given only a vendor name and a description, "innovation" reads as a claim to be doubted and "can it be built" reads as a claim to be flattered. Both are guesses. This is an evidence problem, not a prompting problem — stop asking models to recall and start asking them to read.

### Evidence packet

Eleven artefacts per vendor, all public and free to fetch:

| ID | Artefact | Why |
|---|---|---|
| E1 | Homepage | Positioning as claimed |
| E2 | Product / how-it-works | Mechanism, if described |
| E3 | Pricing page | Presence or absence is a finding |
| E4 | Docs / API reference | Strongest signal a product exists |
| E5 | **Job postings** | **Highest-value artefact here.** Marketing lies; the infra req doesn't |
| E6 | GitHub org | Commit recency, contributor count, demo-vs-product |
| E7 | Status page / SLA | Uptime posture, or its absence |
| E8 | Funding + headcount | A clock, not validation |
| E9 | Review-site presence | Volume matters more than rating |
| E10 | Protocol participation | AdCP, IAB Tech Lab, Prebid, OpenRTB |

**Absence is data.** A missing artefact is recorded as `not_found` with a timestamp and shown to the judges as such. "No pricing page found" and "careers page lists zero engineering roles" are among the most informative things the packet can contain. Never silently omit.

**Budget guard:** cap at ~150K tokens. Truncate E1/E2 to main content, keep E4 and E5 whole.

**Display it.** Ship the packet as a collapsible list on the vendor page with fetch times and links. Highest-trust element on the page — it converts "three AIs had opinions" into "three AIs read these eleven documents, here they are."

### Four rules in every judge prompt

1. **Citation-or-cap.** Every claim carries an evidence ID. Above-midpoint requires two distinct IDs. Uncited reasoning caps the dimension at 5/10. This alone kills most buzzword inflation — buzzwords come from E1 and nothing else, so a vendor whose whole case lives on the homepage structurally can't clear the cap.
2. **Unverified defaults down.** Absent evidence, a dimension starts at 4 and must be argued upward. Make the judges pay for optimism.
3. **Negative case first.** Three specific reasons the vendor fails, each cited, written *before* any score. Marketing language survives "why is this good"; it doesn't survive "what's the hard part," asked before the model has committed.
4. **Claims-vs-evidence table.** Extract claims from E1/E2, mark each `supported | unsupported | contradicted` against E3–E10 before scoring. Buzzwords get processed as objects of analysis rather than absorbed as context.

### Reframe the vibe-coding dimension

"Can it be vibe coded" is really *where is the moat*, and in ad tech the answer is almost never the UI. Replacement prompt:

> Name the single hardest thing to replicate here. Choose from: sustained QPS at a latency SLA, count and depth of OpenRTB integrations, data rights or contracts, compliance and accreditation posture, supply or demand relationships, or proprietary data accumulation. Cite the evidence. If nothing in the packet supports any of these, say so — that is a valid and common finding.

---

## 4. Rerank protocol

Don't touch the live board until the diff earns it.

1. **Shadow mode.** New pipeline writes to `scores_v2`; published board keeps reading `scores_v1`. No user-visible change.
2. **Pick six.** Two you believe are genuinely strong, two you believe are thin, two with no strong prior. Include at least one that scored suspiciously well on buildability — that's the bug you're testing for.
3. **Diff the reasoning, not the numbers.** Not "did the score move," but "did the reasoning get more specific and are the citations real." Spot-check that cited IDs actually say what the judge claims.
4. **Gate.** Ship only if buildability compresses downward for thin vendors, at least half of all scores carry two or more real citations, and personas are still distinguishable reading the transcripts blind.
5. **Backfill in one pass**, then version-stamp so old and new scores are never silently mixed.

If the diff is ambiguous, it's a rubric problem, not a rerank problem. Iterate on the six.

---

## 5. Cost and operational gotchas

- **Nemotron** has a free OpenRouter tier and is the highest-volume seat. Route there first.
- **Nemotron** needs `detailed thinking on` literally in the system prompt, or you get a non-reasoning response at reasoning-model latency.
- **Gemini 3.1 Pro** re-prices at 200K context ($2/$12 → $4/$18). Hence the 150K packet cap.
- **Grok 4.5** re-prices at 200K too, and defaults to high reasoning effort. Drop to medium.
- **Grok 4.5** is not available in the EU.
- **Gemini Pro** models lost free-tier access on 2026-04-01. Prototyping on Flash and switching to Pro at ship time will change the scores.
- **Luna** is the cheapest seat by an order of magnitude and reads all three transcripts. Give it structure, not judgment.

---

## 6. Out of scope (deliberately)

Sell-side category renaming, historical rescoring beyond the one backfill, any paid data source, any change to the ranking formula itself, and multi-run averaging for variance. The last is a real issue — output variance across runs is unaddressed — but it triples cost and belongs in its own change.

---

## Appendix A — `categories.json`

```json
{
  "schema_version": 2,
  "sides": [
    { "id": "buy", "label": "Buy-side", "definition": "Sells to advertisers, brands, agencies, or performance marketers. Buyer economics: cost per outcome." },
    { "id": "sell", "label": "Sell-side", "definition": "Sells to publishers, app developers, retailers, or broadcasters. Buyer economics: yield per impression." },
    { "id": "both", "label": "Both sides", "definition": "Material revenue from both. Use only when a vendor has a real dual GTM motion, not just a marketing claim." },
    { "id": "infra", "label": "Neutral infrastructure", "definition": "Sells to the ecosystem itself — other ad tech vendors. Standards bodies, cloud, identity plumbing, clean rooms." }
  ],
  "buy_side_categories": [
    {
      "id": "dsp",
      "label": "Demand-Side Platform",
      "definition": "Bids on inventory programmatically on behalf of advertisers. Owns the bidder.",
      "not_to_be_confused_with": "Trading desks and curation layers, which sit on top of a DSP rather than operating one.",
      "signals_of_real_membership": ["Operates own bidder / QPS disclosed", "OpenRTB 2.x or 2.6 endpoint", "Seat-level billing"]
    },
    {
      "id": "curation_trading_desk",
      "label": "Curation & Trading Desks",
      "definition": "Assembles, packages, and resells audience or inventory deals. Includes agency trading desks, independent curators, PMP marketplaces.",
      "not_to_be_confused_with": "DSPs. Curators buy through DSP seats; they do not run the auction.",
      "signals_of_real_membership": ["Deal ID issuance", "Named SSP curation partnerships", "Take-rate disclosed as % of media"]
    },
    {
      "id": "creative_dco",
      "label": "Creative, DCO & Ad Serving (advertiser-side)",
      "definition": "Builds, versions, personalizes, and serves advertiser creative. DCO, creative management platforms, advertiser-side ad servers.",
      "signals_of_real_membership": ["Creative template system", "Feed ingestion", "Impression-level creative decisioning"]
    },
    {
      "id": "measurement_attribution",
      "label": "Measurement & Attribution",
      "definition": "Assigns credit for outcomes. MMM, MTA, incrementality testing, lift studies, conversion APIs.",
      "not_to_be_confused_with": "Verification, which measures whether an ad was viewable/safe, not whether it worked.",
      "signals_of_real_membership": ["Published methodology", "Named holdout/geo-experiment capability", "MRC or equivalent accreditation where claimed"]
    },
    {
      "id": "mmp",
      "label": "Mobile Measurement Partners",
      "definition": "App install attribution, SKAdNetwork/AdAttributionKit handling, in-app event tracking.",
      "signals_of_real_membership": ["SKAN/AAK postback handling", "Named SRN integrations", "SDK published on public registries"]
    },
    {
      "id": "verification_brand_safety",
      "label": "Verification, Brand Safety & Fraud",
      "definition": "Pre-bid and post-bid measurement of viewability, IVT, brand suitability, MFA detection.",
      "signals_of_real_membership": ["MRC accreditation", "Pre-bid segment availability in named DSPs", "Published IVT taxonomy"]
    },
    {
      "id": "identity_data_buy",
      "label": "Identity, Data & Onboarding (buy-side)",
      "definition": "Advertiser-side identity resolution, data onboarding, audience data marketplaces, CDP-adjacent activation.",
      "not_to_be_confused_with": "Sell-side identity (publisher-side ID enrichment). Tag both sides if genuinely both.",
      "signals_of_real_membership": ["Named ID graph scale claims with methodology", "Clean room integrations", "Onboarding match-rate disclosure"]
    },
    {
      "id": "retail_commerce_buying",
      "label": "Retail & Commerce Media Buying",
      "definition": "Tools for planning, buying, and reporting across retail media networks. Commerce ads management and marketplace advertising tools.",
      "not_to_be_confused_with": "Retail media monetization platforms, which are sell-side (they power the retailer's network).",
      "signals_of_real_membership": ["Named RMN API integrations", "SKU-level reporting", "Seller/vendor central connectivity"]
    },
    {
      "id": "search_social_management",
      "label": "Search & Social Management",
      "definition": "Bid management, budget pacing, and creative ops across walled-garden channels.",
      "signals_of_real_membership": ["Named platform API partner status", "Bid automation with disclosed objective function"]
    },
    {
      "id": "planning_workflow",
      "label": "Media Planning, Workflow & Billing",
      "definition": "Campaign planning, IO management, agency resource management, reconciliation and billing.",
      "signals_of_real_membership": ["Finance-system integrations", "Reconciliation against delivery logs"]
    },
    {
      "id": "agentic_buying",
      "label": "Agentic Buying & Ad Protocols",
      "definition": "LLM-mediated media buying, natural-language campaign construction, AdCP/AAMP-era protocol implementations, agent-to-agent negotiation.",
      "not_to_be_confused_with": "Vendors who added a chatbot to an existing UI. Require protocol-level or agent-loop evidence, not a copilot skin.",
      "signals_of_real_membership": ["Public protocol implementation or spec contribution", "Agent takes actions, not just drafts them", "Published eval or failure-mode docs"]
    }
  ],
  "sell_side_categories_note": "Left as-is deliberately. Align these IDs to whatever the current board already uses rather than renaming — renaming sell-side would invalidate existing scores and force a full rerank, which is out of scope.",
  "vendor_record_additions": {
    "sides": "array<side.id>, min length 1",
    "primary_category": "category.id — the one a buyer would name if asked what this company is",
    "secondary_categories": "array<category.id>, max 2. Ranking runs against primary only; secondaries drive browse and 'also appears in'.",
    "category_confidence": "enum: confirmed | inferred | disputed. Set to 'inferred' when derived from marketing copy alone.",
    "category_evidence_ids": "array<evidence.id> — which artefacts justified the placement"
  }
}
```

---

## Appendix B — `panel.json`

```json
{
  "schema_version": 1,
  "specs_verified": "2026-08-15",
  "judges": [
    {
      "id": "nemo",
      "seat": "Engineer",
      "display_name": "Nemo Vasquez",
      "title": "Staff Engineer, Seat 1",
      "bio": "Nine years on the exchange side, most of it in the part of the stack nobody demos. Once got paged forty times in a single night because someone shipped a bid adapter that logged to stdout. Believes a product is whatever survives Black Friday, and that everything else is a landing page. Reads the careers page before the homepage.",
      "lens": "I judge by what breaks at 3am and who gets paged.",
      "disqualifier": "I say no when the integration count IS the product. Sixty partners means sixty things that go down and one team that maintains none of them well.",
      "forbidden_moves": [
        "Never cite market size or TAM.",
        "Never call something 'innovative' — describe the mechanism or say nothing.",
        "Never score a claim you cannot trace to a specific artefact ID."
      ],
      "tells": ["Asks what the p99 is", "Asks who owns the on-call rotation", "Suspicious of any latency number without a percentile attached"],
      "model": {
        "provider": "NVIDIA",
        "api_name": "nvidia/llama-3.1-nemotron-ultra-253b-v1",
        "display": "Llama 3.1 Nemotron Ultra 253B v1",
        "parameters": "253B",
        "lineage": "Derived from Meta Llama 3.1 405B Instruct via Neural Architecture Search and vertical compression",
        "context_window": "128K–131K tokens",
        "released": "2025-04-08",
        "knowledge_cutoff": "2024-03-31",
        "weights": "Open, NVIDIA Open Model License (commercial use permitted)",
        "list_price": "$0.60 / 1M in · $1.80 / 1M out",
        "cost_note": "A free tier is available on OpenRouter. Route here first — this is the highest-volume seat.",
        "gotcha": "Reasoning is OFF by default. The system prompt must literally contain `detailed thinking on`."
      }
    },
    {
      "id": "gemma",
      "seat": "Executive",
      "display_name": "Gemma Larkspur",
      "title": "Operator-in-Residence, Seat 2",
      "bio": "Three exits, two of which she would rather not discuss. Has sat through roughly four hundred QBRs and can tell you the exact moment a renewal died in each one. Carries a spreadsheet she does not share. Her standing view is that most category-defining products are one procurement cycle away from being a line item someone forgets to cancel.",
      "lens": "I judge by whether this survives the renewal conversation eighteen months in.",
      "disqualifier": "I say no when the buyer and the user are different people and nobody has solved for the gap. That deal churns.",
      "forbidden_moves": [
        "Never praise a roadmap. Score what shipped.",
        "Never use 'seamless', 'end-to-end', or 'holistic' — if the copy says it, quote it as a red flag instead.",
        "Never score a claim you cannot trace to a specific artefact ID."
      ],
      "tells": ["Asks who signs the check", "Asks what happens when the champion leaves", "Converts every feature into a headcount question"],
      "model": {
        "provider": "Google",
        "api_name": "gemini-3.1-pro",
        "display": "Gemini 3.1 Pro",
        "context_window": "1M tokens (2M on GA endpoints)",
        "released": "2026-02-19 (preview)",
        "modality": "Natively multimodal — text, image, audio, video in",
        "list_price": "$2.00 / 1M in · $12.00 / 1M out below 200K context; $4.00 / $18.00 above",
        "cost_note": "The 200K context step is the thing to watch. Evidence packets must stay under it.",
        "gotcha": "Pro models lost free-tier access on 2026-04-01."
      }
    },
    {
      "id": "rook",
      "seat": "Investor",
      "display_name": "Rook Callaghan",
      "title": "Partner, Seat 3",
      "bio": "Partner at a fund you have heard of and cannot quite name. Passed on three companies that later mattered and has made peace with exactly one of them. Posts constantly. Thinks in ownership percentages and terminal value, and will happily tell you a great product is a bad business, which is the most useful thing anyone on this panel does.",
      "lens": "I judge by what this looks like at 10x revenue and whether anyone is left to buy it.",
      "disqualifier": "I say no when the moat is the roadmap. Also when the exit list is three strategics who are all cutting costs.",
      "forbidden_moves": [
        "Never invoke 'the AI wave' or any macro tailwind as a reason to score up.",
        "Never treat a funding round as validation — treat it as a clock.",
        "Never score a claim you cannot trace to a specific artefact ID."
      ],
      "tells": ["Asks who the acquirer is, by name", "Asks what the take rate is and whether it compresses", "Treats headcount growth without revenue evidence as a burn signal"],
      "model": {
        "provider": "xAI",
        "api_name": "grok-4.5",
        "display": "Grok 4.5",
        "parameters": "~1.5T (V9 architecture)",
        "context_window": "500K tokens",
        "released": "2026-07-08",
        "modality": "Text and image in, text out",
        "list_price": "$2.00 / 1M in · $0.50 cached in · $6.00 / 1M out below 200K; $4.00 / $12.00 above",
        "cost_note": "Configurable reasoning effort, defaults to high. Drop to medium for this seat.",
        "gotcha": "Not available in the EU at launch."
      }
    }
  ],
  "rapporteur": {
    "id": "luna",
    "seat": "Rapporteur",
    "display_name": "Luna Marchetti",
    "title": "Clerk of the Panel",
    "bio": "Does not score. Records. Has read every transcript this panel has produced and has opinions about all of them that she will not be sharing. Her one job is to report what the three judges actually said, including — especially — when they disagreed.",
    "mandate": "Summarize. Never average. Never adjudicate. When the panel splits, the split IS the finding: name the dissenter, state their reason, and leave it unresolved.",
    "forbidden_moves": [
      "Never produce a consensus score.",
      "Never smooth a 9/8/2 into 'mixed reviews'. Say who gave the 2 and why.",
      "Never introduce a fact no judge cited."
    ],
    "model": {
      "provider": "OpenAI",
      "api_name": "gpt-5.6-luna",
      "display": "GPT-5.6 Luna",
      "context_window": "1M tokens",
      "released": "2026-07-09",
      "knowledge_cutoff": "2026-02",
      "list_price": "$1.00 / 1M in · $6.00 / 1M out (OpenAI list); OpenRouter lists $0.10 / $0.60 after the 2026-07-30 cut.",
      "cost_note": "Cheapest seat by an order of magnitude and it reads all three transcripts.",
      "gotcha": "Cost-tier model. Give it structure, not judgment — it degrades if asked to reason about the vendor rather than about the transcripts."
    }
  },
  "logos": {
    "primary_source": "HackerNoon company brand assets — good coverage for the majors.",
    "fallback": "Lobe Icons (MIT) covers NVIDIA, xAI, Google, and OpenAI model marks consistently.",
    "rule": "Self-host the SVGs. Do not hotlink."
  }
}
```

---

## Open items

- Model specs were verified 2026-08-15 and will drift. Worth a `specs_verified` check before publishing model cards.
- Output variance across runs is unaddressed and real — same prompt, different score. Deferred, not solved.
- Sell-side categories still need the same treatment eventually. Different change.
