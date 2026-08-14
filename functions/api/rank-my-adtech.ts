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
 * 3. LOSING A JUROR MUST NOT LOSE THE RANKING. The panel fans out with
 *    allSettled and a failed provider is recorded as an abstention.
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
 *                      (opencode.ai/zen gateway). The verdict falls back to
 *                      NVIDIA then Gemini, so an empty Zen balance costs
 *                      prose quality rather than the verdict itself.
 *   LOOPS_API_KEY    = lead capture
 *   DEPLOY_HOOK_URL  = Cloudflare Pages deploy hook; without it rankings are
 *                      stored but never appear on the public board.
 *
 * Absent provider keys degrade rather than fail: that juror abstains. The one
 * exception is a panel where every juror abstained, which is an error.
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

const GEMINI_MODEL = "gemini-3.5-flash-lite";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const NIM_BASE = "https://integrate.api.nvidia.com/v1";
const OPENCODE_BASE = "https://opencode.ai/zen/v1";

/**
 * OpenCode Zen ids, verified against its published catalogue. Grok is the juror
 * because it is the least agreeable model available and this is a panel picked
 * for disagreement; Sonnet writes the verdict because the verdict is the only
 * part a reader actually reads closely.
 */
const OPENCODE_JUROR_DEFAULT = "grok-4.6";
const OPENCODE_SYNTH_DEFAULT = "claude-sonnet-5";

/**
 * NIM ids are resolved at runtime rather than hardcoded.
 *
 * NVIDIA's catalogue rotates faster than this file will be edited, and a stale
 * id does not fail loudly — it 404s, the juror abstains, and the panel quietly
 * shrinks to two while looking entirely healthy. Asking the provider which
 * models it actually has removes that failure mode. Resolved once and cached
 * for the life of the isolate.
 *
 * Ordered by preference and matched as a PREFIX, not a substring. Substring
 * matching was wrong: "nemotron" also matches `mistralai/mistral-nemotron`, a
 * Mistral model, which would quietly seat a juror from a lab this panel did
 * not choose. Prefixes name the exact family.
 */
const NIM_PREFERENCES = [
  "nvidia/nemotron-3-super",
  "nvidia/llama-3.3-nemotron-super",
  "nvidia/nemotron-3-nano",
  "meta/llama-3.3",
  "mistralai/mistral-large",
];

/**
 * NIM's catalogue is ~100 models and most of them cannot hold a conversation —
 * embedders, safety guards, rerankers, OCR and vision heads all sit in the same
 * list. A juror handed one of those does not fail cleanly; it returns something
 * shaped wrong and the take is discarded downstream for no visible reason.
 */
const NIM_NOT_CHAT = /embed|guard|safety|parse|retriev|clip|-vl|vlm|vision|video|translate|reward|rerank|ocr/i;

let nimModelCache: string | null = null;

