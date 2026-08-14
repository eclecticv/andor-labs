/**
 * The scorer — one model call, four dimensions.
 *
 * Replaces the three-model panel. The panel existed so that disagreement
 * between labs was itself the product; this tool sells something else, so the
 * budget moves from breadth of opinion to depth of evidence. One model reading
 * five pages with the stack and stage signals in hand beats three models
 * reading one marketing page, which is what made the old scores shallow.
 *
 * The four dimensions are the three And/or Labs sells, plus one leveller:
 *
 *   Positioning              25   sold
 *   Content strategy         25   sold
 *   GTM tech stack maturity  25   sold
 *   Innovation               25   the neutral leveller
 *
 * Innovation carries a full quarter deliberately. Without it the score would
 * measure marketing maturity, and a sharp pre-seed team with a real idea and
 * no GTM machinery would rank below a mediocre company with a HubSpot licence.
 * A quarter is enough weight to actually level.
 *
 * ── The bias this design has to keep fighting ──
 * Positioning, content and stack maturity all improve when you can hire a
 * marketer and buy tools. Left alone they measure funding. The prompt therefore
 * judges every dimension AGAINST WHAT IS REASONABLE AT THE COMPANY'S STAGE, and
 * says so repeatedly, because this is the third time the same bias has had to
 * be designed out of this tool.
 */

import type { DetectedTool } from "./stack";

export const DIMENSIONS = [
  { key: "positioning", label: "Positioning", max: 25 },
  { key: "content", label: "Content strategy", max: 25 },
  { key: "gtm_stack", label: "GTM stack maturity", max: 25 },
  { key: "innovation", label: "Innovation", max: 25 },
] as const;

export type DimensionKey = (typeof DIMENSIONS)[number]["key"];

/**
 * A closed category set, because cohorts depend on it.
 *
 * Peer benchmarking compares a company against others in its category, so a
 * free-text category is the same as no category — two companies doing the same
 * thing would land in "AI sales assistant" and "sales AI" and never meet. The
 * model must pick from this list or fall back to `other`.
 */
export const CATEGORIES = [
  "sales", "marketing", "support", "coding", "data", "security",
  "health", "legal", "finance", "infrastructure", "agents", "search",
  "content", "operations", "hiring", "education", "robotics", "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const STAGES = ["pre-seed", "seed", "series-a", "unknown"] as const;
export type Stage = (typeof STAGES)[number];

export interface DimensionResult {
  score: number;
  reasoning: string;
  /** The single change that would raise this score. Powers the CTA. */
  improve: string;
}

export interface ScoreResult {
  eligible: boolean;
  ineligibleReason: string;
  name: string;
  oneLiner: string;
  category: Category;
  stage: Stage;
  dimensions: Record<DimensionKey, DimensionResult>;
  total: number;
  verdict: string;
}

// ── The prompt ──────────────────────────────────────────────────────────────

export interface ScoreInput {
  domain: string;
  /** Concatenated text of every page we could read, with page headings. */
  pages: string;
  detected: DetectedTool[];
  coreCoverage: number;
  openRoles: number;
  sitemapUrlCount: number | null;
  /** Soft stage marks the detector found but did not refuse on. */
  stageNotes: string[];
  /** True when the fetch returned a shell — usually a JS-rendered site. */
  thin: boolean;
}

export function buildPrompt(input: ScoreInput): string {
  const stack = input.detected.length
    ? input.detected.map((t) => `${t.name} (${t.category})`).join(", ")
    : "NONE DETECTED";

  return `You are scoring an early-stage startup for And/or Labs, a go-to-market studio.
The board covers PRE-SEED to SERIES A companies using AI as a core driver.

Return JSON only. No prose outside the JSON.

═══ STEP 1 — ELIGIBILITY ═══
Set eligible=false if ANY of these hold, and put one dry, friendly sentence in
ineligibleReason saying which:
  - AI is not a core driver of the product. A company that merely USES AI
    internally, or bolts a chatbot onto an unrelated product, is not eligible.
    The question is whether the product would still exist without the AI.
  - It is not a company with a product: agencies, consultancies, studios,
    portfolios, personal sites, open-source projects with no company.
  - It is plainly past a Series A.
If eligible=false, you may leave the dimension scores at 0 and the verdict empty.

═══ STEP 2 — CLASSIFY ═══
category: EXACTLY ONE of ${CATEGORIES.join(", ")}. Pick by what the product does
  for its buyer, not by the technology underneath. Use "other" only if nothing fits.
stage: one of pre-seed, seed, series-a, unknown. Say unknown rather than guess.
name: the company's name.
oneLiner: what it does, under 90 characters, plain language, no marketing words.

═══ STEP 3 — SCORE FOUR DIMENSIONS, 0-25 EACH ═══

⚠ JUDGE EVERY DIMENSION AGAINST WHAT IS REASONABLE AT THIS COMPANY'S STAGE.
A four-person pre-seed team is not expected to have a content engine or a
six-tool GTM stack, and must NOT be marked down for lacking one. Score how
deliberate and well-aimed the effort is for where they are — not how much of it
there is. A pre-seed company doing three things sharply should outscore a
Series A doing ten things vaguely.

POSITIONING (0-25)
  - Is the website modern and well structured?
  - Is the positioning crisp and clear — can you tell who it is for and what it
    replaces, within seconds?
  - Is there adequate social proof for the stage?

CONTENT STRATEGY (0-25)
  - Is there substantial onsite content?
  - Is there evidence of offsite promotion — podcasts, guest posts, community,
    launches, press?
  - Is the content serving a real buyer, or is it SEO filler written for a
    crawler? Ten sharp posts beat a hundred generated ones.

GTM STACK MATURITY (0-25)
  - Is there a real stack, or a contact form and hope?
  - Is it instrumented — could they actually tell what is working?
  - Is the stack coherent for their stage, or bolted together?
  Use the DETECTED STACK below as evidence. Detection only sees client-side
  tools, so absence is weak evidence, not proof — if nothing was detected, look
  at the page for other signs of intent before scoring low.

INNOVATION (0-25)
  - Is this a thin AI wrapper, or genuinely AI-native?
  - Are there tons of lookalikes doing the same thing?
  - Is it trying to make a dent in the world?
  This is the leveller. A company can be early and unpolished and still score
  highly here.

For EACH dimension return:
  score      integer 0-25
  reasoning  THREE TO FIVE sentences citing what you actually saw on the pages.
             A reader must be able to tell the score was reasoned, not guessed.
  improve    ONE sentence: the single highest-leverage change they could make.
             Concrete and specific to them. This is shown to the company as
             advice, so make it worth acting on.

═══ STEP 4 — VERDICT ═══
verdict: 60-100 words. Light, confident, slightly over the top — a boxing
undercard called by someone who likes the sport. Punch at the positioning and
the choices, never at people. Never say a company is failing, fraudulent or in
financial trouble. Every criticism leaves a door open. Do not restate the scores.

═══ JSON SHAPE ═══
{"eligible":bool,"ineligibleReason":str,"name":str,"oneLiner":str,
 "category":str,"stage":str,
 "positioning":{"score":int,"reasoning":str,"improve":str},
 "content":{"score":int,"reasoning":str,"improve":str},
 "gtm_stack":{"score":int,"reasoning":str,"improve":str},
 "innovation":{"score":int,"reasoning":str,"improve":str},
 "verdict":str}

═══ EVIDENCE ═══
DOMAIN: ${input.domain}
DETECTED STACK: ${stack}
CORE GTM COVERAGE: ${Math.round(input.coreCoverage * 100)}% of the five core categories
OPEN ROLES ADVERTISED: ${input.openRoles}
PAGES IN SITEMAP: ${input.sitemapUrlCount ?? "unknown"}
${input.stageNotes.length ? `STAGE NOTES: ${input.stageNotes.join("; ")}` : ""}
${input.thin ? "⚠ THE SITE BARELY RENDERED SERVER-SIDE — you are working from very little. Score conservatively and say so in the reasoning." : ""}

PAGES:
${input.pages.slice(0, 32_000)}`;
}

// ── Normalising ─────────────────────────────────────────────────────────────

const clampScore = (v: unknown, max: number): number => {
  const n = typeof v === "number" ? v : Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, Math.round(n)));
};

