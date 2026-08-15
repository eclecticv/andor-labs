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
}

export const PANELISTS: Panelist[] = [
  {
    id: "nemotron",
    name: "Nemotron 3 Super",
    lab: "NVIDIA",
    provider: "nvidia",
    model: "nvidia/nemotron-3-super-120b-a12b",
    spec: "Mixture-of-experts, 120B total parameters with roughly 12B active per token — the sparsity is published in the model's own name. Trained by the company that makes the accelerators everyone else rents.",
  },
  {
    id: "deepseek",
    name: "DeepSeek V4 Pro",
    lab: "DeepSeek",
    provider: "opencode",
    model: "deepseek-v4-pro",
    spec: "Mixture-of-experts with open weights and a published architecture, though the exact parameter count for this tier is undisclosed. Reasons at length before committing, which is either rigour or stalling depending on how the answer turns out.",
  },
  {
    id: "gemini",
    name: "Gemini 3.5 Flash Lite",
    lab: "Google DeepMind",
    // Lite, and every word of that is measured rather than chosen. 3.6 and 3.7
    // return 503 on every call; 3.5-flash returns 429 on this key often enough
    // that flash-LITE answered 22 of the first 23 rankings. Declaring anything
    // above it names a model that does not turn up and burns a round trip
    // finding that out. The ladder still climbs back up if capacity returns.
    provider: "gemini",
    model: "gemini-3.5-flash-lite",
    spec: "The smaller of Google's fast tiers. Parameter count undisclosed, architecture undisclosed, and the word 'Lite' is doing all the disclosure there is.",
  },
];

/** The fourth family. Writes, never scores. */
export const WRITER = {
  name: "GPT-5.6 Luna",
  lab: "OpenAI",
  provider: "opencode" as Provider,
  model: "gpt-5.6-luna",
  spec: "Parameter count undisclosed. Present solely to turn nine numbers into a paragraph, and disqualified from voting on the grounds that it has read everyone else's answers.",
};

// ── The questions ───────────────────────────────────────────────────────────

export interface Question {
  key: QuestionKey;
  label: string;
  /** The hat the panelist wears for this question. */
  persona: string;
  ask: string;
  /** What each band of the 0-10 scale means. THE determinism lever. */
  anchors: string;
}

export type QuestionKey = "innovation" | "difficulty" | "investability";

export const QUESTIONS: Question[] = [
  {
    key: "innovation",
    label: "Innovation",
    persona:
      "a commercial veteran with twenty years in adtech who has watched every idea come round three times",
    ask: "How innovative is this, really?",
    anchors: `10 — a genuinely new mechanism; changes what is possible in the category
 8 — a real insight, executed conventionally
 6 — a competent take on an idea the category already had
 4 — a known idea wearing an AI label
 2 — indistinguishable from a dozen others on the same LUMAscape box
 0 — the deck has been circulating since 2016`,
  },
  {
    key: "difficulty",
    label: "Hard to build",
    persona:
      "a distinguished engineer who has built ad servers and knows exactly which parts are hard",
    ask: "Could a competent developer vibe-code this in a weekend?",
    anchors: `Score the DIFFICULTY, not the ease. High means hard to reproduce.
10 — years of systems work; distributed, latency-critical, or resting on data nobody else has
 8 — hard engineering; a strong team would need many months
 6 — substantial but standard; the problems are known ones
 4 — a competent developer could approximate it in a few weeks
 2 — a weekend, an API key, and a wrapper
 0 — this is a prompt`,
  },
  {
    key: "investability",
    label: "Would you invest",
    persona: "an adtech VC who has funded six companies out of four hundred decks",
    ask: "Would you invest in this?",
    anchors: `10 — would fight to get into the round
 8 — would take the meeting and probably write a cheque
 6 — genuinely interesting; would watch and stay in touch
 4 — would pass politely and mean it kindly
 2 — would pass
 0 — would forward it to a friend as a joke`,
  },
];

