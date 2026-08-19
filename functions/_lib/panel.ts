/**
 * The panel.
 *
 * Three models from three different labs are handed the same evidence and asked
 * the same three questions, each wearing a different hat. A fourth model, from
 * a fourth family, reads all nine answers and writes the narrative. It never
 * scores anything — the numbers are the panel's, the prose is the writer's.
 *
 * ── Why nine ratings and not three ──
 * One model per question would be a division of labour. Three models on every
 * question is a jury: where they agree the claim is strong, and where they
 * split, that split is the most interesting thing on the page. "All three said
 * a competent engineer could rebuild this in a fortnight" is very hard to argue
 * with; one model saying it is an opinion.
 *
 * ── Why the scales are anchored ──
 * Determinism was an explicit requirement: re-runs should land in roughly the
 * same place and ties should be rare. Temperature 0 only removes sampling
 * noise. The real drift comes from an unanchored "rate this 0-10", where the
 * model reinvents the scale on every call. Naming what each band MEANS turns
 * scoring into classification against fixed points, which is both repeatable
 * and far more spread out — nine anchored numbers tie much less often than
 * nine vibes.
 *
 * ── One inversion, deliberately ──
 * The engineer is asked whether a weekend of vibe-coding could reproduce the
 * product, but the SCORE records difficulty: 10 is years of systems work, 0 is
 * a weekend and an API key. Scoring it the other way round would mean a company
 * could climb the leaderboard by being easy to clone, since the other two
 * questions both run good-is-high.
 */

import { askLadder, extractJson, type Provider, type ProviderEnv } from "./providers";
import { factsBlock, pressBlock, type CompanyFacts, type PressItem } from "./facts";

// ── The panelists ───────────────────────────────────────────────────────────

export interface Panelist {
  id: string;
  /** Display name, as it appears on the page. */
  name: string;
  lab: string;
  provider: Provider;
  /** Preferred model id; the provider ladder supplies fallbacks. */
  model: string;
  /**
   * Published specifications only.
   *
   * Several frontier labs disclose nothing about size or architecture, and an
   * invented parameter count on a page whose whole premise is transparency
   * would be the one lie that discredits everything around it. Where a number
   * is not public, this says so.
   */
  spec: string;

  /**
   * The character in the seat.
   *
   * A seat is a person, not a hat that gets swapped per question. The three
   * fields below are what hold that: `lens` is how they read anything, and it
   * does not change between innovation and outlook; `disqualifier` is the
   * specific thing that makes them say no; `forbidden` is what they will not do
   * even when the question invites it.
   *
   * The disqualifier is load-bearing. Without a concrete "here is what makes me
   * say no", a persona flattens into generic-analyst voice by the third
   * question — which is exactly what the previous per-question personas did.
   */
  character: string;
  title: string;
  bio: string;
  lens: string;
  disqualifier: string;
  forbidden: string[];
  /**
   * Prepended verbatim to this seat's system message, before anything else.
   *
   * Exists for NVIDIA's Nemotron line, which ships with reasoning OFF and turns
   * it on only if the literal string `detailed thinking on` appears in the
   * system prompt. Without it you pay reasoning-model latency for a
   * non-reasoning answer.
   */
  systemPrefix?: string;
}

/**
 * Three seats, three labs, four families once the writer is counted.
 *
 * Every seat is PINNED to one model — see `only` in providers.ts. A seat that
 * cannot answer abstains; nothing else is ever seated in its place, because a
 * board whose rows were judged by different juries is a board whose numbers are
 * not comparable to each other.
 */
