/**
 * The grader.
 *
 * One model reads the pages and returns everything in a single response: the
 * case against the company, five anchored grades, the classification, and the
 * verdict paragraph. It replaces `panel.ts` (three jurors, nine ratings) and
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

export type DimensionKey =
  | "originality" | "defensibility" | "traction" | "execution" | "durability";

export interface Dimension {
  key: DimensionKey;
  label: string;
  ask: string;
  anchors: string;
}

/**
 * Five dimensions, each an integer 1-5.
 *
 * Chosen to be UNIVERSAL: every one of them can be answered about a seed-stage
 * curation startup and an acquired ad server alike, from that company's own
 * website and nothing else. The dimension that could not — "would you invest?"
 * — is gone, and its replacement is the interesting part of this rubric.
 *
 * ── What was wrong with investability ──
 * It asked the model to imagine a transaction, so anything that made the
 * transaction impossible read as a defect in the COMPANY: already acquired,
 * bootstrapped and not raising, too mature to have a round open. It was a
 * liquidity question wearing a quality question's clothes, and it systematically
 * punished the companies with the best outcomes on the board.
 *
 * Durability asks about the company's future rather than the reader's
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
     * The closed list carries over from the panel unchanged. "Could this be
     * vibe-coded" produced rave scores, because a grader pattern-matches a
     * feature list to a weekend build and a feature list is mostly what a
     * homepage is. In adtech the moat is almost never the UI, so the ask
     * demands a NAMED bottleneck.
     */
    ask: "Name the single hardest thing to replicate here. Choose from: sustained QPS at a latency SLA; count and depth of OpenRTB integrations; data rights or contracts; compliance and accreditation posture; supply or demand relationships; proprietary data accumulation. Say which, and what on the pages supports it. If nothing supports any of them, say so — that is a valid and common finding, and it scores low.",
    anchors: `Score the DIFFICULTY of replication. High means hard to reproduce.
5 — years of systems work, or rests on data nobody else has
4 — hard engineering; a strong team would need many months
3 — substantial but standard; the problems are known ones
2 — a competent developer could approximate it in a few weeks
1 — a weekend, an API key, and a wrapper`,
  },
  {
    key: "traction",
    label: "Traction",
    ask: "What proof is there that anyone actually uses this? Named customers, named integrations, published volumes, case studies with numbers, a pricing page that implies real billing. A logo wall with no names attached is not proof; neither is 'trusted by leading publishers'.",
    anchors: `5 — named customers AND named integrations, or public volume figures
4 — several named customers or integrations, with detail
3 — some named proof, thin on detail
2 — anonymous logos, or claims with nothing attached
1 — no customer, integration or number anywhere`,
  },
  {
    key: "execution",
    label: "Execution",
    ask: "Does the product surface look like it was built by people who ship? Look for documentation, an API reference, a changelog, a status page, versioned releases, real engineering writing. Marketing polish is not execution — a beautiful site with nothing behind it scores low.",
    anchors: `5 — real docs, API reference, changelog or status page
4 — documentation exists and is maintained
3 — a product surface, lightly documented
2 — marketing pages and a demo request
1 — a landing page and a contact form`,
  },
  {
    key: "durability",
    label: "Durability",
    ask: "Does this still matter in three years? Look for structural reasons it survives — data rights, long contracts, accreditation, regulatory position, entrenchment in someone's workflow. Then look for the single dependency that could end it: one platform's policy, one deprecation, one buyer's roadmap.",
    /**
     * The acquired-company rule is stated here rather than left to inference,
     * because inference is exactly what produced the bug this rubric replaces.
     */
    anchors: `Acquisition is an OUTCOME, not a verdict. A company absorbed and still
shipping under its own name scores HIGH — someone with money concluded it would
keep mattering. A company absorbed and quietly folded into a suite scores low.
Never score down merely because a company was acquired, and never score up
merely because a company is independent.

5 — a structural reason it survives; entrenched or accredited
4 — durable position, with one identifiable risk
3 — depends on the category staying roughly as it is
2 — depends on one platform decision going its way
1 — the thing it does is being absorbed into a platform default`,
  },
];

export const DIMENSION_KEYS = DIMENSIONS.map((d) => d.key);

// ── Grade arithmetic ────────────────────────────────────────────────────────

/**
 * The mean of the five, to one decimal.
 *
 * Rounding to whole numbers would collapse 21 possible values into 5 and put
 * most of the board in a three-way tie. Five integers in 1-5 average to values
 * in 0.2 steps, and that decimal IS the discrimination — it is the reason a
 * five-point scale ties less often than it sounds like it would.
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
}

export interface Grade {
  modelUsed: string;
  scores: Record<DimensionKey, DimensionScore>;
  /** The mean, to one decimal. */
  grade: number;
  letter: Letter;
  /** Three reasons the company is weaker than it looks, written before scoring. */
  caseAgainst: string[];
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

