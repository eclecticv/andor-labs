/**
 * A real brief, captured from a live run against andorlabs.ca, used only to
 * populate the results section for design review.
 *
 * DEV ONLY — the page imports this behind `import.meta.env.DEV`, so it is tree-
 * shaken out of the production build. Load /tools/subreddit-scout?demo to see
 * the results state without spending an inference call on every look.
 */
export const DEMO_BRIEF = {
  "report": {
    "businessSummary": "And/or Labs is a full-stack GTM studio for AI, adtech, and deeptech startups. Founded by an operator with two exits over $100M, it builds clear positioning, deep market intelligence, and autonomous growth systems for teams whose product is ahead of their story.",
    "audience": "Technical founders, seed/series A startup CEOs, and GTM leaders in AI, adtech, and deeptech.",
    "category": "B2B Go-To-Market & Growth Consultancy",
    "subreddits": [
      {
        "name": "r/SaaS",
        "size": "~250k members",
        "fit": "Where technical founders and early-stage operators discuss building, scaling, and marketing software companies.",
        "rewards": "Deep technical breakdowns, revenue transparency, unvarnished operational war stories, and counter-intuitive growth insights.",
        "rules": "Strict self-promotion bans; no direct links in post bodies; link-in-comment rules apply after providing substantial value; no generic pitch posts.",
        "firstPost": "Share a detailed case study on why most AI positioning sounds identical and the exact four-part framework used to fix it without mentioning agency services."
      },
      {
        "name": "r/LocalLLaMA",
        "size": "~300k members",
        "fit": "Home to practitioners, builders, and founders deploying open-source models and AI infrastructure who need GTM help.",
        "rewards": "Actionable benchmarks, open code, hardware comparisons, and discussions on practical monetization of AI agents.",
        "rules": "No pure marketing fluff or agency spam; technical depth required; self-promotion restricted to dedicated showcase threads.",
        "firstPost": "Break down how to build an internal agentic research workflow for market intelligence using local models, offering the prompt templates for free."
      },
      {
        "name": "r/cofounder",
        "size": "~60k members",
        "fit": "Early-stage technical builders looking for strategic operators and go-to-market help to bridge the product-market gap.",
        "rewards": "Honest equity discussions, realistic milestone breakdowns, and clear operator-to-builder collaboration frameworks.",
        "rules": "Require adherence to format guidelines; no low-effort outsourcing pitches; transparent role descriptions mandatory.",
        "firstPost": "Write a candid post outlining the exact moment a technical startup needs a fractional GTM lead versus a full-time hire."
      },
      {
        "name": "r/ProductManagement",
        "size": "~350k members",
        "fit": "Product leaders and founders transitioning from pure engineering to commercialization, product marketing, and positioning.",
        "rewards": "Rigorous frameworks, metrics-driven case studies, honest failures, and discussions on pricing strategy.",
        "rules": "Zero tolerance for recruiter spam or agency promotion; submissions must focus on product craft and go-to-market alignment.",
        "firstPost": "Share a teardown of why technical product positioning fails and how to translate complex AI capabilities into buyer outcomes."
      },
      {
        "name": "r/startups",
        "size": "~1.5M members",
        "fit": "Massive community of founders at all stages seeking advice on fundraising, go-to-market strategy, and scaling.",
        "rewards": "High-value post-mortems, detailed metrics deep dives, and counter-conventional advice on early traction.",
        "rules": "AutoModerator flags links and promotional patterns instantly; high karma gate for link posts; zero self-promotion in main feed.",
        "firstPost": "Publish an extensive retrospective on how two-exit tech startups fix leaky revenue funnels during their seed-to-series-A transition."
      }
    ],
    "plays": [
      {
        "skillName": "reddit-icp-monitoring",
        "title": "ICP Pain Point and Discussion Monitor",
        "description": "Scrapes and surfaces high-intent founder discussions on product positioning and growth.",
        "goal": "Identify founders actively complaining about long sales cycles, muddy positioning, or stagnant GTM pipelines to engage helpfully.",
        "inputs": [
          "r/SaaS, r/cofounder, r/startups",
          "Keywords: positioning, GTM, sales cycle, pipeline stall, messaging",
          "Target post age: < 48 hours"
        ],
        "steps": [
          "Search the target subreddits using the provided keywords for posts published within the last 48 hours.",
          "Filter out low-effort complaint threads and keep posts where technical founders discuss specific revenue or positioning bottlenecks.",
          "Extract the top 5 most relevant thread URLs along with a 2-sentence summary of each founder's core problem.",
          "Draft a helpful, non-promotional response for each thread that directly addresses the technical positioning flaw without mentioning any services.",
          "Report back with the formatted draft responses and thread links for human review."
        ],
        "guardrails": [
          "Requires explicit human approval before any comment is posted, maintaining a 9:1 value-to-promo ratio with an aged account.",
          "Never include links in the drafted comments to avoid AutoModerator link filters."
        ],
        "output": "A CSV containing thread URLs, founder problems, and drafted advisory responses.",
        "cadence": "Weekly",
        "measure": "Number of relevant founder conversations joined and organic profile visits generated."
      },
      {
        "skillName": "subreddit-case-study",
        "title": "Deep-Dive Value Post Generator",
        "description": "Synthesizes proprietary operational experience into high-value native Reddit guides.",
        "goal": "Establish topical authority by publishing actionable teardowns of AI and deeptech positioning mistakes.",
        "inputs": [
          "Brand fact sheet: And/or Labs positioning framework",
          "Target subreddit: r/SaaS",
          "Topic focus: Common AI startup messaging mistakes"
        ],
        "steps": [
          "Analyze the top 10 all-time posts in the target subreddit to determine the preferred formatting, tone, and structural depth.",
          "Draft a comprehensive 800-word case study detailing three specific ways deeptech startups sound identical and how to fix them.",
          "Review the draft to ensure zero promotional language, zero agency mentions, and zero outbound links in the body text.",
          "Format the output with clean markdown headings and bullet points matching community norms.",
          "Report back with the final post text ready for human review and submission."
        ],
        "guardrails": [
          "Human must review and publish manually; account must meet subreddit age and karma requirements before posting.",
          "Avoid repetitive phrasing and promotional keywords that trigger automated spam classifiers."
        ],
        "output": "A complete, formatted native Reddit post ready for manual publication.",
        "cadence": "Bi-weekly",
        "measure": "Upvote ratio, comment engagement rate, and inbound DMs from interested founders."
      },
      {
        "skillName": "reddit-ad-campaign",
        "title": "B2B Founder Ad Campaign Manager",
        "description": "Builds and optimizes targeted Reddit ad campaigns for technical founders.",
        "goal": "Drive qualified traffic from AI and SaaS subreddits to the GTM advisory booking page.",
        "inputs": [
          "Target subreddits: r/SaaS, r/LocalLLaMA",
          "Daily budget cap: $50",
          "Landing page URL: https://andorlabs.ca/"
        ],
        "steps": [
          "Draft 3 distinct text ad variants focusing on founder pain points: muddy positioning, long sales cycles, and leaky funnels.",
          "Configure the targeting parameters for the ad set using the specified subreddits and developer interest categories.",
          "Compile the ad copy, targeting rules, and bidding constraints into a structured setup guide.",
          "Pull campaign performance metrics including CTR, CPC, and conversion rates from the ad dashboard.",
          "Report back with the worst-performing ad variant and a recommended budget reallocation."
        ],
        "guardrails": [
          "Human must approve all ad creative, budget caps, and daily spend limits before launching campaigns.",
          "Actively monitor comment sections on promoted posts to answer technical questions transparently and maintain brand trust."
        ],
        "output": "A performance summary report with campaign metrics and creative optimization recommendations.",
        "cadence": "Weekly",
        "measure": "Cost per click (CPC), click-through rate (CTR), and booked calls originating from Reddit traffic."
      }
    ]
  },
  "url": "https://andorlabs.ca/",
  "partial": false,
  "skillFiles": [
    {
      "filename": "reddit-icp-monitoring.SKILL.md",
      "body": "---\nname: reddit-icp-monitoring\ndescription: Scrapes and surfaces high-intent founder discussions on product positioning and growth.\n---\n\n# ICP Pain Point and Discussion Monitor\n\n## Context\n- Brand site: andorlabs.ca\n- What they sell: And/or Labs is a full-stack GTM studio for AI, adtech, and deeptech startups. Founded by an operator with two exits over $100M, it provides clear positioning, deep market intelligence, and autonomous growth systems. Offerings include GTM Advisory ($1,000/mo + equity), a Modernization Sprint ($10,000 one-time), and Fractional CMO engagements ($5,000/mo).\n- Audience: Technical founders, seed/series A startup CEOs, and GTM leaders in AI, adtech, and deeptech.\n- Target subreddits: r/SaaS (~250k members), r/LocalLLaMA (~300k members), r/cofounder (~60k members), r/ProductManagement (~350k members), r/startups (~1.5M members)\n- Brief generated: 2026-08-13 by Subreddit Scout (andorlabs.ca)\n\n## Goal\nIdentify founders actively complaining about long sales cycles, muddy positioning, or stagnant GTM pipelines to engage helpfully.\n\n## Inputs the human provides\n- r/SaaS, r/cofounder, r/startups\n- Keywords: positioning, GTM, sales cycle, pipeline stall, messaging\n- Target post age: < 48 hours\n\n## Procedure\n1. Search the target subreddits using the provided keywords for posts published within the last 48 hours.\n2. Filter out low-effort complaint threads and keep posts where technical founders discuss specific revenue or positioning bottlenecks.\n3. Extract the top 5 most relevant thread URLs along with a 2-sentence summary of each founder's core problem.\n4. Draft a helpful, non-promotional response for each thread that directly addresses the technical positioning flaw without mentioning any services.\n5. Report back with the formatted draft responses and thread links for human review.\n\n## Guardrails (never skip)\n- Requires explicit human approval before any comment is posted, maintaining a 9:1 value-to-promo ratio with an aged account.\n- Never include links in the drafted comments to avoid AutoModerator link filters.\n- If a step cannot be completed — a subreddit is gone, a rule has changed, an input is missing — stop and report back. Do not guess and do not substitute.\n\n## Output\nA CSV containing thread URLs, founder problems, and drafted advisory responses.\n\n## Cadence\nWeekly\n\n## Success metrics\nNumber of relevant founder conversations joined and organic profile visits generated.\n\nWorks with any agent harness (Claude Code, Codex, Hermes, Cursor, or a plain chat model).\nPrepared by And/or Labs — https://andorlabs.ca"
    },
    {
      "filename": "subreddit-case-study.SKILL.md",
      "body": "---\nname: subreddit-case-study\ndescription: Synthesizes proprietary operational experience into high-value native Reddit guides.\n---\n\n# Deep-Dive Value Post Generator\n\n## Context\n- Brand site: andorlabs.ca\n- What they sell: And/or Labs is a full-stack GTM studio for AI, adtech, and deeptech startups. Founded by an operator with two exits over $100M, it provides clear positioning, deep market intelligence, and autonomous growth systems. Offerings include GTM Advisory ($1,000/mo + equity), a Modernization Sprint ($10,000 one-time), and Fractional CMO engagements ($5,000/mo).\n- Audience: Technical founders, seed/series A startup CEOs, and GTM leaders in AI, adtech, and deeptech.\n- Target subreddits: r/SaaS (~250k members), r/LocalLLaMA (~300k members), r/cofounder (~60k members), r/ProductManagement (~350k members), r/startups (~1.5M members)\n- Brief generated: 2026-08-13 by Subreddit Scout (andorlabs.ca)\n\n## Goal\nEstablish topical authority by publishing actionable teardowns of AI and deeptech positioning mistakes.\n\n## Inputs the human provides\n- Brand fact sheet: And/or Labs positioning framework\n- Target subreddit: r/SaaS\n- Topic focus: Common AI startup messaging mistakes\n\n## Procedure\n1. Analyze the top 10 all-time posts in the target subreddit to determine the preferred formatting, tone, and structural depth.\n2. Draft a comprehensive 800-word case study detailing three specific ways deeptech startups sound identical and how to fix them.\n3. Review the draft to ensure zero promotional language, zero agency mentions, and zero outbound links in the body text.\n4. Format the output with clean markdown headings and bullet points matching community norms.\n5. Report back with the final post text ready for human review and submission.\n\n## Guardrails (never skip)\n- Human must review and publish manually; account must meet subreddit age and karma requirements before posting.\n- Avoid repetitive phrasing and promotional keywords that trigger automated spam classifiers.\n- If a step cannot be completed — a subreddit is gone, a rule has changed, an input is missing — stop and report back. Do not guess and do not substitute.\n\n## Output\nA complete, formatted native Reddit post ready for manual publication.\n\n## Cadence\nBi-weekly\n\n## Success metrics\nUpvote ratio, comment engagement rate, and inbound DMs from interested founders.\n\nWorks with any agent harness (Claude Code, Codex, Hermes, Cursor, or a plain chat model).\nPrepared by And/or Labs — https://andorlabs.ca"
    },
    {
      "filename": "reddit-ad-campaign.SKILL.md",
      "body": "---\nname: reddit-ad-campaign\ndescription: Builds and optimizes targeted Reddit ad campaigns for technical founders.\n---\n\n# B2B Founder Ad Campaign Manager\n\n## Context\n- Brand site: andorlabs.ca\n- What they sell: And/or Labs is a full-stack GTM studio for AI, adtech, and deeptech startups. Founded by an operator with two exits over $100M, it provides clear positioning, deep market intelligence, and autonomous growth systems. Offerings include GTM Advisory ($1,000/mo + equity), a Modernization Sprint ($10,000 one-time), and Fractional CMO engagements ($5,000/mo).\n- Audience: Technical founders, seed/series A startup CEOs, and GTM leaders in AI, adtech, and deeptech.\n- Target subreddits: r/SaaS (~250k members), r/LocalLLaMA (~300k members), r/cofounder (~60k members), r/ProductManagement (~350k members), r/startups (~1.5M members)\n- Brief generated: 2026-08-13 by Subreddit Scout (andorlabs.ca)\n\n## Goal\nDrive qualified traffic from AI and SaaS subreddits to the GTM advisory booking page.\n\n## Inputs the human provides\n- Target subreddits: r/SaaS, r/LocalLLaMA\n- Daily budget cap: $50\n- Landing page URL: https://andorlabs.ca/\n\n## Procedure\n1. Draft 3 distinct text ad variants focusing on founder pain points: muddy positioning, long sales cycles, and leaky funnels.\n2. Configure the targeting parameters for the ad set using the specified subreddits and developer interest categories.\n3. Compile the ad copy, targeting rules, and bidding constraints into a structured setup guide.\n4. Pull campaign performance metrics including CTR, CPC, and conversion rates from the ad dashboard.\n5. Report back with the worst-performing ad variant and a recommended budget reallocation.\n\n## Guardrails (never skip)\n- Human must approve all ad creative, budget caps, and daily spend limits before launching campaigns.\n- Actively monitor comment sections on promoted posts to answer technical questions transparently and maintain brand trust.\n- If a step cannot be completed — a subreddit is gone, a rule has changed, an input is missing — stop and report back. Do not guess and do not substitute.\n\n## Output\nA performance summary report with campaign metrics and creative optimization recommendations.\n\n## Cadence\nWeekly\n\n## Success metrics\nCost per click (CPC), click-through rate (CTR), and booked calls originating from Reddit traffic.\n\nWorks with any agent harness (Claude Code, Codex, Hermes, Cursor, or a plain chat model).\nPrepared by And/or Labs — https://andorlabs.ca"
    }
  ]
} as const;
