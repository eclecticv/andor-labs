/**
 * Rank My AdTech — the ranking pipeline.
 *
 * A visitor submits a work email and a company domain. We fetch that company's
 * homepage, reduce it to text, and ask a cheap model whether it is adtech at all.
 * If it is, three models from three independent providers score it on four axes
 * in parallel, a fourth writes the verdict, and the result is written to D1 and
 * published to a public leaderboard.
 *
 * Design notes that are easy to get wrong later:
 *
 * 1. THE NUMBER IS ARITHMETIC, THE WORDS ARE GENERATED. Axis scores are averaged
 *    from the jurors in code; the synthesizer never returns a total. A model
 *    asked for both prose and a total will happily return prose that argues for
 *    80 and a total of 40.
 *
 * 2. ONE JUROR PER PROVIDER. Not for redundancy — for disagreement. Three models
 *    from one lab agree with each other and tell you nothing. Where genuinely
 *    different training regimes diverge is the only real signal here.
 *
 * 3. ABSTENTIONS ARE NOT ALLOWED. Every provider is a LADDER of models, and a
 *    seat is filled by the first rung that answers usably. If a provider is
 *    exhausted the whole ranking fails rather than publishing a two-model panel
 *    under a page that promises three.
 *
 * 4. THE AXES ARE STAGE-NEUTRAL ON PURPOSE. Defensibility, platform risk and
 *    wedge strength all correlate with company size, so scoring them would rank
 *    incumbents highest by construction and measure the opposite of innovation.
 *    See docs/superpowers/specs/2026-08-13-rank-my-adtech-design.md §4.
 *
 * Required environment:
 *   RANKINGS         = D1 binding, configured on the Pages project itself
 *                      rather than in a wrangler config file. Pages does not
 *                      support partial configuration, so a root wrangler.toml
 *                      would take over the same namespace that holds this
 *                      project's production secrets. See d1.wrangler.jsonc.
 *   GEMINI_API_KEY   = juror 1
 *   NVIDIA_API_KEY   = gate + juror 2   (build.nvidia.com, OpenAI-compatible)
 *   OPENCODE_API_KEY = juror 3, and the preferred verdict writer
 *                      (opencode.ai **Go**, not Zen — see OPENCODE_BASE). The
 *                      verdict falls back to NVIDIA then Gemini, so an outage
 *                      there costs prose quality rather than the verdict.
 *   LOOPS_API_KEY    = lead capture
 *   DEPLOY_HOOK_URL  = Cloudflare Pages deploy hook; without it rankings are
 *                      stored but never appear on the public board.
 *
 * All three provider keys are REQUIRED. There is no degraded mode: a ranking
 * either seats three jurors and gets a written verdict, or it returns the
 * designed failure in failure() and writes nothing.
 */

interface Env {
  RANKINGS: D1Database;
  GEMINI_API_KEY?: string;
  NVIDIA_API_KEY?: string;
  OPENCODE_API_KEY?: string;
  LOOPS_API_KEY?: string;
  DEPLOY_HOOK_URL?: string;
  /** Overrides for the pinned model ids below, so a retirement is a config change. */
  NIM_MODEL?: string;
  OPENCODE_JUROR_MODEL?: string;
  OPENCODE_SYNTH_MODEL?: string;
}

// ── Providers ───────────────────────────────────────────────────────────────

/**
 * Every provider is a LADDER, not a model.
 *
 * The panel is not allowed to seat fewer than three jurors, so each provider
 * gets an ordered list of candidates and the seat is filled by the first one
 * that answers. A model retirement, a rate limit or a bad afternoon at one lab
 * costs a rung rather than a juror.
 *
 * Ordered best-first, verified against each provider's live catalogue on
 * 2026-08-14. Where a bigger model exists but is materially slower — NVIDIA's
 * 550B ultra, for instance — it sits BELOW the fast one rather than above it:
 * this whole pipeline runs inside one HTTP request, and a juror that times out
 * is worth less than a slightly smaller juror that answers.
 */
/**
 * 3.6 leads, not 3.7. The newer model is in the catalogue and advertises
 * generateContent, but returns 503 on every call we have made — so putting it
 * first bought nothing and cost a wasted round trip on every ranking. It stays
 * on the ladder because a 503 is the kind of thing that comes back.
 */
const GEMINI_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.7-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
];
const geminiEndpoint = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

const NIM_BASE = "https://integrate.api.nvidia.com/v1";
/**
 * OpenCode **Go**, not Zen — different product, different path, different
 * catalogue. Go is the $10/month subscription over ~26 curated open models;
 * Zen is the pay-as-you-go gateway that also fronts Anthropic, OpenAI and xAI.
 *
 * Getting this wrong is not obvious from the outside: a Go key authenticates
 * fine against Zen's `/models`, and only fails at `/chat/completions` — as a
 * 401 with a CreditsError body, which reads exactly like an unpaid Zen account
 * rather than "you are on the wrong endpoint".
 */
const OPENCODE_BASE = "https://opencode.ai/zen/go/v1";

/**
 * Verified against the Go catalogue on 2026-08-14 by calling each one.
 *
 * Qwen judges and OpenAI writes the verdict, which puts four different labs
 * across the four roles — Google, NVIDIA, Alibaba, OpenAI. The panel is picked
 * for disagreement, so lineage diversity is the whole point.
 *
 * deepseek-v4-pro sits BELOW qwen on the juror ladder despite being the better
 * model: it reasons at length before answering, and once jurors started
 * returning several sentences it began exhausting its token budget mid-thought.
 * A rung that costs a full wasted round trip is worth less than a rung that
 * answers.
 *
 * Ruled out entirely, all of which return HTTP 200 and are still unusable:
 *   grok-4.5     — "Endpoint is unavailable" from the provider
 *   kimi-k3      — empty content
 *   minimax-m3   — leaks raw <think> reasoning into the content field
 */