// ── Shapes ──────────────────────────────────────────────────────────────────

export interface Rating {
  score: number;
  summary: string;
  adjective: string;
}

export interface PanelistTake {
  panelistId: string;
  modelUsed: string;
  ratings: Record<QuestionKey, Rating>;
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
  /** True when the site rendered to almost nothing. */
  thin: boolean;
  /** The closed subcategory set, passed in so _lib/panel owns no taxonomy. */
  categories: readonly { key: string; label: string }[];
}

export function buildPanelPrompt(input: PanelInput): string {
  const categories = input.categories.map((c) => `    ${c.key} — ${c.label}`).join("\n");

  const questions = QUESTIONS.map(
    (q) => `── ${q.key.toUpperCase()} ──
You are ${q.persona}.
${q.ask}

Score 0-10 against these anchors. Pick the band that fits and use its number;
do not invent a scale of your own:
${q.anchors}`,
  ).join("\n\n");

  return `You are one of three judges on a public adtech leaderboard. Two other
models, from two other labs, are answering these same three questions about the
same company right now. You cannot see their answers and they cannot see yours.

Answer all three questions. Wear the stated hat for each one — they are
genuinely different lenses and a company can score well on one and badly on
another. Do not average yourself toward the middle to seem reasonable.

${questions}

For EACH question return:
  score      integer 0-10, taken from the anchors above
  summary    TWO OR THREE sentences of actual reasoning, citing what you saw on
             the pages. Not a restatement of the score.
  adjective  ONE lowercase word capturing your reaction to THIS question.

Then one more field, "adjective", for the company overall — a single lowercase
word. It appears next to your name on the leaderboard, so make it count.

Aim at the product, the positioning and the choices. Never at people. Never
claim a company is failing, fraudulent, or in financial trouble.
${input.thin ? "\n⚠ THE SITE BARELY RENDERED. You are working from very little; score conservatively and say so.\n" : ""}
═══ THEN TWO QUESTIONS OF FACT ═══
These are NOT judgements and must not influence anything above. Answer them
last, after you have written all three scores.

category: EXACTLY ONE of these keys — where the company sits in the ad supply
chain and who pays it, not the technology underneath:
${categories}

funding: what you actually KNOW about this company's most recent round from
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

Return JSON only, with the keys in this order:
{"innovation":{"score":int,"summary":str,"adjective":str},
 "difficulty":{"score":int,"summary":str,"adjective":str},
 "investability":{"score":int,"summary":str,"adjective":str},
 "adjective":str,
 "category":str,
 "funding":{"round":str,"year":int,"investor":str}}

COMPANY: ${input.domain}

PAGES:
${input.pages.slice(0, 30_000)}`;
}

// ── Normalising ─────────────────────────────────────────────────────────────

const clamp10 = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, Math.round(n)));
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
    ratings[q.key] = {
      score: clamp10(src.score),
      summary: trim(src.summary, 600),
      adjective: oneWord(src.adjective),
    };
  }
  const f = (o.funding ?? {}) as Record<string, unknown>;
  const year = Number.parseInt(String(f.year ?? ""), 10);

  return {
    panelistId,
    modelUsed,
    ratings,
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
    if (r.summary.length < 60) throw new Error(`${q.key}: summary too thin`);
    if (!r.adjective) throw new Error(`${q.key}: no adjective`);
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
  // A spread of 3 or more is a real disagreement; 1 or 2 is rounding.
  return { takes, means, total, split: widest && widest.spread >= 3 ? widest : null };
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
        { preferred: p.model },
      ).then((r) => r.value),
    ),
  );

  const takes: PanelistTake[] = [];
  const missing: string[] = [];
  seated.forEach((result, i) => {
    if (result.status === "fulfilled") takes.push(result.value);
    else missing.push(`${PANELISTS[i].name}: ${result.reason?.message ?? result.reason}`);
  });

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
