/**
 * The grader.
 *
 * One model reads the pages and returns everything in a single response: five
 * anchored grades with a reason each, the classification, and the verdict
 * paragraph. It replaces `panel.ts` (three jurors, nine ratings) and
 * `writer.ts` (a fourth model that synthesised them).
 *
 * ── Why one model beats three ──
 * The panel's argument was that three models agreeing is stronger evidence than
 * one asserting, and that where they split, the split is the most interesting
 * thing on the page. Both true. Neither was worth what it cost: nine ratings
 * from three models is a wider sample of the same KIND of judgement, not a
 * better one, and the board's problem was never variance.
 *
 * What it did cost was the whole latency budget. Four calls inside one Pages
 * Function request forced every seat down its ladder — see providers.ts, where
 * the NIM ladder leads with a 49B because "a juror that times out is worth less
 * than a slightly smaller juror that answers". One call inverts that. The 550B
 * Ultra measured 76.4s against the real panel prompt on 2026-08-15, which never
 * fitted four abreast and fits comfortably alone.
 *
 * ── Why the grader is pinned with no ladder ──
 * A board whose rows were graded by different models is a board whose numbers
 * are not comparable to each other. That is the same argument that pinned each
 * panel seat, and it applies harder here: with one grader, a fallback would not
 * mean "one juror substituted", it would mean "this row was judged by a
 * different instrument entirely". A grader that cannot answer fails the
 * submission loudly instead of quietly producing an incomparable row.
 *
 * ── Why the scales are anchored ──
 * Determinism was an explicit requirement. Temperature 0 only removes sampling
 * noise; the real drift comes from an unanchored "rate this 1-5", where the
 * model reinvents the scale on every call. Naming what each band MEANS turns
 * scoring into classification against fixed points.
 */

import { askLadder, extractJson, type ProviderEnv } from "./providers";

// ── The grader ──────────────────────────────────────────────────────────────

/**
 * Published specifications only.
 *
 * The page names the model and prints its specs, on the argument that a score
 * from an unnamed "AI" is an appeal to authority with no authority behind it.
 * That argument gets STRONGER with one grader, not weaker — there is no panel
 * to hide an individual model's limits inside. Both numbers below are published
 * in the model's own name.
 */
export const GRADER = {
  id: "nemotron-ultra",
  name: "Nemotron 3 Ultra",
  lab: "NVIDIA",
  provider: "nvidia" as const,
  model: "nvidia/nemotron-3-ultra-550b-a55b",
  spec: "Mixture-of-experts, 550B total parameters with roughly 55B active per token — both numbers are published in the model's own name. Trained by the company that makes the accelerators everyone else rents, and served on NVIDIA's own inference.",
  /**
   * Prepended verbatim to the system message.
   *
   * NVIDIA's Nemotron line ships with reasoning OFF and turns it on only if the
   * literal string `detailed thinking on` appears in the system prompt. Without
   * it you pay reasoning-model latency for a non-reasoning answer.
   */
  systemPrefix: "detailed thinking on",
} as const;

// ── The rubric ──────────────────────────────────────────────────────────────

export type DimensionKey = "originality" | "defensibility" | "outlook";

export interface Dimension {
  key: DimensionKey;
  label: string;
  ask: string;
  anchors: string;
}

/**
 * Three dimensions, each an integer 1-5.
 *
 * Chosen to be UNIVERSAL and, more importantly, ANSWERABLE from the evidence
 * available: every one of them can be settled about a seed-stage curation
 * startup and an acquired ad server alike, from that company's own website,
 * with a quotable span to back it.
 *
 * ── Why five became three ──
 * Two of the five were measuring something other than what they were named
 * after, and an audit of the board's only two rows made it plain.
 *
 * `execution` anchored on public developer docs, an API reference, a changelog,
 * a status page. That is a test of go-to-market motion. Every enterprise
 * sales-led vendor in adtech is capped at 2 by construction — both audited
 * companies scored exactly 2, with near-identical reasons, one of them a
 * twenty-year-old business running 200B+ ads a month.
 *
 * `traction` asked for named customers and accepted the vendor's own
 * testimonial wall as proof, turning marketing copy into an apparently
 * independent 5/5. On a board whose entire claim is neutrality, that is a
 * worse failure than a wrong number, because it is invisible.
 *
 * A dimension that returns the same value for the same reason on every company
 * contributes no information to the mean. Three that discriminate beat five
 * where two are noise.
 *
 * ── What was wrong with investability, kept for the record ──
 * It asked the model to imagine a transaction, so anything that made the
 * transaction impossible read as a defect in the COMPANY: already acquired,
 * bootstrapped and not raising, too mature to have a round open. It was a
 * liquidity question wearing a quality question's clothes, and it systematically
 * punished the companies with the best outcomes on the board.
 *
 * Outlook asks about the company's future rather than the reader's
 * opportunity, which is why it survives acquisition, bootstrapping and maturity
 * without special-casing any of them.
 */