const SCORE_SCHEMA = {
  type: "object",
  properties: { score: { type: "integer" }, reason: { type: "string" } },
  required: ["score", "reason"],
};

export const GRADER_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    case_against: { type: "array", items: { type: "string" } },
    originality: SCORE_SCHEMA,
    defensibility: SCORE_SCHEMA,
    traction: SCORE_SCHEMA,
    execution: SCORE_SCHEMA,
    durability: SCORE_SCHEMA,
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
  required: [
    "case_against", ...DIMENSION_KEYS, "summary", "category", "funding",
  ],
};

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

  return `Grade the company below on five dimensions, from the pages provided.

═══ BEFORE YOU SCORE ANYTHING ═══
Write "case_against": three specific reasons this company is weaker than it
looks, each one pointing at something you actually read on the pages. Do this
FIRST, before any score exists.

This is not a formality and it is not pessimism. Marketing language survives the
question "why is this good" — it is built to. It does not survive "what is the
hard part here" asked before you have committed to a position. A grader who
scores first and justifies after has written a press release.

═══ HOW TO SCORE ═══
  - Start every dimension at 3. Argue UPWARD from there with evidence, or leave
    it. Optimism costs something; vagueness does not earn anything.
  - To score ABOVE 4 on a dimension, your reason must point at two DIFFERENT
    concrete things on the pages — a named integration, a documented mechanism,
    a pricing model, a specific customer, an actual API. Two restatements of the
    same claim is one thing, not two.
  - Every "reason" is ONE line and names what you read. "Strong engineering
    culture" is not a reason. "Publishes a changelog with 40 dated entries and
    a public status page" is.

${dimensions}

═══ THEN THE VERDICT ═══
"summary": one paragraph, 60-90 words, plainspoken and technical. Say what the
company does, what the grade turns on, and the single thing that would move it.
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
 * the shape LIKELY, not certain: models still return a score as a string, a
 * case_against of two items, or a reason that is an empty string. None of those
 * are worth failing a ranking over, and all of them are worth normalising in
 * exactly one place.
 */
export function normalizeGrade(raw: unknown, modelUsed: string): Grade {
  const o = (raw ?? {}) as Record<string, unknown>;

  const scores = {} as Record<DimensionKey, DimensionScore>;
  for (const key of DIMENSION_KEYS) {
    const cell = (o[key] ?? {}) as Record<string, unknown>;
    scores[key] = {
      score: clampScore(cell.score),
      reason: String(cell.reason ?? "").trim(),
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
    caseAgainst: Array.isArray(o.case_against)
      ? o.case_against.map((s) => String(s).trim()).filter(Boolean).slice(0, 3)
      : [],
    summary: String(o.summary ?? "").trim(),
    category: String(o.category ?? "").trim().toLowerCase(),
    funding: {
      round: String(funding.round ?? "").toLowerCase().replace(/\s+/g, "-"),
      year: Number.isFinite(Number(funding.year)) ? Number(funding.year) : 0,
      investor: String(funding.investor ?? "").trim(),
    },
  };
}

/**
 * A response can be well-formed and still useless.
 *
 * The ladder treats a thrown error as a failed rung, so these checks are how a
 * model that answered 200 with something empty gets retried rather than
 * published. Kept deliberately few: each one has to describe a failure that
 * would visibly break the page, not merely a response we would have preferred.
 */
export function assertGradeUsable(grade: Grade): Grade {
  if (grade.summary.length < 40) {
    throw new Error(`summary too short (${grade.summary.length} chars)`);
  }
  const unreasoned = DIMENSION_KEYS.filter((k) => grade.scores[k].reason.length < 10);
  if (unreasoned.length) {
    throw new Error(`no reason given for: ${unreasoned.join(", ")}`);
  }
  if (grade.caseAgainst.length < 2) {
    throw new Error(`case_against had ${grade.caseAgainst.length} items, needs at least 2`);
  }
  return grade;
}

// ── Running it ──────────────────────────────────────────────────────────────

export async function runGrader(env: ProviderEnv, input: GraderInput): Promise<Grade> {
  const prompt = buildGraderPrompt(input);

  const { value } = await askLadder(
    GRADER.provider,
    env,
    prompt,
    (text, model) => assertGradeUsable(normalizeGrade(extractJson(text), model)),
    /**
     * Pinned, and the pin is the whole ladder — `only` excludes every other
     * rung. Two attempts, because one rung means a transient failure has
     * nowhere else to go.
     *
     * Temperature 0: the anchors do the work of making this repeatable, but
     * there is no reason to add sampling noise on top of them.
     */
    {
      preferred: GRADER.model,
      only: [GRADER.model],
      attempts: 2,
      temperature: 0,
      system: buildGraderSystem(),
      schema: GRADER_RESPONSE_SCHEMA,
    },
  );

  return value;
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