const OPENCODE_JUROR_MODELS = ["qwen3.8-max", "glm-5.3", "deepseek-v4-pro", "gpt-5.6-luna"];
const OPENCODE_SYNTH_MODELS = ["gpt-5.6-luna", "qwen3.8-max", "deepseek-v4-pro", "glm-5.3"];

/**
 * NIM ladder, best practical first. `nemotron-3-super-120b-a12b` leads rather
 * than the 550B ultra because it is a mixture-of-experts with ~12B active
 * parameters — near the quality, a fraction of the wall clock.
 */
const NIM_MODELS = [
  "nvidia/nemotron-3-super-120b-a12b",
  "nvidia/llama-3.3-nemotron-super-49b-v1.5",
  "nvidia/nemotron-3-ultra-550b-a55b",
  "nvidia/nemotron-3-nano-30b-a3b",
  "meta/llama-3.3-70b-instruct",
];

/**
 * NIM's catalogue is ~100 models and most of them cannot hold a conversation —
 * embedders, safety guards, rerankers, OCR and vision heads all sit in the same
 * list. A juror handed one of those does not fail cleanly; it returns something
 * shaped wrong and the take is discarded downstream for no visible reason.
 */
const NIM_NOT_CHAT = /embed|guard|safety|parse|retriev|clip|-vl|vlm|vision|video|translate|reward|rerank|ocr/i;

let nimCandidateCache: string[] | null = null;

/**
 * The NIM ladder, reconciled against what the account can actually see.
 *
 * Returns the preferred models that really exist, in preference order, then any
 * other chat-capable NVIDIA model as deeper rungs. If the catalogue call itself
 * fails we return the static ladder unchanged — a network blip reading /models
 * is not a reason to refuse to seat a juror.
 */
async function nimCandidates(key: string, override?: string): Promise<string[]> {
  if (override) return [override];
  if (nimCandidateCache) return nimCandidateCache;
  try {
    const res = await fetch(`${NIM_BASE}/models`, { headers: { authorization: `Bearer ${key}` } });
    if (!res.ok) return NIM_MODELS;
    const body = (await res.json()) as { data?: { id?: string }[] };
    const live = new Set(
      (body.data ?? []).map((m) => m.id).filter((id): id is string => !!id && !NIM_NOT_CHAT.test(id)),
    );
    const preferred = NIM_MODELS.filter((m) => live.has(m));
    const extras = [...live]
      .filter((id) => id.startsWith("nvidia/") && !preferred.includes(id))
      .sort();
    nimCandidateCache = [...preferred, ...extras];
    return nimCandidateCache.length ? nimCandidateCache : NIM_MODELS;
  } catch {
    return NIM_MODELS;
  }
}

// ── The panel ───────────────────────────────────────────────────────────────

type Lens = "vc" | "engineer" | "veteran";

const LENS_BRIEF: Record<Lens, string> = {
  vc: "You are a partner at a fund that has seen four hundred adtech decks and funded six. You care whether this is a company or a feature.",
  engineer:
    "You are a staff engineer who has built ad servers. You care what is actually hard here and what is a wrapper around someone else's API.",
  veteran:
    "You are twenty years into adtech. You have watched this exact idea come round three times. You care whether anything is genuinely different now.",
};

/** Fixed lens per provider so a re-run of the same company reads consistently. */
const PANEL: { provider: "gemini" | "nvidia" | "opencode"; lens: Lens }[] = [
  { provider: "gemini", lens: "engineer" },
  { provider: "nvidia", lens: "veteran" },
  { provider: "opencode", lens: "vc" },
];

const AXIS_MAX = { paradigm: 40, nonObviousness: 25, vibeCode: 20, conviction: 15 } as const;

// ── Divisions ───────────────────────────────────────────────────────────────

type Division = "featherweight" | "middleweight" | "heavyweight";
const DIVISIONS: Division[] = ["featherweight", "middleweight", "heavyweight"];

// ── Shapes ──────────────────────────────────────────────────────────────────

interface Gate {
  isAdtech: boolean;
  notAdtechVerdict: string;
  name: string;
  oneLiner: string;
  foundedYear: number | null;
  division: Division;
  provisional: boolean;
}

interface JurorScores {
  paradigm: number;
  nonObviousness: number;
  vibeCode: number;
  conviction: number;
}

interface JurorTake extends JurorScores {
  provider: string;
  modelId: string;
  lens: Lens;
  /** Several sentences of actual argument — what the company page shows. */
  reasoning: string;
  /** The sharpest single line, pulled out as the juror's quote. */
  quote: string;
  /** One word for this juror's temperature, e.g. "unimpressed". Leaderboard rows. */
  keyword: string;
  abstained: boolean;
}

type SiteRead = { text: string; title: string | null; logo: string | null; blocked: boolean };

// ── Reading the company's site ──────────────────────────────────────────────

/**
 * Fetch the homepage and reduce it to text, and take the logo while we are here.
 *
 * The logo comes out of this same HTML on purpose. Clearbit's free logo API —
 * the obvious choice — was sunset in December 2025, which is the second time an
 * enrichment vendor would have become a load-bearing dependency of a free tool.
 * apple-touch-icon and og:image are already in the document we had to fetch
 * anyway, cost nothing, and cannot be discontinued.
 */