async function resolveNimModel(key: string, override?: string): Promise<string | null> {
  if (override) return override;
  if (nimModelCache) return nimModelCache;
  try {
    const res = await fetch(`${NIM_BASE}/models`, {
      headers: { authorization: `Bearer ${key}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { id?: string }[] };
    const ids = (body.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => !!id && !NIM_NOT_CHAT.test(id));

    for (const want of NIM_PREFERENCES) {
      // Newest revision of a family wins: `...super-49b-v1.5` sorts after
      // `...super-49b-v1`, so the last match is the one to seat.
      const hits = ids.filter((id) => id.toLowerCase().startsWith(want)).sort();
      if (hits.length) {
        nimModelCache = hits[hits.length - 1];
        return nimModelCache;
      }
    }

    // Deliberately null rather than "whatever is first". An unrecognised
    // catalogue means this list is out of date, and abstaining says so; seating
    // an arbitrary model would publish a juror nobody chose.
    console.warn("[rank] no NIM model matched the preference list — juror abstains");
    return null;
  } catch {
    return null;
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
  quote: string;
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

Also give ONE quote: your sharpest single sentence about this company, under 140
characters. It will be published next to your model's name. Be funny if it is
funny, but aim at the positioning, never at people, and never state a company is
failing, fraudulent, or in financial trouble.

Return JSON only:
{"paradigm":int,"nonObviousness":int,"vibeCode":int,"conviction":int,"quote":str}

PAGE TEXT:
${siteText.slice(0, 9_000)}`;
}

function synthPrompt(gate: Gate, takes: JurorTake[], scores: JurorScores, total: number): string {
  const panel = takes
    .map(
      (t) =>
        `${t.modelId} (as the ${t.lens}): paradigm ${t.paradigm}, nonObviousness ${t.nonObviousness}, vibeCode ${t.vibeCode}, conviction ${t.conviction}. Said: "${t.quote}"`,
    )
    .join("\n");

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
  Google, Meta, Amazon or The Trade Desk. Not scored — just noted.`;
}

// ── Provider calls ──────────────────────────────────────────────────────────

async function callGemini(key: string, prompt: string): Promise<string> {
  const res = await fetch(`${GEMINI_ENDPOINT}?key=${key}`, {
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
       */
      max_tokens: 2500,
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
    quote: clampText(o.quote, 180),
    abstained: false,
  };
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

  const domain = normalizeDomain(payload.domain ?? "");
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
  let gate: Gate;
  try {
    let gateRaw: string | null = null;
    if (env.NVIDIA_API_KEY) {
      const model = await resolveNimModel(env.NVIDIA_API_KEY, env.NIM_MODEL);
      if (model) {
        gateRaw = await callOpenAICompatible(NIM_BASE, env.NVIDIA_API_KEY, model, gateInput);
      }
    }
    // Gemini is the fallback classifier, not a second opinion — the gate is a
    // binary decision and one working model is enough to make it.
    if (!gateRaw && env.GEMINI_API_KEY) {
      gateRaw = await callGemini(env.GEMINI_API_KEY, gateInput);
    }
    if (!gateRaw) return json({ error: "The ranking service is not configured." }, 503);
    gate = normalizeGate(extractJson(gateRaw));
  } catch (err) {
    console.error("[rank] gate failed:", err);
    return json({ error: "Could not read that company. Try again shortly." }, 502);
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
  const settled = await Promise.allSettled(
    PANEL.map(async ({ provider, lens }): Promise<JurorTake> => {
      const text = jurorPrompt(lens, gate, site.text, site.blocked);
      if (provider === "gemini") {
        if (!env.GEMINI_API_KEY) throw new Error("no gemini key");
        return normalizeTake(extractJson(await callGemini(env.GEMINI_API_KEY, text)), "gemini", GEMINI_MODEL, lens);
      }
      if (provider === "nvidia") {
        if (!env.NVIDIA_API_KEY) throw new Error("no nvidia key");
        const model = await resolveNimModel(env.NVIDIA_API_KEY, env.NIM_MODEL);
        if (!model) throw new Error("no nim model");
        return normalizeTake(
          extractJson(await callOpenAICompatible(NIM_BASE, env.NVIDIA_API_KEY, model, text)),
          "nvidia",
          model,
          lens,
        );
      }
      if (!env.OPENCODE_API_KEY) throw new Error("no opencode key");
      const model = env.OPENCODE_JUROR_MODEL ?? OPENCODE_JUROR_DEFAULT;
      return normalizeTake(
        extractJson(await callOpenAICompatible(OPENCODE_BASE, env.OPENCODE_API_KEY, model, text)),
        "opencode",
        model,
        lens,
      );
    }),
  );

  const takes: JurorTake[] = settled.map((result, i) => {
    if (result.status === "fulfilled") return result.value;
    console.error(`[rank] juror ${PANEL[i].provider} abstained:`, result.reason);
    return {
      provider: PANEL[i].provider,
      modelId: "—",
      lens: PANEL[i].lens,
      paradigm: 0, nonObviousness: 0, vibeCode: 0, conviction: 0,
      quote: "",
      abstained: true,
    };
  });

  const live = takes.filter((t) => !t.abstained);
  if (live.length === 0) {
    return json({ error: "The whole panel is out. Try again shortly." }, 502);
  }

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
  const synthesizers: { provider: string; run: () => Promise<string> }[] = [
    ...(env.OPENCODE_API_KEY
      ? [{
          provider: "opencode",
          run: () => callOpenAICompatible(
            OPENCODE_BASE, env.OPENCODE_API_KEY as string,
            env.OPENCODE_SYNTH_MODEL ?? OPENCODE_SYNTH_DEFAULT, prompt,
          ),
        }]
      : []),
    ...(env.NVIDIA_API_KEY
      ? [{
          provider: "nvidia",
          run: async () => {
            const model = await resolveNimModel(env.NVIDIA_API_KEY as string, env.NIM_MODEL);
            if (!model) throw new Error("no nim model");
            return callOpenAICompatible(NIM_BASE, env.NVIDIA_API_KEY as string, model, prompt);
          },
        }]
      : []),
    ...(env.GEMINI_API_KEY
      ? [{ provider: "gemini", run: () => callGemini(env.GEMINI_API_KEY as string, prompt) }]
      : []),
  ];

  let verdict = "";
  let splitNote = "";
  let platformNote = "";
  for (const { provider, run } of synthesizers) {
    try {
      const raw = extractJson(await run()) as Record<string, unknown>;
      verdict = clampText(raw.verdict, 900);
      splitNote = clampText(raw.splitNote, 300);
      platformNote = clampText(raw.platformNote, 300);
      if (verdict) {
        // Only worth a line when the preferred writer did not serve it — that
        // is the signal to go and look at the billing.
        if (provider !== "opencode") console.log(`[rank] verdict written by ${provider}`);
        break;
      }
    } catch (err) {
      console.error(`[rank] synthesizer ${provider} failed:`, err);
    }
  }
  // A ranking with scores and quotes but no write-up is still a ranking. Falling
  // back to the sharpest juror line beats refusing to publish.
  if (!verdict) {
    verdict = live.find((t) => t.quote)?.quote ?? "The panel scored this one and left it there.";
  }

  // ── Persist ───────────────────────────────────────────────────────────────
  let slug = slugify(gate.name) || slugify(domain);
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
          `INSERT INTO juror_take (ranking_id, provider, model_id, lens, scores_json, quote, abstained)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          rankingId, t.provider, t.modelId, t.lens,
          t.abstained ? null : JSON.stringify({
            paradigm: t.paradigm, nonObviousness: t.nonObviousness,
            vibeCode: t.vibeCode, conviction: t.conviction,
          }),
          t.quote || null,
          t.abstained ? 1 : 0,
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
        quote: t.quote, abstained: t.abstained,
      })),
    },
    200,
  );
};