export const DIMENSIONS: Dimension[] = [
  {
    key: "originality",
    label: "Originality",
    /**
     * "How innovative is this, really?" invited a vibe. First-or-only is a
     * question about the record: a grader either can point at what the category
     * did not have before this, or cannot.
     */
    ask: "Was this first, or only? Name what the category did not have before this company, and what on the pages shows it. If the idea predates them and they are executing it well, that is a real finding and it scores in the middle, not the top.",
    anchors: `5 — a genuinely new mechanism; can say who did not have it
4 — a real insight, executed conventionally
3 — a competent take on an idea the category already had
2 — a known idea wearing an AI label
1 — the deck has been circulating since 2016`,
  },
  {
    key: "defensibility",
    label: "Defensibility",
    /**
     * This IS "could someone just vibe-code it" — but asked the long way round,
     * and the long way round is not decoration.
     *
     * Asked literally, "could this be vibe-coded?" produced rave scores under
     * the panel: a grader pattern-matches a feature list to a weekend build,
     * and a feature list is mostly what a homepage is. The question answers
     * itself from the wrong evidence. Demanding a NAMED bottleneck from a
     * closed list is the same question in a form the pages can actually
     * settle — in adtech the moat is almost never the UI.
     */
    ask: "Could a competent team rebuild this in a weekend? Answer by naming the single hardest thing to replicate. Choose from: sustained QPS at a latency SLA; count and depth of OpenRTB integrations; data rights or contracts; compliance and accreditation posture; supply or demand relationships; proprietary data accumulation. Say which, and quote what on the pages supports it. If nothing supports any of them, say so — that is a valid and common finding, and it scores low.",
    anchors: `Score the DIFFICULTY of replication. High means hard to reproduce.
5 — years of systems work, or rests on data nobody else has
4 — hard engineering; a strong team would need many months
3 — substantial but standard; the problems are known ones
2 — a competent developer could approximate it in a few weeks
1 — a weekend, an API key, and a wrapper`,
  },
  {
    key: "outlook",
    label: "Future outlook",
    /**
     * Replaces `durability`, which asked only "does this survive." Survival is
     * half the question and the pessimistic half: a company can be perfectly
     * durable and serve a market that is not going anywhere. This asks about
     * the market's direction as well as the company's grip on it, so a
     * tailwind can raise a score rather than merely failing to lower it.
     */
    ask: "Where does this sit in three years? Weigh three things and say which dominates: the DIRECTION of the need it serves (growing, evergreen, or past its prime), the SIZE of the market it can address, and whether the company sits in a tailwind or a headwind — a platform deprecation, a regulatory shift, a buyer consolidating. Quote what on the pages tells you.",
    /**
     * The acquired-company rule is stated here rather than left to inference,
     * because inference is exactly what produced the bug this rubric replaces.
     */
    anchors: `Acquisition is an OUTCOME, not a verdict. A company absorbed and still
shipping under its own name scores HIGH — someone with money concluded it would
keep mattering. A company absorbed and quietly folded into a suite scores low.
Never score down merely because a company was acquired, and never score up
merely because a company is independent.

5 — an evergreen or growing need, a large addressable market, and a tailwind
4 — a durable need with one identifiable headwind
3 — depends on the category staying roughly as it is
2 — a real headwind, or a market narrowing around it
1 — the need is being absorbed into a platform default, or is past its prime`,
  },
];

export const DIMENSION_KEYS = DIMENSIONS.map((d) => d.key);