async function readSite(url: string): Promise<SiteRead> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; AndorLabsResearchBot/1.0; +https://andorlabs.ca)",
        accept: "text/html,application/xhtml+xml",
      },
    });
    clearTimeout(timer);
    if (!res.ok) return { text: "", title: null, logo: null, blocked: true };

    const html = (await res.text()).slice(0, 400_000);
    const finalUrl = res.url || url;
    const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? null;

    const metas = Array.from(
      html.matchAll(
        /<meta[^>]+(?:name|property)=["'](description|og:description|og:title|keywords)["'][^>]*>/gi,
      ),
    )
      .map((m) => /content=["']([^"']*)["']/i.exec(m[0])?.[1] ?? "")
      .filter(Boolean)
      .join(" | ");

    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&#\d+;/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 14_000);

    return {
      text: [title, metas, text].filter(Boolean).join("\n"),
      title,
      logo: extractLogo(html, finalUrl),
      // Under 120 chars means we got a shell — a JS-rendered app, a consent
      // wall, or a bot block. Same reading as Scout uses.
      blocked: text.length < 120,
    };
  } catch {
    return { text: "", title: null, logo: null, blocked: true };
  }
}

/** apple-touch-icon first (largest, squarest), then og:image, then nothing. */
function extractLogo(html: string, baseUrl: string): string | null {
  const abs = (href: string) => {
    try {
      return new URL(href, baseUrl).toString();
    } catch {
      return null;
    }
  };

  const touch = Array.from(
    html.matchAll(/<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]*>/gi),
  )
    .map((m) => /href=["']([^"']+)["']/i.exec(m[0])?.[1])
    .find(Boolean);
  if (touch) return abs(touch);

  const og = Array.from(html.matchAll(/<meta[^>]+property=["']og:image["'][^>]*>/gi))
    .map((m) => /content=["']([^"']+)["']/i.exec(m[0])?.[1])
    .find(Boolean);
  if (og) return abs(og);

  return null;
}

// ── Prompts ─────────────────────────────────────────────────────────────────

const GATE_PROMPT = `You classify companies for an adtech leaderboard. Return JSON only.

Decide whether the company is ADTECH or MARTECH infrastructure: anything in the
business of buying, selling, serving, measuring, verifying, targeting, or
monetising digital advertising. DSPs, SSPs, ad servers, exchanges, identity,
measurement, verification, CTV, retail media, publisher monetisation, CMPs,
attribution. A company that merely BUYS ads (an ecommerce brand, an agency) is
NOT adtech. A general analytics or CRM company is NOT adtech.

Also extract, from the page only — never guess:
- name: the company's name
- oneLiner: what it does, under 90 characters, plain language, no marketing words
- foundedYear: integer, or null if the page does not say
- division: "featherweight" (pre-seed/seed, or under ~20 people),
  "middleweight" (Series A-C, clearly scaling),
  "heavyweight" (public, PE-owned, or plainly at very large scale).
  Most sites never state headcount or funding, so infer from scale evidence:
  named enterprise customers, a logo wall, multiple office locations, a careers
  page with many roles, an investor-relations or press section, awards, years of
  operation, or a large partner ecosystem. A site with a long customer list is
  not a featherweight no matter what it omits.
  If there is genuinely no signal either way, use "middleweight" — it is the
  middle of the range, so being wrong costs one division rather than two.
- provisional: true when the page is a waitlist, a coming-soon, or otherwise has
  no real product detail to judge. This is not a failure — it is honesty.
- notAdtechVerdict: if isAdtech is false, one dry, friendly sentence saying what
  the company actually appears to be. Empty string otherwise.

JSON shape:
{"isAdtech":bool,"notAdtechVerdict":str,"name":str,"oneLiner":str,
 "foundedYear":int|null,"division":str,"provisional":bool}`;

function jurorPrompt(lens: Lens, gate: Gate, siteText: string, blocked: boolean): string {
  return `${LENS_BRIEF[lens]}

You are one of three judges on a panel scoring adtech companies for innovation.
The other two are different models with different views. Do not hedge toward a
middle score to be agreeable — your disagreement is the point of the panel.

COMPANY: ${gate.name}
WHAT IT DOES: ${gate.oneLiner}
FOUNDED: ${gate.foundedYear ?? "not stated"}
${blocked ? "NOTE: the site could not be read properly. Judge from the name and domain, and score conservatively.\n" : ""}
Score four axes. These are deliberately stage-neutral: a three-person team and a
public company can each max any of them, and neither gets any of them for free.

1. paradigm (0-${AXIS_MAX.paradigm}) — does this assume the world of 2026, or the world of 2016
   with an AI badge stapled on? Company age is CONTEXT, NOT CREDIT. A company
   founded last week gets no points for merely being new. A twenty-year-old
   company that genuinely repositioned gets full marks for it.
2. nonObviousness (0-${AXIS_MAX.nonObviousness}) — is the insight one that was not already in
   everybody else's deck?
3. vibeCode (0-${AXIS_MAX.vibeCode}) — how hard is this actually to build? High score means
   genuinely hard. Low score means a competent engineer rebuilds the core in a
   weekend with current tools.
4. conviction (0-${AXIS_MAX.conviction}) — one real position, or hedging across five categories
   to look bigger than it is?

Then three more fields, all published next to your model's name:

- reasoning: FOUR TO SIX SENTENCES showing your actual argument. Name what you
  saw on the page and what you concluded from it. Say which axis you were
  hardest on and why. A reader must be able to tell whether the score was
  reasoned or guessed, so a single clever line is a FAILURE here — that is what
  the quote field is for. Do not restate the numbers.
- quote: your sharpest single sentence, under 140 characters.
- keyword: ONE lowercase word for your overall temperature — e.g. unimpressed,
  curious, sold, sceptical, bored, intrigued, unconvinced, impressed. One word,
  no punctuation.

Be funny if it is funny, but aim at the positioning, never at people, and never
state a company is failing, fraudulent, or in financial trouble.

Return JSON only:
{"paradigm":int,"nonObviousness":int,"vibeCode":int,"conviction":int,
 "reasoning":str,"quote":str,"keyword":str}

PAGE TEXT:
${siteText.slice(0, 9_000)}`;
}

function synthPrompt(gate: Gate, takes: JurorTake[], scores: JurorScores, total: number): string {
  // The synthesizer sees each juror's full ARGUMENT, not just their pull-quote.
  // Handing it three soundbites produced a verdict that rewrote the soundbites;
  // handing it the reasoning is what lets it find where the panel actually
  // diverged and write a split note worth reading.
  const panel = takes
    .map(
      (t) =>
        `${t.modelId} (as the ${t.lens}) — ${t.keyword}. Scores: paradigm ${t.paradigm}, nonObviousness ${t.nonObviousness}, vibeCode ${t.vibeCode}, conviction ${t.conviction}.\nReasoning: ${t.reasoning}\nPull quote: "${t.quote}"`,
    )
    .join("\n\n");

  return `You write the verdict for "Rank My AdTech", a public leaderboard that
scores adtech companies on innovation. The register is a boxing undercard called
by someone who genuinely likes the sport: confident, quick, fond of the
participants. It is a bit, and a company that scores badly should finish reading
and understand that it was a bit.

RULES, all of them hard:
- Punch at the positioning, the category, or the copy. NEVER at named people.
- Every roast leaves a door open — say what would raise the score.
- Invent no facts. Everything traces to the panel's words or the company summary.
- Short sentences. One joke per paragraph, not three.
- Never say or imply a company is failing, fraudulent, or in financial trouble.
- Do not restate the numbers. They are already on the page.

COMPANY: ${gate.name} — ${gate.oneLiner}
DIVISION: ${gate.division}${gate.provisional ? " (provisional: the site had little to judge)" : ""}
FINAL SCORE: ${total}/100 (paradigm ${scores.paradigm}, non-obviousness ${scores.nonObviousness}, vibe-code ${scores.vibeCode}, conviction ${scores.conviction})

THE PANEL:
${panel}

Return JSON only:
{"verdict": str, "splitNote": str, "platformNote": str}

verdict: 60-110 words. The call, in the voice above.
splitNote: one sentence on where the panel disagreed, naming the models. Empty
  string if they broadly agreed.
platformNote: one dry sentence on how much of this business is rented from
  Google, Meta, Amazon or The Trade Desk. Not scored — just noted. If the page
  gives you nothing concrete to say, return an EMPTY STRING. Never write that
  the information was unavailable, unclear, or not specified — a sentence
  describing the absence of a fact is worse than no sentence, and this field is
  dropped entirely when empty.`;
}

// ── Provider calls ──────────────────────────────────────────────────────────

async function callGemini(key: string, model: string, prompt: string): Promise<string> {
  const res = await fetch(`${geminiEndpoint(model)}?key=${key}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}`);
  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = body.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text) throw new Error("gemini empty");
  return text;
}

/** NIM and OpenCode Zen are both OpenAI-compatible, so they share one caller. */
async function callOpenAICompatible(
  base: string,
  key: string,
  model: string,
  prompt: string,
): Promise<string> {
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      /**
       * Sized for a REASONING model, not for the answer.
       *
       * NIM's Nemotron tier thinks out loud into `reasoning_content` and that
       * budget is spent before a single character of JSON appears — measured at
       * ~1,200 reasoning tokens against 36 of answer on a trivial prompt, and
       * far more on a real one. At 900 the juror never finished thinking and
       * abstained on every call while looking like a truncation bug.
       *
       * Raised again to 4000 once jurors began returning several sentences of
       * reasoning rather than one line: deepseek-v4-pro reasons too, and at
       * 2500 it spent the whole budget thinking and returned nothing, costing a
       * full round trip before the ladder moved on. Headroom here is far
       * cheaper than a wasted call.
       */
      max_tokens: 4000,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    // Zen reports an exhausted balance as a 401, which is indistinguishable
    // from a bad key at the status line. Carry the body so the log says which.
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`${base} ${res.status}${detail ? ` — ${detail}` : ""}`);
  }
  const body = (await res.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
  };
  const choice = body.choices?.[0];
  const text = choice?.message?.content ?? "";
  /**
   * `finish_reason: "length"` is NOT fatal on its own. A reasoning model can
   * exhaust its budget mid-thought and still have emitted complete JSON, and
   * discarding that is throwing away a juror who actually answered. Only an
   * empty answer is fatal; a genuinely truncated one fails in extractJson,
   * which is the correct place for it to fail.
   */
  if (!text) {
    throw new Error(choice?.finish_reason === "length" ? "truncated before answering" : "empty completion");
  }
  return text;
}