const text = (v: unknown, max: number): string => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
};

export function normalizeScore(raw: unknown): ScoreResult {
  const o = (raw ?? {}) as Record<string, any>;

  const dimensions = {} as Record<DimensionKey, DimensionResult>;
  for (const d of DIMENSIONS) {
    const src = (o[d.key] ?? {}) as Record<string, unknown>;
    dimensions[d.key] = {
      score: clampScore(src.score, d.max),
      reasoning: text(src.reasoning, 1200),
      improve: text(src.improve, 300),
    };
  }

  const category = String(o.category ?? "").toLowerCase() as Category;
  const stage = String(o.stage ?? "").toLowerCase().replace(/\s+/g, "-") as Stage;

  return {
    eligible: o.eligible === true,
    ineligibleReason: text(o.ineligibleReason, 240),
    name: text(o.name, 80) || "This company",
    oneLiner: text(o.oneLiner, 120),
    category: (CATEGORIES as readonly string[]).includes(category) ? category : "other",
    stage: (STAGES as readonly string[]).includes(stage) ? stage : "unknown",
    dimensions,
    // Arithmetic in code, never asked of the model. A model given both prose and
    // a total will return prose arguing for 80 next to a total of 40.
    total: DIMENSIONS.reduce((sum, d) => sum + dimensions[d.key].score, 0),
    verdict: text(o.verdict, 900),
  };
}

/**
 * A scored result that says nothing is not a scored result.
 *
 * Runs inside the provider ladder's accept callback, so a model returning
 * well-formed JSON with empty reasoning drops to the next rung instead of
 * publishing a page full of blank sections.
 */
export function assertScoreUsable(r: ScoreResult): ScoreResult {
  if (!r.eligible) return r; // an ineligible verdict needs no dimensions
  for (const d of DIMENSIONS) {
    const dim = r.dimensions[d.key];
    if (dim.reasoning.length < 80) throw new Error(`${d.key}: reasoning too thin`);
    if (!dim.improve) throw new Error(`${d.key}: no improvement line`);
  }
  if (r.verdict.length < 60) throw new Error("verdict too short");
  return r;
}