// ── Grade arithmetic ────────────────────────────────────────────────────────

/**
 * The mean of the three, to one decimal.
 *
 * Three integers in 1-5 average to 13 distinct values in 0.33 steps. That is
 * fewer buckets than five dimensions gave, and the trade is deliberate: two of
 * the five were measuring nothing. Traction scored a vendor's own testimonial
 * wall, and execution scored go-to-market motion — both graded 2 on every
 * enterprise sales-led company in the sample, for the same reason, which is
 * zero variance and therefore zero information. A narrower scale made of
 * dimensions that discriminate beats a wider one padded with two that do not.
 */
export function gradeOf(scores: Record<DimensionKey, number>): number {
  const total = DIMENSION_KEYS.reduce((sum, k) => sum + scores[k], 0);
  return Math.round((total / DIMENSION_KEYS.length) * 10) / 10;
}

export type Letter = "A" | "B" | "C" | "D" | "E";

/**
 * Letter bands sit ON TOP of the mean; they never replace it.
 *
 * Boundaries are inclusive at the bottom of each band, so a 3.5 is a B and not
 * a C. Worth stating because 3.5 is a reachable mean (e.g. 4,4,4,3,3) rather
 * than a theoretical edge — an off-by-one here would misgrade real rows.
 */
export function letterFor(grade: number): Letter {
  if (grade >= 4.5) return "A";
  if (grade >= 3.5) return "B";
  if (grade >= 2.5) return "C";
  if (grade >= 1.5) return "D";
  return "E";
}

// ── Shapes ──────────────────────────────────────────────────────────────────

export interface DimensionScore {
  score: number;
  /** What on the pages produced this band. One line. */
  reason: string;
  /**
   * A VERBATIM span from the snapshot that supports the reason.
   *
   * This is the load-bearing field. A reason is prose and prose cannot be
   * checked; a quote can be, by `String.includes` against the frozen input.
   * Anything the grader cannot quote is something it did not read.
   */
  quote: string;
  /** Which crawled page the quote came from. */
  sourceUrl: string;
}

export interface Grade {
  modelUsed: string;
  scores: Record<DimensionKey, DimensionScore>;
  /** The mean, to one decimal. */
  grade: number;
  letter: Letter;
  /** The verdict paragraph — same call, no separate writer. */
  summary: string;
  category: string;
  funding: { round: string; year: number; investor: string };
}

export interface GraderInput {
  domain: string;
  /** Page text, each section headed. */
  pages: string;
  /** True when the site rendered to almost nothing. */
  thin: boolean;
  /** The closed subcategory set, passed in so _lib/grader owns no taxonomy. */
  categories: readonly { key: string; label: string }[];
  categoryNotes?: Partial<Record<string, string>>;
}

/**
 * `quote` and `source_url` are REQUIRED, not optional enrichment.
 *
 * A model that may omit a quote will omit it exactly when it has none — which
 * is exactly when the claim needs checking. Requiring the field forces the
 * fabrication into the open, where verifyAgainstSnapshot() can catch it.
 */
const SCORE_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "integer" },
    reason: { type: "string" },
    quote: { type: "string" },
    source_url: { type: "string" },
  },
  required: ["score", "reason", "quote", "source_url"],
};

export const GRADER_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    originality: SCORE_SCHEMA,
    defensibility: SCORE_SCHEMA,
    outlook: SCORE_SCHEMA,
    summary: { type: "string" },
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
  required: [...DIMENSION_KEYS, "summary", "category", "funding"],
};

/**
 * A stable fingerprint of the rubric that produced a score.
 *
 * Derived from the rubric text rather than hand-bumped, on the same principle
 * the stage cache uses: a constant someone has to remember to increment is a
 * constant that is wrong exactly when it matters — after a quiet edit to an
 * anchor, which is precisely the edit that makes old rows incomparable.
 *
 * FNV-1a rather than SHA-256 because this must be synchronous and cheap; it is
 * a change detector, not a security primitive.
 */
export function rubricVersion(): string {
  const text = DIMENSIONS.map((d) => `${d.key}|${d.ask}|${d.anchors}`).join("\n");
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `r${DIMENSION_KEYS.length}-${h.toString(16).padStart(8, "0")}`;
}

// ── The prompt ──────────────────────────────────────────────────────────────