// ── Asking a provider, with rungs ───────────────────────────────────────────

type Provider = "gemini" | "nvidia" | "opencode";

/** The ordered candidates for a provider, reconciled with what it really has. */
async function modelsFor(provider: Provider, env: Env): Promise<string[]> {
  if (provider === "gemini") return GEMINI_MODELS;
  if (provider === "opencode") return OPENCODE_JUROR_MODELS;
  return env.NVIDIA_API_KEY ? nimCandidates(env.NVIDIA_API_KEY, env.NIM_MODEL) : [];
}

function keyFor(provider: Provider, env: Env): string | undefined {
  return provider === "gemini"
    ? env.GEMINI_API_KEY
    : provider === "nvidia"
      ? env.NVIDIA_API_KEY
      : env.OPENCODE_API_KEY;
}

async function askOnce(provider: Provider, key: string, model: string, prompt: string) {
  if (provider === "gemini") return callGemini(key, model, prompt);
  return callOpenAICompatible(provider === "nvidia" ? NIM_BASE : OPENCODE_BASE, key, model, prompt);
}

/**
 * Walk a provider's ladder until one rung answers usably.
 *
 * `accept` is what makes this more than a retry loop: a call can succeed at the
 * HTTP layer and still be useless — a model that returns "..." or unparseable
 * JSON has failed, and the ladder should keep climbing rather than hand that
 * back. Throws only when every rung is exhausted, which is the one case the
 * caller must treat as a real outage.
 */