export const PANELISTS: Panelist[] = [
  {
    id: "nemotron",
    name: "Nemotron 3 Ultra",
    lab: "NVIDIA",
    provider: "nvidia",
    /**
     * Ultra, and on NIM, which is NVIDIA's own inference for its own models.
     *
     * Not `llama-3.1-nemotron-ultra-253b-v1` — that one lists in the NIM
     * catalogue and returns 404 "Not found for account" when called, so it is
     * visible but not provisioned here.
     *
     * Ultra was previously demoted below Super for exhausting its budget. It
     * no longer does: measured against the real panel prompt on 2026-08-15 it
     * returned complete, valid JSON in 76.4s. That is comfortably inside the
     * raised 120s deadline and would have been four seconds outside the old
     * 75s one — which is the whole reason the deadline moved.
     */
    model: "nvidia/nemotron-3-ultra-550b-a55b",
    spec: "Mixture-of-experts, 550B total parameters with roughly 55B active per token — both numbers are published in the model's own name. Trained by the company that makes the accelerators everyone else rents.",
    /**
     * One name, no surname, and deliberately machine-flavoured.
     *
     * A surname implies a person with a life outside the panel, which these do
     * not have — they are lenses with a voice. A single celestial-sounding
     * first name reads as what it is: a named model persona, not a fake
     * analyst. It also keeps the byline short enough to sit beside a score.
     *
     * None of the four may collide with a real model name, or the page starts
     * arguing with itself. "Gemma" had to go for exactly that reason: it is
     * one of Google's own open models, sitting on the Google seat.
     */
    character: "Nemo",
    title: "Staff Engineer, Seat 1",
    bio: "Nine years on the exchange side, most of it in the part of the stack nobody demos. Once got paged forty times in a single night because someone shipped a bid adapter that logged to stdout. Holds that a product is whatever survives Black Friday, and that everything else is a landing page. Reads the careers page before the homepage.",
    lens: "I judge by what breaks at 3am and who gets paged.",
    disqualifier:
      "I say no when the integration count IS the product. Sixty partners means sixty things that go down and one team that maintains none of them well.",
    forbidden: [
      "Never cite market size or TAM.",
      "Never call something 'innovative' — describe the mechanism or say nothing.",
      "Never accept a latency number that has no percentile attached.",
    ],
    systemPrefix: "detailed thinking on",
  },
  {
    id: "glm",
    name: "GLM 5.3",
    lab: "Zhipu AI",
    /**
     * This seat was specified as Grok, and Grok is not reachable: grok-4.5
     * lists in OpenCode Go's catalogue and fails upstream of it on every call
     * (re-verified 2026-08-15). It is the only xAI model Go carries, so no xAI
     * seat exists on this key.
     *
     * Qwen 3.8 Max held the seat briefly and had to go, for a reason that only
     * appears now that seats are pinned: it is too slow on real pages. Measured
     * against the same 37K-character prompt on 2026-08-15:
     *
     *   glm-5.3          61.6s   usable
     *   deepseek-v4-pro  77.0s   usable
     *   qwen3.8-max     136.9s   usable, but past any sane deadline
     *   kimi-k2.6        62.9s   leaks persona reasoning into the content field
     *   minimax-m2.7     25.7s   fences its JSON in markdown
     *   qwen3.7-max      65.6s   truncated JSON
     *
     * Latency used to be a quality-of-service problem: a slow rung cost a round
     * trip and the ladder moved on. With no substitutes it is a correctness
     * problem — a seat that misses the deadline fails the whole ranking, and
     * Qwen did exactly that on two of the first six re-ranks.
     *
     * GLM is the fastest model here that answers cleanly, and it is a fourth
     * lab. It is also already proven on this exact workload: it is one of the
     * models the old open ladder seated when DeepSeek failed.
     */
    provider: "opencode",
    model: "glm-5.3",
    spec: "Open weights with a published architecture, though the exact size of this tier is undisclosed. Built by a lab that spun out of Tsinghua and ships more than it announces.",
    character: "Atlas",
    title: "Partner, Seat 2",
    bio: "Partner at a fund you have heard of and cannot quite name. Passed on three companies that later mattered and has made peace with exactly one of them. Posts constantly. Thinks in ownership percentages and terminal value, and will happily tell you a great product is a bad business, which is the most useful thing anyone on this panel does.",
    lens: "I judge by what this looks like at 10x revenue and whether anyone is left to buy it.",
    disqualifier:
      "I say no when the moat is the roadmap. Also when the exit list is three strategics who are all cutting costs.",
    forbidden: [
      "Never invoke 'the AI wave' or any macro tailwind as a reason to score up.",
      "Never treat a funding round as validation — treat it as a clock.",
      "Never name an acquirer you cannot name specifically.",
    ],
  },
  {
    id: "gemini",
    name: "Gemini 3.5 Flash Lite",
    lab: "Google DeepMind",
    // Lite, and every word of that is measured rather than chosen. 3.6 and 3.7
    // return 503 on every call; 3.5-flash returns 429 on this key often enough
    // that flash-LITE answered 22 of the first 23 rankings. Declaring anything
    // above it names a model that does not turn up and burns a round trip
    // finding that out.
    provider: "gemini",
    model: "gemini-3.5-flash-lite",
    spec: "The smaller of Google's fast tiers. Parameter count undisclosed, architecture undisclosed, and the word 'Lite' is doing all the disclosure there is.",
    // Not "Gemma": that is one of Google's own open models, and this is the
    // Google seat. A persona named after a sibling model on the same lab's
    // card is a collision waiting to confuse somebody.
    character: "Juno",
    title: "Operator-in-Residence, Seat 3",
    bio: "Three exits, two of which are not up for discussion. Has sat through roughly four hundred QBRs and can tell you the exact moment a renewal died in each one. Keeps a spreadsheet nobody else gets to see. Holds that most category-defining products are one procurement cycle away from being a line item someone forgets to cancel.",
    lens: "I judge by whether this survives the renewal conversation eighteen months in.",
    disqualifier:
      "I say no when the buyer and the user are different people and nobody has solved for the gap. That deal churns.",
    forbidden: [
      "Never praise a roadmap. Score what shipped.",
      "Never use 'seamless', 'end-to-end', or 'holistic' — if the copy says it, quote it as a red flag instead.",
      "Never convert a feature into anything but a headcount question.",
    ],
  },
];