/**
 * Who the grader is. Sent as the system message, never as part of the rubric.
 *
 * The panel split these because a byte-identical rubric across three different
 * system messages is what made three scores comparable. There is one seat now,
 * so the split earns its keep differently: the rubric is the published artifact
 * — it appears verbatim on the page — and the system message is the part that
 * never needs to.
 */
export function buildGraderSystem(): string {
  return `${GRADER.systemPrefix}

You grade adtech companies for a public leaderboard, from their own website and
nothing else. You are not a marketer, an investor or a fan. You are the person
who reads the site closely enough to notice what it does not say.

Your lens: a claim you cannot point at on the page is not a neutral unknown, it
is an absence. A site says what a company WANTS said, and that asymmetry runs
one way.

What makes you say no: language that describes an outcome without describing a
mechanism. "AI-powered optimisation" is not a mechanism. "Bids are re-priced
per-impression against a model trained on the last 30 days of win rates" is.

You will not: speculate about a company's finances, its staff, or its future
beyond what the pages support; call anyone a fraud; soften a low score because
the company seems nice; or inflate a score because the design is good.`;
}

export function buildGraderPrompt(input: GraderInput): string {
  const categories = input.categories
    .map((c) => {
      const note = input.categoryNotes?.[c.key];
      return `    ${c.key} — ${c.label}${note ? `\n        ${note}` : ""}`;
    })
    .join("\n");

  const dimensions = DIMENSIONS.map(
    (d) => `── ${d.key.toUpperCase()} ──
${d.ask}

Score 1-5 against these anchors. Pick the band that fits and use its number;
do not invent a scale of your own:
${d.anchors}`,
  ).join("\n\n");

  return `Grade the company below on three dimensions, from the pages provided.

═══ EVERY SCORE MUST BE QUOTABLE ═══
For each dimension you return four fields, and "quote" is the one that decides
whether the score is publishable at all:

  score       the band, 1-5
  reason      ONE line naming what you read. "Strong engineering culture" is
              not a reason. "Publishes a changelog with 40 dated entries" is.
  quote       a span of 8-30 words copied CHARACTER-FOR-CHARACTER out of the
              pages below, which supports the reason. Do not paraphrase it, do
              not tidy the punctuation, do not join two separate sentences.
  source_url  the URL of the page the quote came from, copied from that page's
              "## <Title> (<url>)" heading below.

The quote is checked against the source text by string match after you answer.
A dimension whose quote is not found verbatim is DISCARDED and the ranking
fails. This is not a formatting preference — it is the only thing standing
between this board and a machine that makes things up confidently.

If you cannot find a quote that supports a claim, the claim is wrong. Score
what you CAN quote.

Two things a quote is NOT evidence of:
  - A testimonial or customer quote on the vendor's own site is evidence that
    the VENDOR PUBLISHED IT, not that the relationship is what it says. Treat
    self-reported praise as a claim, never as proof.
  - A number with no method behind it ("200B+ ads analysed") is a marketing
    figure. You may quote it; say whose figure it is.

═══ HOW TO SCORE ═══
  - Start every dimension at 3. Argue UPWARD from there with evidence, or leave
    it. Optimism costs something; vagueness does not earn anything.
  - To score ABOVE 4 on a dimension, your reason must point at two DIFFERENT
    concrete things on the pages — a named integration, a documented mechanism,
    a pricing model, a specific customer, an actual API. Two restatements of the
    same claim is one thing, not two.

${dimensions}

═══ THEN THE VERDICT ═══
"summary": one paragraph, 60-90 words, plainspoken and technical. Say what the
company does, what the grade turns on, and the single thing that would move it.
Every factual claim in it must be supported by something you quoted above.
Aim at the product, the positioning and the choices. Never at people. Never
claim a company is failing, fraudulent, or in financial trouble.
${input.thin ? "\n⚠ THE SITE BARELY RENDERED. You are working from very little; score conservatively and say so in the summary.\n" : ""}
═══ FINALLY, TWO QUESTIONS OF FACT ═══
These are NOT judgements and must not influence anything above.

category: EXACTLY ONE of these keys — where the company sits in the ad supply
chain and who pays it, not the technology underneath:
${categories}

funding: what you actually KNOW about this company's most recent round from
public reporting. Not a guess from how the site looks — a site is written to
sound established and reading stage off it is wrong more often than right.

  round     one of: pre-seed, seed, series-a, series-b, series-c, series-d,
            later — or "" if you do not know
  year      the year of that round, or 0 if you do not know
  investor  the lead investor, or "" if you do not know

═══ DOMAIN ═══
${input.domain}

═══ PAGES ═══
${input.pages}`;
}