async function askLadder<T>(
  provider: Provider,
  env: Env,
  prompt: string,
  accept: (text: string, model: string) => T,
): Promise<{ model: string; value: T }> {
  const key = keyFor(provider, env);
  if (!key) throw new Error(`${provider}: no key configured`);

  const models = await modelsFor(provider, env);
  if (!models.length) throw new Error(`${provider}: no candidate models`);

  const failures: string[] = [];
  for (const model of models) {
    try {
      const value = accept(await askOnce(provider, key, model, prompt), model);
      // Log WHY the higher rungs failed, not just how many. A ladder that
      // silently drops a rung every call is a ladder whose top entry should be
      // reordered, and the count alone never tells you that.
      if (failures.length) {
        console.log(`[rank] ${provider} seated ${model}; skipped — ${failures.join(" ; ")}`);
      }
      return { model, value };
    } catch (err) {
      failures.push(`${model}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`${provider} exhausted — ${failures.join(" | ")}`);
}

// ── Normalising ─────────────────────────────────────────────────────────────

/** Models wrap JSON in prose and fences often enough that this is not optional. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("no json found");
    return JSON.parse(candidate.slice(start, end + 1));
  }
}

export const clampInt = (value: unknown, max: number): number => {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, Math.round(n)));
};

export const clampText = (value: unknown, max: number, fallback = ""): string => {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) return fallback;
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
};

/**
 * Drop a sentence whose only content is that the model had nothing to say.
 *
 * These fields render as their own sections, so "the summary does not specify
 * how much of the business is rented from Google" becomes a heading followed by
 * an admission — strictly worse than omitting the section. The prompt asks for
 * an empty string; this is the clamp for when it does not comply, same posture
 * as the score clamps.
 */
const NON_STATEMENT =
  /\b(does not (specify|say|mention|indicate)|not specified|no (information|detail|indication)|unclear from|cannot determine|insufficient (information|detail)|unable to determine)\b/i;

export function dropNonStatement(value: string): string {
  return NON_STATEMENT.test(value) ? "" : value;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function normalizeGate(raw: unknown): Gate {
  const o = (raw ?? {}) as Record<string, unknown>;
  const division = String(o.division ?? "").toLowerCase() as Division;
  const year = Number.parseInt(String(o.foundedYear ?? ""), 10);
  return {
    isAdtech: o.isAdtech === true,
    notAdtechVerdict: clampText(o.notAdtechVerdict, 240),
    name: clampText(o.name, 80, "This company"),
    oneLiner: clampText(o.oneLiner, 120),
    // 1990 floor because an adtech company founded before the web is a
    // hallucination, and a future year is a typo we should not publish.
    foundedYear:
      Number.isFinite(year) && year >= 1990 && year <= new Date().getUTCFullYear() ? year : null,
    // Middleweight is the fallback for the same reason the prompt says so:
    // dropping an unclassifiable company into featherweight would let an
    // incumbent win the division that exists to give small companies a board
    // they can actually win.
    division: DIVISIONS.includes(division) ? division : "middleweight",
    provisional: o.provisional === true,
  };
}

export function normalizeTake(raw: unknown, provider: string, modelId: string, lens: Lens): JurorTake {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    provider,
    modelId,
    lens,
    paradigm: clampInt(o.paradigm, AXIS_MAX.paradigm),
    nonObviousness: clampInt(o.nonObviousness, AXIS_MAX.nonObviousness),
    vibeCode: clampInt(o.vibeCode, AXIS_MAX.vibeCode),
    conviction: clampInt(o.conviction, AXIS_MAX.conviction),
    reasoning: clampText(o.reasoning, 900),
    quote: clampText(o.quote, 180),
    // One word, lowercase, letters only. Models reliably return "unimpressed."
    // with a full stop, or a two-word phrase; the row has space for neither.
    keyword: clampText(o.keyword, 24).toLowerCase().replace(/[^a-z-]/g, "").slice(0, 16),
    abstained: false,
  };
}

/**
 * A juror that answered but said nothing usable has not answered.
 *
 * This runs inside the ladder's `accept` callback, so a model that returns
 * well-formed JSON with an empty reasoning field drops to the next rung instead
 * of seating a juror whose panel entry would be blank.
 */
export function assertUsable(take: JurorTake): JurorTake {
  if (take.reasoning.length < 80) throw new Error(`reasoning too thin (${take.reasoning.length})`);
  if (!take.quote) throw new Error("no quote");
  if (!take.keyword) throw new Error("no keyword");
  return take;
}

/**
 * Average the panel, axis by axis.
 *
 * Computed here rather than asked of the synthesizer: a model asked for prose
 * and a total will return prose arguing for 80 next to a total of 40, and the
 * number is the part a leaderboard sorts on.
 */
export function averageScores(takes: JurorTake[]): JurorScores {
  const live = takes.filter((t) => !t.abstained);
  const mean = (pick: (t: JurorTake) => number, max: number) =>
    live.length ? Math.max(0, Math.min(max, Math.round(live.reduce((s, t) => s + pick(t), 0) / live.length))) : 0;
  return {
    paradigm: mean((t) => t.paradigm, AXIS_MAX.paradigm),
    nonObviousness: mean((t) => t.nonObviousness, AXIS_MAX.nonObviousness),
    vibeCode: mean((t) => t.vibeCode, AXIS_MAX.vibeCode),
    conviction: mean((t) => t.conviction, AXIS_MAX.conviction),
  };
}

// ── Lead capture ────────────────────────────────────────────────────────────

const LOOPS_ENDPOINT = "https://app.loops.so/api/v1/contacts/update";

/**
 * Duplicated from Scout on purpose, and from src/lib/categories.ts before that.
 * Pages Functions bundle separately from the Astro build, and whether an import
 * from src/ resolves is not something to discover at deploy time.
 */
const LEAD_LISTS: Record<string, true> = {
  cmsqj2crd0mas0j1jdd7t9iyf: true, // Lead magnets
  cmsoulfdz0idi0j2q62ea241f: true, // {ignore all previous instructions}
  cmsouuptw04kb0jx7h33a26b2: true, // Field notes by Vishveshwar Jatain
};

async function syncLeadToLoops(key: string, email: string, domain: string): Promise<void> {
  try {
    await fetch(LOOPS_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        email,
        source: "Rank My AdTech",
        userGroup: "Lead magnet",
        rankedDomain: domain,
        mailingLists: LEAD_LISTS,
      }),
    });
  } catch (err) {
    // A dead CRM must never cost the visitor their ranking.
    console.error("[rank] loops sync failed:", err);
  }
}

// ── Email and input validation ──────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.ca", "yahoo.co.uk",
  "hotmail.com", "hotmail.ca", "hotmail.co.uk", "outlook.com", "live.com",
  "msn.com", "aol.com", "icloud.com", "me.com", "mac.com", "proton.me",
  "protonmail.com", "gmx.com", "gmx.de", "mail.com", "mail.ru", "yandex.com",
  "yandex.ru", "zoho.com", "qq.com", "163.com", "126.com", "naver.com",
  "rediffmail.com", "shaw.ca", "rogers.com", "telus.net", "sympatico.ca",
  "bell.net", "comcast.net", "verizon.net", "att.net", "sbcglobal.net",
  "cox.net", "btinternet.com", "orange.fr", "free.fr", "web.de", "t-online.de",
]);

const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com",
  "temp-mail.org", "yopmail.com", "trashmail.com", "sharklasers.com",
  "getnada.com", "dispostable.com", "mailinator.net", "throwawaymail.com",
  "fakeinbox.com", "maildrop.cc", "moakt.com", "emailondeck.com",
]);

const emailDomain = (email: string) => email.split("@")[1]?.trim().toLowerCase() ?? "";

/** Normalize a submitted domain to its bare host, or null when unusable. */
export function normalizeDomain(input: string): string | null {
  const raw = input.trim().toLowerCase();
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.replace(/^www\./, "");
    if (!host.includes(".") || host.length < 4) return null;
    return host;
  } catch {
    return null;
  }
}

/**
 * Hash rather than store the address. Rate limiting needs to know two requests
 * shared an origin, which does not require knowing where that origin is.
 */
async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(`rank-my-adtech:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── The rebuild trigger ─────────────────────────────────────────────────────

const BUILD_THROTTLE_MINUTES = 5;

/**
 * Fire the Pages deploy hook, at most once every few minutes.
 *
 * The board is static, so a ranking is invisible until a build runs. Firing per
 * submission would work and would also spend a monthly build quota that the
 * whole site shares. See migrations/0002 for the pending-flag edge case.
 */
async function triggerRebuild(env: Env): Promise<void> {
  if (!env.DEPLOY_HOOK_URL) {
    console.warn("[rank] DEPLOY_HOOK_URL unset — ranking stored but board will not refresh");
    return;
  }
  try {
    const state = await env.RANKINGS.prepare(
      "SELECT last_fired_at FROM build_state WHERE id = 1",
    ).first<{ last_fired_at: string | null }>();

    const last = state?.last_fired_at ? Date.parse(`${state.last_fired_at}Z`) : 0;
    const elapsedMin = (Date.now() - last) / 60_000;

    if (last && elapsedMin < BUILD_THROTTLE_MINUTES) {
      await env.RANKINGS.prepare("UPDATE build_state SET pending = 1 WHERE id = 1").run();
      return;
    }

    await fetch(env.DEPLOY_HOOK_URL, { method: "POST" });
    await env.RANKINGS.prepare(
      "UPDATE build_state SET last_fired_at = datetime('now'), pending = 0 WHERE id = 1",
    ).run();
  } catch (err) {
    console.error("[rank] rebuild trigger failed:", err);
  }
}

// ── HTTP plumbing ───────────────────────────────────────────────────────────

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

/**
 * The designed failure.
 *
 * A ranking either publishes with three real jurors and a written verdict, or
 * it does not publish. That is a deliberate trade — a half-panel behind a page
 * that promises three models is worse than an outage — so the failure needs to
 * be part of the bit rather than a raw 502 in a red box. Each stage says which
 * part of the machine fell over, in the tool's own voice.
 */
function failure(stage: "gate" | "panel" | "verdict") {
  const copy = {
    gate: {
      headline: "We could not get a look at them.",
      detail:
        "Every classifier we own tried to read that site and came back with nothing. Either it is very well defended or we are having a bad afternoon. The authorities have been notified.",
    },
    panel: {
      headline: "A judge failed to appear.",
      detail:
        "This board seats three models from three different labs, and it does not publish with two — a smaller panel dressed up as a full one is the one thing we will not do. Someone is currently being spoken to. Try again shortly.",
    },
    verdict: {
      headline: "The panel scored it, then refused to write it up.",
      detail:
        "Every model we asked to deliver the verdict either declined or produced something that could not be printed in front of an audience. The scores exist. The prose does not. The authorities have been notified.",
    },
  }[stage];

  return { status: "failed" as const, stage, ...copy };
}

/** Matches Scout: localhost origins pass so `wrangler pages dev` works. */
function isLocalOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".localhost");
  } catch {
    return false;
  }
}

const RATE_LIMIT_PER_DAY = 5;

// ── Handler ─────────────────────────────────────────────────────────────────

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const origin = request.headers.get("origin") ?? "";
  if (origin && !isLocalOrigin(origin) && !origin.endsWith("andorlabs.ca") && !origin.endsWith(".pages.dev")) {
    return json({ error: "Forbidden origin." }, 403);
  }

  let payload: { email?: string; domain?: string };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return json({ error: "Send JSON." }, 400);
  }

  const email = (payload.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return json({ error: "That email does not look right." }, 400);

  const from = emailDomain(email);
  if (DISPOSABLE_DOMAINS.has(from)) return json({ error: "Use a real address." }, 400);
  if (FREE_EMAIL_DOMAINS.has(from)) {
    return json({ error: "Work email, please — a personal one tells us nothing." }, 400);
  }

  /**
   * The domain comes from the EMAIL, following Subreddit Scout.
   *
   * Consequence worth being explicit about: this means you can only rank your
   * own employer. The tool was originally specified as "anyone can submit
   * anyone", and inferring the domain quietly closes that — which also closes
   * the competitor-bombing vector it opened. `domain` is still accepted in the
   * payload so the flow stays testable, but the form no longer sends one.
   */
  const domain = normalizeDomain(payload.domain || emailDomain(email));
  if (!domain) return json({ error: "That does not look like a company domain." }, 400);

  // ── Rate limit ────────────────────────────────────────────────────────────
  const ipHash = await hashIp(request.headers.get("cf-connecting-ip") ?? "unknown");
  const recent = await env.RANKINGS.prepare(
    "SELECT COUNT(*) AS n FROM submission WHERE ip_hash = ? AND created_at > datetime('now', '-1 day')",
  )
    .bind(ipHash)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= RATE_LIMIT_PER_DAY) {
    return json({ error: "That is enough rankings for one day. Come back tomorrow." }, 429);
  }

  await env.RANKINGS.prepare("INSERT INTO submission (email, domain, ip_hash) VALUES (?, ?, ?)")
    .bind(email, domain, ipHash)
    .run();

  // Lead first, always. Scout learned this: the moments the model is flaky are
  // exactly the moments the lead matters most.
  if (env.LOOPS_API_KEY) await syncLeadToLoops(env.LOOPS_API_KEY, email, domain);

  // ── Already ranked? ───────────────────────────────────────────────────────
  // One company is one row, permanently. This is the cost control as much as it
  // is the dedup: a resubmission must not spend four model calls to reprint an
  // answer we already have.
  const existing = await env.RANKINGS.prepare(
    "SELECT slug FROM company WHERE domain = ? AND status = 'published'",
  )
    .bind(domain)
    .first<{ slug: string }>();
  if (existing) {
    return json({ status: "already-ranked", slug: existing.slug, domain }, 200);
  }

  // ── Read the site ─────────────────────────────────────────────────────────
  const site = await readSite(`https://${domain}`);

  // ── Gate ──────────────────────────────────────────────────────────────────
  const gateInput = `${GATE_PROMPT}\n\nDOMAIN: ${domain}\n\nPAGE TEXT:\n${site.text.slice(0, 8_000)}`;
  // The gate is a binary decision, so one working model settles it — but it
  // still climbs NVIDIA's ladder before falling through to Google's, because a
  // gate that cannot answer means no ranking at all.
  let gate: Gate;
  try {
    const asGate = (text: string) => normalizeGate(extractJson(text));
    let result: { value: Gate } | null = null;
    for (const provider of ["nvidia", "gemini"] as Provider[]) {
      if (!keyFor(provider, env)) continue;
      try {
        result = await askLadder(provider, env, gateInput, asGate);
        break;
      } catch (err) {
        console.error(`[rank] gate: ${provider} exhausted:`, err);
      }
    }
    if (!result) return json(failure("gate"), 502);
    gate = result.value;
  } catch (err) {
    console.error("[rank] gate failed:", err);
    return json(failure("gate"), 502);
  }

  if (!gate.isAdtech) {
    return json(
      {
        status: "not-adtech",
        domain,
        name: gate.name,
        verdict: gate.notAdtechVerdict || "The panel could not find any adtech here.",
      },
      200,
    );
  }

  // ── Panel ─────────────────────────────────────────────────────────────────
  /**
   * Three seats, three providers, and NO ABSTENTIONS.
   *
   * Each seat climbs its provider's ladder until a model answers usably, so a
   * retirement or a rate limit costs a rung rather than a juror. If a provider
   * is exhausted the whole ranking fails — publishing a two-model verdict under
   * a page that promises three would be the dishonest way to stay up.
   */
  const settled = await Promise.allSettled(
    PANEL.map(({ provider, lens }) =>
      askLadder(provider, env, jurorPrompt(lens, gate, site.text, site.blocked), (text, model) =>
        assertUsable(normalizeTake(extractJson(text), provider, model, lens)),
      ).then((r) => r.value),
    ),
  );

  const failed = settled
    .map((r, i) => (r.status === "rejected" ? `${PANEL[i].provider}: ${r.reason}` : null))
    .filter(Boolean);

  if (failed.length) {
    console.error("[rank] panel incomplete, refusing to publish:", failed.join(" || "));
    return json(failure("panel"), 502);
  }

  const takes: JurorTake[] = settled.map((r) => (r as PromiseFulfilledResult<JurorTake>).value);
  const live = takes;

  const scores = averageScores(takes);
  const total = scores.paradigm + scores.nonObviousness + scores.vibeCode + scores.conviction;

  // ── Synthesizer ───────────────────────────────────────────────────────────
  /**
   * A ladder, not a single call.
   *
   * The panel fans out across three providers precisely so that no one outage
   * kills a ranking; leaving the verdict — the only part a reader actually
   * reads closely — on a single provider put that guarantee back. It is not
   * hypothetical: Zen reports an exhausted balance as a 401, and every ranking
   * written during one falls back to reprinting a juror's quote.
   *
   * Order is by writing quality, because this step is prose. Sonnet first;
   * the others are a working verdict rather than an equal one.
   */
  const prompt = synthPrompt(gate, live, scores, total);

  /**
   * A verdict has to clear a FLOOR, not merely be non-empty.
   *
   * The previous version broke out of this ladder the moment the field was
   * truthy, so a model that returned "..." won and every fallback below it was
   * skipped. Chalice shipped with three dots as its published verdict. Sixty
   * characters is not a quality bar, but it is enough to tell a verdict from a
   * shrug, and anything shorter now falls through like a failure.
   */
  const MIN_VERDICT = 60;

  let verdict = "";
  let splitNote = "";
  let platformNote = "";

  for (const provider of ["opencode", "nvidia", "gemini"] as Provider[]) {
    if (!keyFor(provider, env)) continue;
    try {
      const models = provider === "opencode" ? OPENCODE_SYNTH_MODELS : await modelsFor(provider, env);
      const key = keyFor(provider, env) as string;
      for (const model of models) {
        try {
          const raw = extractJson(await askOnce(provider, key, model, prompt)) as Record<string, unknown>;
          const candidate = clampText(raw.verdict, 900);
          if (candidate.length < MIN_VERDICT) throw new Error(`verdict too short (${candidate.length})`);
          verdict = candidate;
          splitNote = dropNonStatement(clampText(raw.splitNote, 300));
          platformNote = dropNonStatement(clampText(raw.platformNote, 300));
          if (provider !== "opencode" || model !== OPENCODE_SYNTH_MODELS[0]) {
            console.log(`[rank] verdict written by ${provider}/${model}`);
          }
          break;
        } catch (err) {
          console.error(`[rank] synthesizer ${provider}/${model} failed:`, err);
        }
      }
    } catch (err) {
      console.error(`[rank] synthesizer ${provider} unavailable:`, err);
    }
    if (verdict) break;
  }

  // Every writer on every provider failed to produce a usable verdict. The
  // panel scored fine, but publishing a page whose headline section is a
  // fallback sentence is not what this tool promises — fail it properly.
  if (!verdict) {
    console.error("[rank] no synthesizer produced a usable verdict");
    return json(failure("verdict"), 502);
  }

  // ── Persist ───────────────────────────────────────────────────────────────
  /**
   * Reserved slugs.
   *
   * Company pages live at /tools/rank-my-adtech/<slug>/, and the board sits at
   * /tools/rank-my-adtech/leaderboard/. Astro resolves the static route first
   * so a company called "Leaderboard" would not actually break the board — it
   * would simply become unreachable, which is worse, because nothing would look
   * broken. Renaming it here is cheap.
   */
  const RESERVED = new Set(["leaderboard", "index", "api", "og"]);

  let slug = slugify(gate.name) || slugify(domain);
  if (RESERVED.has(slug)) slug = `${slug}-${slugify(domain).slice(0, 12)}`;
  const clash = await env.RANKINGS.prepare("SELECT 1 FROM company WHERE slug = ?")
    .bind(slug)
    .first();
  if (clash) slug = `${slug}-${slugify(domain).slice(0, 12)}`;

  const companyRow = await env.RANKINGS.prepare(
    `INSERT INTO company (domain, name, slug, logo_url, one_liner, founded_year, division, provisional)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(
      domain, gate.name, slug, site.logo, gate.oneLiner,
      gate.foundedYear, gate.division, gate.provisional ? 1 : 0,
    )
    .first<{ id: number }>();

  const companyId = companyRow?.id;
  if (!companyId) return json({ error: "Could not save that ranking." }, 500);

  const rankingRow = await env.RANKINGS.prepare(
    `INSERT INTO ranking (company_id, total, paradigm, non_obviousness, vibe_code, conviction, verdict, split_note, platform_note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(
      companyId, total, scores.paradigm, scores.nonObviousness, scores.vibeCode,
      scores.conviction, verdict, splitNote || null, platformNote || null,
    )
    .first<{ id: number }>();

  const rankingId = rankingRow?.id;
  if (rankingId) {
    await env.RANKINGS.batch(
      takes.map((t) =>
        env.RANKINGS.prepare(
          `INSERT INTO juror_take (ranking_id, provider, model_id, lens, scores_json, reasoning, quote, keyword, abstained)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          rankingId, t.provider, t.modelId, t.lens,
          JSON.stringify({
            paradigm: t.paradigm, nonObviousness: t.nonObviousness,
            vibeCode: t.vibeCode, conviction: t.conviction,
          }),
          t.reasoning || null,
          t.quote || null,
          t.keyword || null,
          0,
        ),
      ),
    );
  }

  await triggerRebuild(env);

  return json(
    {
      status: "ranked",
      slug,
      domain,
      name: gate.name,
      oneLiner: gate.oneLiner,
      logo: site.logo,
      division: gate.division,
      provisional: gate.provisional,
      total,
      scores,
      verdict,
      splitNote,
      platformNote,
      panel: takes.map((t) => ({
        provider: t.provider, modelId: t.modelId, lens: t.lens,
        reasoning: t.reasoning, quote: t.quote, keyword: t.keyword,
        abstained: t.abstained,
      })),
    },
    200,
  );
};