/** The fourth family. Writes, never scores. */
export const WRITER = {
  name: "GPT-5.6 Luna",
  lab: "OpenAI",
  provider: "opencode" as Provider,
  model: "gpt-5.6-luna",
  spec: "Parameter count undisclosed. Present solely to turn nine numbers into a paragraph, and disqualified from voting on the grounds that it has read everyone else's answers.",
  character: "Vega",
  title: "Clerk of the Panel",
  // Not "Luna": the model in this seat is literally GPT-5.6 Luna, so the
  // character and the model would have been the same word — the one pairing
  // that makes "who wrote this" and "what produced it" impossible to tell
  // apart, on the seat whose whole job is attribution.
  bio: "Does not score. Records. Has read every transcript this panel has produced and holds opinions about all of them that are not going in the write-up. Has one job: report what the three judges actually said, including — especially — where they disagreed.",
  /**
   * The clerk never averages.
   *
   * Three jurors landing on 8/8/8 and three landing on 9/8/2 produce the same
   * mean and mean opposite things, and the second is the more interesting row
   * on the board. Collapsing it to "mixed reviews" throws away the only thing
   * three independent opinions bought.
   */
  mandate:
    "Summarize. Never average. Never adjudicate. When the panel splits, the split IS the finding: name the dissenter, state their reason, and leave it unresolved.",
};

// ── The questions ───────────────────────────────────────────────────────────

export interface Question {
  key: QuestionKey;
  label: string;
  ask: string;
  /** What each band of the 0-10 scale means. THE determinism lever. */
  anchors: string;
}

export type QuestionKey = "innovation" | "difficulty" | "outlook";

/**
 * The rubric. Identical for every seat, and carrying no persona.
 *
 * Personas used to live here, one per question, which meant all three jurors
 * wore all three hats and the panel was three copies of the same committee. The
 * lens now belongs to the juror (see PANELISTS) and never moves; what varies
 * per question is only what is being asked and how the scale is anchored.
 */
/**
 * The five verdicts, and the only vocabulary a juror may score in.
 *
 * ── Why words and not numbers ──
 * A model asked for "0-10" reinvents the scale on every call; the anchors were
 * always there to turn scoring into classification against fixed points. This
 * finishes that job. A juror now picks one of five words and never emits a
 * number at all, which is also the existing rule that totals are arithmetic in
 * code and never asked of a model.
 *
 * ── Why every question reads the same direction ──
 * "Hard to build" used to be scored inverted — the ask was whether a weekend
 * could reproduce it while the SCORE recorded difficulty, and that inversion was
 * a permanent trap for both the jurors and anyone reading the rubric. Phrased as
 * yes/no questions where yes is always the stronger answer, the inversion
 * disappears: "is this hard to replicate" and "will this still matter" now point
 * the same way, and a company cannot climb the board by being easy to clone.
 *
 * The numbers behind the words keep the 0-10 column and the decimal mean, which
 * is what stops the board tying.
 */