// ── Parsing ─────────────────────────────────────────────────────────────────

const clampScore = (raw: unknown): number => {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return 3;
  return Math.min(5, Math.max(1, n));
};

/**
 * Coerce whatever came back into the shape the rest of the pipeline expects.
 *
 * Every field is defended rather than trusted. A structured-output schema makes
 * the shape LIKELY, not certain: models still return a score as a string or a
 * reason that is an empty string. Neither is worth failing a ranking over, and
 * both are worth normalising in exactly one place.
 */
export function normalizeGrade(raw: unknown, modelUsed: string): Grade {
  const o = (raw ?? {}) as Record<string, unknown>;

  const scores = {} as Record<DimensionKey, DimensionScore>;
  for (const key of DIMENSION_KEYS) {
    const cell = (o[key] ?? {}) as Record<string, unknown>;
    scores[key] = {
      score: clampScore(cell.score),
      reason: String(cell.reason ?? "").trim(),
      quote: String(cell.quote ?? "").trim(),
      sourceUrl: String(cell.source_url ?? "").trim(),
    };
  }

  const grade = gradeOf(
    Object.fromEntries(DIMENSION_KEYS.map((k) => [k, scores[k].score])) as Record<DimensionKey, number>,
  );

  const funding = (o.funding ?? {}) as Record<string, unknown>;

  return {
    modelUsed,
    scores,
    grade,
    letter: letterFor(grade),
    summary: String(o.summary ?? "").trim(),
    category: String(o.category ?? "").trim().toLowerCase(),
    funding: {
      round: String(funding.round ?? "").toLowerCase().replace(/\s+/g, "-"),
      year: Number.isFinite(Number(funding.year)) ? Number(funding.year) : 0,
      investor: String(funding.investor ?? "").trim(),
    },
  };
}

// ── Verification ────────────────────────────────────────────────────────────

/**
 * Fold a string to the form both sides of the comparison can agree on.
 *
 * Crawled text and a model's copy of it differ in ways that are not
 * fabrication: collapsed runs of whitespace, a curly quote straightened, a
 * non-breaking space, an em dash retyped as a hyphen. Matching raw would fail
 * honest quotes and teach us to weaken the check — which is how a verification
 * step becomes decoration. Matching case-insensitively on folded punctuation
 * fails ONLY on invented content, which is the whole point.
 */