export const VERDICTS = ["hard no", "no", "kinda", "yes", "extremely"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const VERDICT_SCORE: Record<Verdict, number> = {
  "hard no": 0, no: 3, kinda: 5, yes: 8, extremely: 10,
};

export const QUESTIONS: Question[] = [
  {
    key: "innovation",
    label: "Innovation",
    /**
     * The framing was already precedence — "was this first" — and the anchors
     * still scored the present tense, which quietly undid it.
     *
     * "A competent take on an idea the category already had" has no date on it,
     * so a juror reading a 2026 homepage reads "the category" as the category
     * NOW. Every mechanism a mature company established has since been copied,
     * which means the more successfully a company innovated, the more ordinary
     * its own pages look. Measured on the board: a company that demonstrably
     * created its category still landed mid-scale on all three seats, because
     * all three were answering "is this novel today" — a question about the
     * market, not about the company.
     *
     * Same failure mode as investability, and the same fix that worked there:
     * name the confound as a scoring rule rather than trusting the phrasing to
     * carry it. The founding year is already in ESTABLISHED FACTS and the
     * origin-angle coverage is already in the evidence block; both were being
     * handed over and neither was being asked for.
     */
    /**
     * Kept SHORT, like the outlook question and for the same measured reason.
     *
     * The first draft of this fix spelled both mechanisms out across three
     * extra sentences, and the largest corpus on the board then timed out a
     * pinned seat three times at the 120s cap. Prompt length is the latency
     * budget: the rules survive, the essay does not.
     */
    ask: "Was this first, or only? Judge against the category in their founding year, not today. Name what did not exist before them, and what shows it.",
    anchors: `Ubiquity is EVIDENCE: standard today BECAUSE they established it scores HIGH.
Never mark a company down for having been copied.

extremely — the category did not have this until them
yes        — a real insight, conventionally executed
kinda      — a competent take on an idea the category already had at the time
no         — a familiar idea, restated
hard no    — nothing here was new even then`,
  },
  {
    key: "difficulty",
    label: "Hard to build",
    /**
     * "Could this be vibe-coded" produced rave scores, because a juror
     * pattern-matches a feature list to a weekend build and a feature list is
     * mostly what a homepage is. The fix for that was a closed list of six
     * bottlenecks to choose from, and the fix was worse than the fault: a
     * forced choice puts the first item in front of the model on every company,
     * so jurors reached for "sustained QPS at a latency SLA" — item one — about
     * businesses whose real constraint was commercial. Three labs naming the
     * same bottleneck looked like agreement and was our menu coming back.
     *
     * The ask now demands a named bottleneck and does not say what the
     * candidates are. Naming one is the juror's work.
     */
    ask: `Is this hard to replicate? Name the single hardest thing about it and what on the pages tells you so — the bottleneck, not the product. If nothing supports a real barrier, say so; that is a common and legitimate finding.`,
    anchors: `extremely — years of accumulated work, or rests on something nobody else has
yes        — hard; a strong team would need many months
kinda      — substantial but standard; the problems are known ones
no         — a competent team could approximate it in weeks
hard no    — trivial`,
  },
  {
    key: "outlook",
    label: "Future outlook",
    /**
     * Replaces "Would you invest in this?", which was measuring the wrong
     * thing and measuring it against the wrong companies.
     *
     * That question asked a juror to imagine a transaction, so anything that
     * made the transaction impossible read as a defect in the COMPANY:
     * already acquired, bootstrapped and not raising, too mature to have a
     * round open. It was a liquidity question wearing a quality question's
     * clothes, and on a board of private adtech it systematically punished the
     * companies with the best outcomes.
     *
     * Outlook asks about the company's future rather than the reader's. It
     * also widens what "survives" means: durability alone is the pessimistic
     * half of the question, so a juror could only ever fail to mark a company
     * down. Weighing the direction of the need and the size of the market
     * alongside the headwinds means a tailwind can raise a score.
     */
    /**
     * Kept SHORT on purpose, and the first draft was not.
     *
     * Written as "weigh three things and say which dominates", it asked for
     * three sub-analyses per seat where the other two questions ask for one
     * judgement. Measured against the real corpus, that took the panel from
     * ~80s to two seats timing out at 120s twice each — the reasoning is
     * output tokens, and output tokens are the latency. The question survives
     * intact; the essay does not.
     */
    ask: "Will this still matter in three years? Name the single thing that decides it, and what on the pages tells you so.",
    anchors: `Acquisition is an OUTCOME, not a verdict: absorbed and still shipping under its
own name scores HIGH, absorbed and folded into a suite scores low. Never score
on independence itself.

extremely — the need is growing, the market is large, conditions favour them
yes        — a durable need, with one identifiable headwind
kinda      — depends on the category staying roughly as it is
no         — a real headwind, or a market narrowing around them
hard no    — the need itself is going away`,
  },
];

// ── Shapes ──────────────────────────────────────────────────────────────────

export interface Rating {
  /** The word the juror actually chose. What the page shows. */
  verdict: Verdict;
  /** Its position on the 0-10 scale. What the arithmetic uses. */
  score: number;
  summary: string;
}

export interface PanelistTake {
  panelistId: string;
  modelUsed: string;
  ratings: Record<QuestionKey, Rating>;

  /**
   * Three reasons the company is weaker than it looks, written BEFORE scoring.
   *
   * Its job is done at generation time: a juror who has just written down what
   * is wrong scores the next three questions differently than one who has not.
   * Not persisted yet — that lands with the evidence packet, which needs a
   * migration anyway. Read it in the local runner when tuning the rubric.
   */
  caseAgainst: string[];

  /** One word for the company overall. This is what a board row carries. */
  adjective: string;

  /**
   * Two facts each panelist is asked to recall, resolved later by majority.
   *
   * These are NOT judgements and are kept strictly apart from the ratings —
   * see the note on `buildPanelPrompt` for why they are generated last.
   */
  recall: {
    /** Subcategory key, or "" when the panelist would not commit. */
    category: string;
    /** Round label — pre-seed | seed | series-a … later — or "" for unknown. */
    round: string;
    /** Year of that round, or 0. Required detail; see resolveRecall. */
    year: number;
    /** Lead investor, or "". The third leg of the corroboration triple. */
    investor: string;
  };
}

// ── Prompts ─────────────────────────────────────────────────────────────────

export interface PanelInput {
  domain: string;
  /** Page text, each section headed. */
  pages: string;
  /**
   * Third-party facts, when a lookup found them. Null simply means the jurors
   * work from the site alone, as they always did.
   */
  facts?: CompanyFacts | null;
  /** Third-party coverage, excerpted. Evidence the website does not carry. */
  press?: PressItem[];
  /** True when the site rendered to almost nothing. */
  thin: boolean;
  /** The closed subcategory set, passed in so _lib/panel owns no taxonomy. */
  categories: readonly { key: string; label: string }[];
  /**
   * Optional per-key "not to be confused with" notes, keyed by category.
   *
   * Categories that sound alike are the ones a model gets wrong, because
   * marketing copy is written to sound like the more impressive neighbour.
   */
  categoryNotes?: Partial<Record<string, string>>;
}

/**
 * Who the juror is. Sent as the system message, never as part of the rubric.
 *
 * The split is the point. Every seat receives a byte-identical rubric, which is
 * what makes three scores comparable; the system message is the only thing that
 * differs, which is what makes them three opinions rather than one opinion
 * sampled three times.
 */
export function buildPanelSystem(p: Panelist): string {
  return `${p.systemPrefix ? `${p.systemPrefix}\n\n` : ""}You are ${p.character}, ${p.title} on a public adtech leaderboard.

${p.bio}

How you read anything: ${p.lens}

What makes you say no: ${p.disqualifier}

You will not:
${p.forbidden.map((f) => `  - ${f}`).join("\n")}

You hold this lens for EVERY question you are asked, including the ones that
seem addressed to somebody else. When you are asked where a company sits in
three years, you answer as ${p.character} — not as an analyst. When you are
asked how hard something is to build, you answer as ${p.character} — not as an
engineer. The other two judges have their own lenses and will disagree with
you. That is the design. Do not move toward them.

Two other models, from two other labs, are answering the same questions about
the same company right now. You cannot see their answers and they cannot see
yours.`;
}

/**
 * The panel response, as a schema a decoder can enforce.
 *
 * The prompt already describes this shape, and describing it was not enough:
 * Flash Lite returned `"summary":Staging a ...` on playwire.com — an unquoted
 * string, so not JSON. At temperature 0 that repeats exactly, so the seat
 * failed three identical retries and would have failed indefinitely. A schema
 * is the difference between asking for a shape and constraining the decoder to
 * produce one.
 *
 * Gemini honours this via `responseSchema`; the OpenAI-compatible seats already
 * run with `response_format: json_object` and have not produced malformed JSON.
 * Kept in OpenAPI-ish form because that is what Gemini accepts.
 */
const RATING_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", description: "one of: hard no, no, kinda, yes, extremely" },
    summary: { type: "string" },
  },
  required: ["verdict", "summary"],
};

export const PANEL_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    case_against: { type: "array", items: { type: "string" } },
    innovation: RATING_SCHEMA,
    difficulty: RATING_SCHEMA,
    outlook: RATING_SCHEMA,
    adjective: { type: "string" },
    category: { type: "string" },
    funding: {
      type: "object",
      properties: {
        round: { type: "string" },
        year: { type: "integer" },
        investor: { type: "string" },
      },
      required: ["round", "year", "investor"],
    },
  },
  required: [
    "case_against", "innovation", "difficulty", "outlook",
    "adjective", "category", "funding",
  ],
};

export function buildPanelPrompt(input: PanelInput): string {
  const categories = input.categories
    .map((c) => {
      const note = input.categoryNotes?.[c.key];
      return `    ${c.key} — ${c.label}${note ? `\n        ${note}` : ""}`;
    })
    .join("\n");

  const questions = QUESTIONS.map(
    (q) => `── ${q.key.toUpperCase()} ──
${q.ask}

Score 0-10 against these anchors. Pick the band that fits and use its number;
do not invent a scale of your own:
${q.anchors}`,
  ).join("\n\n");

  return `Answer all three questions below, in character, from the pages provided.

═══ BEFORE YOU SCORE ANYTHING ═══
Write "case_against": three specific reasons this company is weaker than it
looks, each one pointing at something you actually read on the pages. Do this
FIRST, before any score exists.

This is not a formality and it is not pessimism. Marketing language survives the
question "why is this good" — it is built to. It does not survive "what is the
hard part here" asked before you have committed to a position. A juror who
scores first and justifies after has written a press release.

═══ HOW TO SCORE ═══
Ground every claim in the pages. You have the company's own site and nothing
else, and that asymmetry runs one way: a site says what a company wants said,
so a claim you cannot point at is not a neutral unknown — it is an absence.

  - Start each question at 4. Argue UPWARD from there with evidence, or leave
    it. Optimism costs something; vagueness does not earn anything.
  - To answer "yes" or "extremely", your summary must point at two DIFFERENT
    concrete things on the pages. Two restatements of the same sentence is one
    thing, not two.
  - A company whose entire case is its homepage cannot go above "kinda". That is
    not a penalty. That is the answer.
  - Do not assume. If the pages do not settle something, say you cannot tell
    rather than filling the gap with what is usually true of companies like this.
  - Do not invent. No figure, customer, integration or date that is not on the
    pages in front of you.
  - Marketing language is not a mechanism. Where a claim describes an outcome
    without describing how, treat it as unevidenced rather than as a finding.
  - Answer in your own terms. Do not reach for the phrasing of the question or
    the scale; describe what you actually found.
  - BE BRIEF. Fifty words is the ceiling for anything you write, and most
    answers want fewer. A long answer is not a more careful one.
${questions}

For EACH question return:
  verdict    EXACTLY one of: hard no, no, kinda, yes, extremely
  summary    Your reasoning, citing what you saw on the pages. UNDER 50 WORDS.
             Not a restatement of the verdict.

Then one "adjective" for the company overall — a single lowercase word or a very
short phrase. It appears next to your name on the leaderboard and it is the only
adjective you are asked for, so make it count.

Aim at the product, the positioning and the choices. Never at people. Never
claim a company is failing, fraudulent, or in financial trouble.
${input.thin ? "\n⚠ THE SITE BARELY RENDERED. You are working from very little; score conservatively and say so.\n" : ""}
═══ THEN TWO QUESTIONS OF FACT ═══
These are NOT judgements and must not influence anything above. Answer them
last, after you have written all three scores.

category: EXACTLY ONE of these keys — where the company sits in the ad supply
chain and who pays it, not the technology underneath:
${categories}

${input.facts ? `funding: already established above. Return {"round":"","year":0,"investor":""}
and do not attempt to recall it — a fact we can look up is not worth your guess.
` : `funding: what you actually KNOW about this company's most recent round from
public reporting. Not a guess from how the site looks — a site is written to
sound established and reading stage off it is wrong more often than right.

  round     one of: pre-seed, seed, series-a, series-b, series-c, series-d,
            later — or "" if you do not know
  year      the year of that round, or 0 if you do not know
  investor  the lead investor on it, or "" if you do not know

  ⚠ Give all three or give none. If you cannot name the year and the lead
  investor, you do not know the round either — return "" and 0. An answer you
  are reconstructing from plausibility is worse than no answer, because two
  other models are being asked this same question and the three of you are
  being checked against each other.
`}
Return JSON only, with the keys in this order. "case_against" comes first
because you must write it first:
{"case_against":[str,str,str],
 "innovation":{"verdict":str,"summary":str},
 "difficulty":{"verdict":str,"summary":str},
 "outlook":{"verdict":str,"summary":str},
 "adjective":str,
 "category":str,
 "funding":{"round":str,"year":int,"investor":str}}

COMPANY: ${input.domain}
${factsBlock(input.facts ?? null)}${pressBlock(input.press ?? [])}
PAGES:
${input.pages.slice(0, 30_000)}`;
}