export function foldForMatch(text: string): string {
  return text
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export interface QuoteCheck {
  key: DimensionKey;
  ok: boolean;
  quote: string;
  why?: string;
}

/**
 * Is every claim actually in the source the grader was given?
 *
 * This is the check the whole redesign exists for. Before it, a "reason" was
 * prose and prose cannot be falsified — the board's correctness rested entirely
 * on the model happening to be right, and the one time it was audited it had
 * turned a wall of vendor testimonials into "eight named customers" and scored
 * it 5/5. A quote can be falsified by `includes`, in microseconds, for free.
 *
 * Deliberately NOT lenient. No fuzzy match, no similarity threshold, no
 * "close enough" — a threshold is a number someone will lower on the day it is
 * inconvenient, and at that point the guarantee is gone while the badge that
 * says "verified" stays on the page.
 */
export function verifyQuotes(grade: Grade, snapshot: string): QuoteCheck[] {
  const haystack = foldForMatch(snapshot);
  return DIMENSION_KEYS.map((key) => {
    const { quote } = grade.scores[key];
    if (quote.length < 12) {
      return { key, ok: false, quote, why: "quote too short to mean anything" };
    }
    const needle = foldForMatch(quote);
    if (!haystack.includes(needle)) {
      return { key, ok: false, quote, why: "not found in the crawled pages" };
    }
    return { key, ok: true, quote };
  });
}

/**
 * A response can be well-formed and still useless.
 *
 * The ladder treats a thrown error as a failed rung, so these checks are how a
 * model that answered 200 with something empty gets retried rather than
 * published. Kept deliberately few: each one has to describe a failure that
 * would visibly break the page, not merely a response we would have preferred.
 */
export function assertGradeUsable(grade: Grade, snapshot?: string): Grade {
  /**
   * Unverifiable claims fail the RUNG, not the ranking.
   *
   * Throwing here is what puts this inside the provider ladder's retry: the
   * grader gets another attempt at quoting itself honestly. A ranking that
   * cannot be quoted after that does not publish, which is the same rule the
   * pipeline already applies to a missing score — "complete or not at all."
   */
  if (snapshot) {
    const bad = verifyQuotes(grade, snapshot).filter((c) => !c.ok);
    if (bad.length) {
      throw new Error(
        `unverifiable: ${bad.map((c) => `${c.key} (${c.why}) "${c.quote.slice(0, 120)}"`).join(" | ")}`,
      );
    }
  }
  if (grade.summary.length < 40) {
    throw new Error(`summary too short (${grade.summary.length} chars)`);
  }
  const unreasoned = DIMENSION_KEYS.filter((k) => grade.scores[k].reason.length < 10);
  if (unreasoned.length) {
    throw new Error(`no reason given for: ${unreasoned.join(", ")}`);
  }
  return grade;
}

// ── Running it ──────────────────────────────────────────────────────────────

/**
 * Ask only for the quotes that failed, and only for those.
 *
 * The first run measured why this has to exist: the grader is a reasoning model
 * at 80-100s against a 120s ceiling, so a full retry is not available — it would
 * put the worst case past the timeout and turn a recoverable answer into a dead
 * ranking. And the failure it recovers from is usually not fabrication but
 * paraphrase: a model that read the right line and retyped it from memory
 * rather than copying it.
 *
 * The repair prompt carries no rubric, no anchors, no scoring — the scores are
 * already decided and must not move. It asks one narrow question, so the output
 * is a few dozen tokens rather than a thousand, and it comes back in seconds.
 *
 * A repair that still cannot quote is a claim the source does not support, and
 * that fails the ranking. The point of the gate is that it is a gate.
 */
async function repairQuotes(
  env: ProviderEnv,
  grade: Grade,
  input: GraderInput,
  failed: DimensionKey[],
): Promise<Grade> {
  const asks = failed.map((k) => `  ${k}: ${grade.scores[k].reason}`).join("\n");
  const prompt = `Below are claims about a company, and the pages they were drawn from.

For each claim, copy 5-30 words CHARACTER-FOR-CHARACTER from ONE CONTIGUOUS run
of the pages — one drag of a mouse.

The last attempt failed. The usual cause is ASSEMBLY, not invention: real
phrases from different parts of the page welded into one fluent sentence. A
short exact span beats a long assembled one.

If no span in the pages supports the claim, return an empty string for it. An
empty answer is correct and useful; an invented one is not, and is checked.

CLAIMS
${asks}

PAGES
${input.pages}`;

  const schema = {
    type: "object",
    properties: Object.fromEntries(failed.map((k) => [k, { type: "string" }])),
    required: failed,
  };

  const { value } = await askLadder(
    GRADER.provider, env, prompt,
    (text) => extractJson(text) as Record<string, unknown>,
    {
      preferred: GRADER.model, only: [GRADER.model], attempts: 1, temperature: 0,
      system: GRADER.systemPrefix, schema,
    },
  );

  const scores = { ...grade.scores };
  for (const key of failed) {
    const quote = String((value as Record<string, unknown>)[key] ?? "").trim();
    if (quote) scores[key] = { ...scores[key], quote };
  }
  return { ...grade, scores };
}

export async function runGrader(env: ProviderEnv, input: GraderInput): Promise<Grade> {
  const prompt = buildGraderPrompt(input);

  const { value } = await askLadder(
    GRADER.provider,
    env,
    prompt,
    (text, model) => assertGradeUsable(normalizeGrade(extractJson(text), model)),
    /**
     * Pinned, and the pin is the whole ladder — `only` excludes every other
     * rung.
     *
     * ONE attempt, and the arithmetic is the reason. CALL_TIMEOUT_MS is 120s
     * and this model measured 76.4s on a real corpus, so a second attempt puts
     * the worst case at 240s — far outside anything a Pages Function will hold
     * a response open for. Measured live on 2026-08-18: a first attempt that
     * returned scores without reasons was retried and the retry timed out at
     * exactly 120s, turning a 76s failure into a 196s one and telling the
     * visitor nothing extra.
     *
     * The panel could afford attempts: 2 because its four calls ran in
     * parallel and each juror was faster. One sequential call cannot.
     *
     * Temperature 0: the anchors do the work of making this repeatable, but
     * there is no reason to add sampling noise on top of them.
     */
    {
      preferred: GRADER.model,
      only: [GRADER.model],
      attempts: 1,
      temperature: 0,
      system: buildGraderSystem(),
      schema: GRADER_RESPONSE_SCHEMA,
    },
  );

  /**
   * Verify AFTER the ladder, not inside it.
   *
   * Inside the validator a bad quote is a failed rung, and with attempts:1 that
   * is the end of the ranking — a whole 90-second grade thrown away over one
   * mistyped span. Out here the same failure is repairable by a call that costs
   * seconds, and the gate still closes on anything the repair cannot fix.
   */
  let graded = value;
  const failed = verifyQuotes(graded, input.pages).filter((c) => !c.ok);
  if (failed.length) {
    console.warn(
      `[grade] ${input.domain}: requoting ${failed.map((c) => c.key).join(", ")}`,
    );
    graded = await repairQuotes(env, graded, input, failed.map((c) => c.key));
    const stillFailed = verifyQuotes(graded, input.pages).filter((c) => !c.ok);
    if (stillFailed.length) {
      throw new Error(
        `unverifiable after repair: ${stillFailed
          .map((c) => `${c.key} (${c.why}) "${c.quote.slice(0, 100)}"`).join(" | ")}`,
      );
    }
  }

  return graded;
}

// ── Resolving the facts ─────────────────────────────────────────────────────

export interface Recall {
  /** Subcategory the grader chose. */
  category: string;
  categoryVotes: number;
  /** Funding round, or "" when the grader did not know one. */
  round: string;
  roundYear: number;
  roundVotes: number;
  /** Human-readable provenance, printed on the page. */
  evidence: string;
}

/**
 * The grader's read of the two questions of fact.
 *
 * ── What this loses, said plainly ──
 * The panel resolved these by majority across three labs and required two to
 * agree, as a hallucination filter: three labs converging on the same
 * fabricated round AND the same year is far less likely than any one of them
 * inventing it. One grader cannot vote with itself, so that filter is gone.
 *
 * It is affordable for exactly one reason, and only for one of the two facts.
 * `classify.ts` already treats structural evidence in the markup as the
 * authority and the model's read as a fallback used ONLY where the regex found
 * nothing — so a fabricated round can never overrule an announced one. Where
 * the markup was silent, the resulting band is flagged `bandInferred` and the
 * page says so. An admitted guess is survivable; a confident wrong answer
 * dressed as consensus was always the worse failure.
 *
 * Category has no structural fallback and is now a single model's call. That is
 * a real reduction in confidence, mitigated only by CATEGORY_OVERRIDES (a human
 * correction beats the model) and by the closed set with its confusable-neighbour
 * notes. If category accuracy degrades on the board, this is the first place to
 * look — and the cheapest fix is a second cheap call asking only this question,
 * not a return to the panel.
 *
 * The vote counts are kept in the shape, always 1, so `place()` and the page
 * need no changes and the columns still mean what they meant.
 */
export function recallFrom(grade: Grade): Recall {
  const hasRound = Boolean(grade.funding.round) && grade.funding.year > 0;
  return {
    category: grade.category,
    categoryVotes: grade.category ? 1 : 0,
    round: hasRound ? grade.funding.round : "",
    roundYear: hasRound ? grade.funding.year : 0,
    roundVotes: hasRound ? 1 : 0,
    evidence: hasRound
      ? `${GRADER.name} recalls a ${grade.funding.round.replace(/-/g, " ")} in ${grade.funding.year}` +
        (grade.funding.investor ? ` led by ${grade.funding.investor}` : "")
      : "",
  };
}