// ── Normalising ─────────────────────────────────────────────────────────────

/**
 * Read the juror's word, defensively.
 *
 * A model told to answer in five words will occasionally answer in six —
 * "extremely yes", "a hard no", "Kinda." — so this matches on containment
 * rather than equality. Longest verdict first, or "hard no" would match as "no".
 *
 * An unreadable answer lands on "kinda" rather than "hard no": a parse failure
 * is our problem and should not be scored as the company's.
 */
const readVerdict = (v: unknown): Verdict => {
  const text = String(v ?? "").toLowerCase();
  for (const w of ["hard no", "extremely", "kinda", "yes", "no"] as Verdict[]) {
    if (text.includes(w)) return w;
  }
  return "kinda";
};

/**
 * Take the FIRST word, not the letters.
 *
 * The obvious version — strip everything that is not a letter, then truncate —
 * turns "Genuinely Impressive!" into "genuinelyimpress", because removing the
 * space concatenates the two words before the truncation ever runs. That token
 * would have gone straight onto the leaderboard as a company's adjective.
 * Splitting on whitespace first gives "genuinely", which is a word.
 */
const oneWord = (v: unknown): string =>
  String(v ?? "").trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z-]/g, "").slice(0, 16) ?? "";

const trim = (v: unknown, max: number): string => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
};

export function normalizeTake(raw: unknown, panelistId: string, modelUsed: string): PanelistTake {
  const o = (raw ?? {}) as Record<string, any>;
  const ratings = {} as Record<QuestionKey, Rating>;
  for (const q of QUESTIONS) {
    const src = (o[q.key] ?? {}) as Record<string, unknown>;
    const verdict = readVerdict(src.verdict);
    ratings[q.key] = {
      verdict,
      score: VERDICT_SCORE[verdict],
      /* 50 words is the instruction; 400 characters is the backstop for a model
         that ignored it. Truncating is kinder than rejecting a whole seat. */
      summary: trim(src.summary, 400),
    };
  }
  const f = (o.funding ?? {}) as Record<string, unknown>;
  const year = Number.parseInt(String(f.year ?? ""), 10);

  return {
    panelistId,
    modelUsed,
    ratings,
    caseAgainst: (Array.isArray(o.case_against) ? o.case_against : [])
      .slice(0, 3)
      .map((s: unknown) => trim(s, 300))
      .filter(Boolean),
    adjective: oneWord(o.adjective),
    recall: {
      category: String(o.category ?? "").toLowerCase().replace(/[^a-z-]/g, ""),
      round: String(f.round ?? "").toLowerCase().replace(/\s+/g, "-").replace(/[^a-z-]/g, ""),
      // A round in 1998 or 2043 is a model confabulating, not recalling. The
      // window is wide enough to cover any real adtech company and narrow
      // enough to catch a number that came from nowhere.
      year: Number.isFinite(year) && year >= 2005 && year <= 2027 ? year : 0,
      investor: trim(f.investor, 60),
    },
  };
}

/**
 * A panelist who answered without saying anything has not answered.
 *
 * Runs inside the provider ladder, so a model returning well-formed JSON with
 * empty summaries drops to the next rung rather than seating a juror whose
 * entry on the page would be blank.
 */
export function assertTakeUsable(take: PanelistTake): PanelistTake {
  for (const q of QUESTIONS) {
    const r = take.ratings[q.key];
    /* 30, not 60: the brief is now UNDER fifty words, so the old floor was
       written for a rubric that asked for two or three sentences. */
    if (r.summary.length < 30) throw new Error(`${q.key}: summary too thin`);
  }
  if (!take.adjective) throw new Error("no overall adjective");
  return take;
}

// ── Aggregation ─────────────────────────────────────────────────────────────

export interface PanelResult {
  takes: PanelistTake[];
  /** Mean per question across the panel, one decimal. */
  means: Record<QuestionKey, number>;
  /** Sum of the three means, 0-30. The leaderboard's sort key. */
  total: number;
  /**
   * The question the panel disagreed on most, and by how much. Where three
   * independent labs split is the most interesting thing on a page, so it is
   * surfaced rather than averaged away.
   */
  split: { question: QuestionKey; spread: number } | null;
}

export function aggregate(takes: PanelistTake[]): PanelResult {
  const means = {} as Record<QuestionKey, number>;
  let widest: { question: QuestionKey; spread: number } | null = null;

  for (const q of QUESTIONS) {
    const scores = takes.map((t) => t.ratings[q.key].score);
    means[q.key] = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
    const spread = Math.max(...scores) - Math.min(...scores);
    if (!widest || spread > widest.spread) widest = { question: q.key, spread };
  }

  const total = Math.round(QUESTIONS.reduce((sum, q) => sum + means[q.key], 0) * 10) / 10;
  /**
   * Two steps apart, not three points apart.
   *
   * The old threshold of 3 was calibrated when jurors picked freely from 0-10
   * and a gap of 1-2 was rounding noise. On the five-verdict scale the steps
   * themselves are 2-3 points wide (0 · 3 · 5 · 8 · 10), so a spread of 3 is now
   * ONE step — "kinda" against "yes" — which is an ordinary judgement call and
   * not a split. Five points is two steps, which is a genuine disagreement.
   */
  return { takes, means, total, split: widest && widest.spread >= 5 ? widest : null };
}

// ── Resolving the facts ─────────────────────────────────────────────────────

export interface Recall {
  /** Majority subcategory, or "" when the panel would not agree. */
  category: string;
  categoryVotes: number;
  /** Majority round, or "" when fewer than two panelists agreed. */
  round: string;
  roundYear: number;
  roundVotes: number;
  /** Human-readable provenance, printed on the page. */
  evidence: string;
}

/**
 * Majority vote across three labs, used as a hallucination filter.
 *
 * The two questions folded into the panel prompt are questions of FACT, and a
 * single model answering them is exactly the failure this board cannot afford:
 * category decides which two tables a company appears in, so one model's bad
 * afternoon shifts every rank around it. Asking three models that generate
 * independently and requiring two to agree is a genuinely strong filter — three
 * labs converging on the same fabricated round AND the same year is far less
 * likely than any one of them inventing it.
 *
 * Requiring the year to match as well as the round is the part that does the
 * work. "series-b" alone is a coin flip between a handful of options and models
 * will collide on it by chance; "series-b in 2021" is a much narrower target,
 * so agreement there is much more likely to be recall than coincidence.
 */
export function resolveRecall(takes: PanelistTake[]): Recall {
  const tally = <T>(values: T[]): { value: T; votes: number } | null => {
    const counts = new Map<string, { value: T; votes: number }>();
    for (const v of values) {
      const k = JSON.stringify(v);
      counts.set(k, { value: v, votes: (counts.get(k)?.votes ?? 0) + 1 });
    }
    const best = [...counts.values()].sort((a, b) => b.votes - a.votes)[0];
    return best && best.votes >= 2 ? best : null;
  };

  const cat = tally(takes.map((t) => t.recall.category).filter(Boolean));

  // Only complete answers are eligible to vote. A panelist that named a round
  // but could not place a year was told to abstain; counting it anyway would
  // reintroduce exactly the guesswork the instruction exists to prevent.
  const complete = takes
    .map((t) => t.recall)
    .filter((r) => r.round && r.year > 0);
  const round = tally(complete.map((r) => ({ round: r.round, year: r.year })));

  const names = round
    ? takes
        .filter((t) => t.recall.round === round.value.round && t.recall.year === round.value.year)
        .map((t) => PANELISTS.find((p) => p.id === t.panelistId)?.lab ?? t.panelistId)
    : [];

  return {
    category: cat?.value ?? "",
    categoryVotes: cat?.votes ?? 0,
    round: round?.value.round ?? "",
    roundYear: round?.value.year ?? 0,
    roundVotes: round?.votes ?? 0,
    evidence: round
      ? `${names.join(" and ")} independently recall a ${round.value.round.replace(/-/g, " ")} in ${round.value.year}.`
      : "",
  };
}

// ── Running it ──────────────────────────────────────────────────────────────

/**
 * Seat all three panelists, in parallel, and refuse to publish a short panel.
 *
 * The parallelism is not just for speed — it is also the isolation. Three
 * concurrent calls to three labs cannot see each other by construction, which
 * is the property the whole jury design rests on.
 *
 * The refusal matters more than it looks. If one provider is down and this
 * seated two jurors instead, that company's mean would be an average of two
 * opinions while every company around it averaged three, and the ranks between
 * them would silently stop being comparable. A missing ranking is recoverable;
 * a board where the numbers mean different things per row is not.
 */
export async function runPanel(env: ProviderEnv, input: PanelInput): Promise<PanelResult> {
  const prompt = buildPanelPrompt(input);

  const seated = await Promise.allSettled(
    PANELISTS.map((p) =>
      askLadder(
        p.provider,
        env,
        prompt,
        (text, model) => assertTakeUsable(normalizeTake(extractJson(text), p.id, model)),
        // Pinned: the declared model or nobody. The open ladder let GLM and
        // Qwen answer in DeepSeek's seat, which put five companies in front of
        // a different jury than the other eighteen — disclosed on the page,
        // but disclosure does not make the scores comparable. Two attempts,
        // because this seat's whole ladder is now one rung.
        //
        // `system` carries the character; `prompt` is byte-identical across
        // seats. Same rubric, three different people reading it.
        /* ONE attempt in the parallel round, not two.
           Two meant a flaky seat burned up to 240s before the panel could even
           report itself incomplete, while the other two sat finished and idle —
           so the common failure was not "a lab was down" but "a lab was slow and
           we waited for it twice". One attempt here, and one targeted retry of
           only the seats that missed, recovers the same transient failures for
           the same worst-case wall clock and a far better median. */
        { preferred: p.model, only: [p.model], attempts: 1, system: buildPanelSystem(p),
          schema: PANEL_RESPONSE_SCHEMA },
      ).then((r) => r.value),
    ),
  );

  const takes: PanelistTake[] = [];
  const missing: string[] = [];
  seated.forEach((result, i) => {
    if (result.status === "fulfilled") takes.push(result.value);
    else missing.push(`${PANELISTS[i].name}: ${result.reason?.message ?? result.reason}`);
  });

  /**
   * One retry, and only for the seats that actually missed.
   *
   * The refusal below stands — a panel of two is not comparable to a board of
   * threes — but refusing on a single transient timeout was throwing away two
   * good takes and a crawl. GLM timed out twice in one afternoon and answered
   * cleanly minutes later, which is exactly the shape this recovers.
   *
   * Sequential, because by this point the other seats have finished and there is
   * nothing to run alongside.
   */
  if (takes.length < PANELISTS.length) {
    const seatedIds = new Set(takes.map((t) => t.panelistId));
    const absent = PANELISTS.filter((p) => !seatedIds.has(p.id));
    console.warn(`[panel] retrying ${absent.map((p) => p.name).join(", ")}`);

    /**
     * Wait before retrying, because the failures worth retrying are the ones a
     * pause fixes.
     *
     * Measured on blockthrough.com: NIM answered `503 Service temporarily
     * overloaded`, and an immediate retry came back with unparseable content —
     * the same overloaded service, asked again a millisecond later. A retry with
     * no backoff is not a second chance, it is the same request.
     *
     * Six seconds is chosen against the deadline rather than against the
     * provider: the other seats have finished by now, so this is dead time on
     * the request, and the budget only stretches so far.
     */
    await new Promise((r) => setTimeout(r, 6_000));

    for (const p of absent) {
      try {
        const again = await askLadder(
          p.provider, env, prompt,
          (text, model) => assertTakeUsable(normalizeTake(extractJson(text), p.id, model)),
          /* Two attempts here, unlike the parallel round: nothing else is
             running, so a second try costs only its own latency. */
          { preferred: p.model, only: [p.model], attempts: 2, system: buildPanelSystem(p),
            schema: PANEL_RESPONSE_SCHEMA },
        );
        takes.push(again.value);
      } catch (err) {
        missing.push(`${p.name} (retry): ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  if (takes.length < PANELISTS.length) {
    throw new Error(`panel incomplete — ${missing.join(" | ")}`);
  }

  // Ordered by the declared panel, not by who answered first, so the page reads
  // the same way every time regardless of which lab was quickest today.
  takes.sort(
    (a, b) =>
      PANELISTS.findIndex((p) => p.id === a.panelistId) -
      PANELISTS.findIndex((p) => p.id === b.panelistId),
  );

  return aggregate(takes);
}
