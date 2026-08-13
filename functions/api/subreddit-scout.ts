/**
 * POST /api/subreddit-scout — the Subreddit Scout lead magnet.
 *
 * A visitor gives one thing: their work email. The domain of that address IS the
 * input — we fetch that company's homepage, reduce it to text, and ask a model
 * for a Reddit go-to-market brief: five target subreddits and three portable
 * agent SKILL.md files. That is why free-mail and disposable addresses are
 * refused: gmail.com tells us nothing to research.
 *
 * Ported from a Lovable/TanStack Start prototype. The generation logic
 * (readSite, the system prompt, extractJson, normalizeReport, toSkillFile) came
 * across close to verbatim because it was already framework-agnostic. What was
 * dropped: Supabase, the AI SDK, and a 10-minute report cache. See the abuse
 * note on the origin check below for what replaced the cache's throttling role.
 *
 * Self-contained on purpose. Pages Functions are bundled separately from the
 * Astro build and `functions/api/subscribe.ts` already documents that importing
 * from `src/` is not something to discover at deploy time.
 *
 * Set the secrets before this can succeed:
 *   Cloudflare dashboard → Pages → andorlabs → Settings → Variables and Secrets
 *   GEMINI_API_KEY = <key from aistudio.google.com → Get API key>
 *   LOOPS_API_KEY  = <key from loops.so → Settings → API>
 *
 * Optional:
 *   OPENCODE_API_KEY = <key from opencode.ai/zen> — enables the fallback model
 *                      after Gemini fails twice. Unset is fine; the tool just
 *                      loses its second provider.
 */

interface Env {
  GEMINI_API_KEY?: string;
  LOOPS_API_KEY?: string;
  /**
   * Optional. When set, OpenCode Zen becomes the fallback after Gemini has
   * failed twice. Absent, the tool behaves exactly as before — the fallback is
   * skipped, not fatal.
   */
  OPENCODE_API_KEY?: string;
}

/**
 * Chosen for RATE LIMIT headroom, not for being the newest thing available.
 *
 * This is a public tool with no auth in front of it, so requests-per-hour is
 * the binding constraint, not benchmark scores. Measured on this key:
 *   gemini-3.6-flash       ~5 requests/hour on the free tier — unusable here,
 *                          and 27s per brief
 *   gemini-3.5-flash       503s repeatedly — not viable
 *   gemini-2.5-flash*      404 "no longer available to new users"
 *   gemini-3.5-flash-lite  reliable, 8.3s per brief, lite-tier throughput
 *
 * The job is structured extraction plus tightly-constrained short-form writing
 * against a very prescriptive prompt, with normalizeReport() as a safety net —
 * squarely lite-class work. The 3× latency win is a bonus: it takes the wait
 * from "did this break?" to "that was quick".
 *
 * Verify the id against `GET /v1beta/models` if a call 404s; Google retires
 * point releases and closes older ones to new keys without warning.
 */
const MODEL = "gemini-3.5-flash-lite";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

/**
 * Fallback provider, tried only after Gemini has failed twice.
 *
 * OpenCode Zen is OpenAI-compatible, so this is a second HTTP shape rather than
 * a second SDK. Deliberately a DIFFERENT vendor rather than a second Google
 * model: the failure this covers is "Google is rate-limiting or down", and
 * another Gemini id shares that fate.
 *
 * ⚠️ Structured output is NOT documented for this endpoint, so unlike the Gemini
 * path there is no responseSchema guaranteeing well-formed JSON. `json_object`
 * is requested because it is the widely-implemented OpenAI shape, and
 * extractJson + normalizeReport carry the rest — they were written for exactly
 * this class of sloppiness and predate this fallback. Expect the fallback to be
 * a little less reliable than the primary; a degraded brief beats a 502.
 */
const OPENCODE_MODEL = "deepseek-v4-flash";
const OPENCODE_ENDPOINT = "https://opencode.ai/zen/v1/chat/completions";

/**
 * Response schema, passed to Gemini so the decoder is constrained rather than
 * merely instructed.
 *
 * responseMimeType alone was not enough on the flash-lite tier: roughly one run
 * in three came back with the opening quote missing from a property name
 * (`description": "..."` instead of `"description": "..."`), which no amount of
 * prompt wording fixes and only fragile regex repair could patch after the
 * fact. A schema makes that class of corruption structurally impossible.
 *
 * Field semantics stay in SYSTEM_PROMPT — this only pins the shape.
 */
const STR = { type: "STRING" } as const;
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    businessSummary: STR,
    audience: STR,
    category: STR,
    subreddits: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { name: STR, size: STR, fit: STR, rewards: STR, rules: STR, firstPost: STR },
        required: ["name", "size", "fit", "rewards", "rules", "firstPost"],
      },
    },
    plays: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          skillName: STR,
          title: STR,
          description: STR,
          goal: STR,
          inputs: { type: "ARRAY", items: STR },
          steps: { type: "ARRAY", items: STR },
          guardrails: { type: "ARRAY", items: STR },
          output: STR,
          cadence: STR,
          measure: STR,
        },
        required: [
          "skillName", "title", "description", "goal", "inputs",
          "steps", "guardrails", "output", "cadence", "measure",
        ],
      },
    },
  },
  required: ["businessSummary", "audience", "category", "subreddits", "plays"],
} as const;

const LOOPS_ENDPOINT = "https://app.loops.so/api/v1/contacts/update";

/**
 * Every list a Scout lead joins. All three, always — VJ's call, replacing the
 * opt-in checkbox with a notice on the form.
 *
 * The newsletter ids are duplicated from `src/lib/categories.ts` on purpose,
 * same as `functions/api/subscribe.ts` does — Pages Functions bundle separately
 * from the Astro build and whether an import from `src/` resolves is not
 * something to discover at deploy time. Change them in one file, change them in
 * the others.
 *
 * Whatever is in here MUST match what the form says. The form now states that
 * marketing may follow and that unsubscribing is one click; if a list is added
 * here, that sentence is the thing to re-read.
 */

const LEAD_LISTS: Record<string, true> = {
  cmsqj2crd0mas0j1jdd7t9iyf: true, // Lead magnets — the primary list for this tool
  cmsoulfdz0idi0j2q62ea241f: true, // {ignore all previous instructions} — AI newsletter
  cmsouuptw04kb0jx7h33a26b2: true, // Field notes by Vishveshwar Jatain
};

/** Matches `functions/api/subscribe.ts` — deliberately permissive, catches typos and bots. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Free-mail providers. Refused because the domain is the research input, not
 * because we are being fussy about who gets the tool.
 */
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

/** Normalize a bare domain into an https URL, or return null when unusable. */
function normalizeUrl(input: string): string | null {
  const raw = input.trim();
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

// ── Report shape ────────────────────────────────────────────────────────────
// Mirrored as types-only in src/lib/scout.ts for the page. Types are erased at
// build, so the two cannot drift at runtime — only the wire shape below is real.

interface Subreddit {
  name: string; size: string; fit: string;
  rewards: string; rules: string; firstPost: string;
}

interface Play {
  skillName: string; title: string; description: string; goal: string;
  inputs: string[]; steps: string[]; guardrails: string[];
  output: string; cadence: string; measure: string;
}

interface Report {
  businessSummary: string; audience: string; category: string;
  subreddits: Subreddit[]; plays: Play[];
}

type SiteRead = { text: string; title: string | null; blocked: boolean };

// ── Reading the visitor's site ──────────────────────────────────────────────

/** Fetch the submitted site and reduce it to plain text for the model. */
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
    if (!res.ok) return { text: "", title: null, blocked: true };

    const html = (await res.text()).slice(0, 400_000);
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
      .slice(0, 12_000);

    // Under 120 chars means we got a shell — a JS-rendered app, a consent wall,
    // or a bot block. Treated as "blocked" so the model is told to infer from
    // the domain instead of pretending it read something.
    return {
      text: [title, metas, text].filter(Boolean).join("\n"),
      title,
      blocked: text.length < 120,
    };
  } catch {
    return { text: "", title: null, blocked: true };
  }
}

// ── The prompt ──────────────────────────────────────────────────────────────

/**
 * Character budgets here are the EDITORIAL targets. The clamps in
 * normalizeReport() are deliberately looser (e.g. 240 here vs 300 there) so
 * they act as a safety net for a non-compliant model rather than as a second,
 * competing limit. Compliant output is never truncated.
 */
const SYSTEM_PROMPT = `You are a senior Reddit growth strategist at And/or Labs, a full-stack GTM studio.
You produce a practical Reddit go-to-market brief for one specific business.

Hard rules:
- businessSummary is a COMPANY BRIEF: what the business does, who it is for, and what makes it credible. Two or three sentences. Do NOT enumerate the offer menu — no product/service names with prices, no packages, no tiers, no "offerings include". Pricing is the reader's own page; repeating it back at them is filler, not insight.
- Only name real, well-known, currently active subreddits. Write them as "r/name". Never invent one.
- Subscriber size must be an approximate range (e.g. "~1.2M members", "~40k members"). Never claim precision.
- Every subreddit must plausibly contain this business's buyers or practitioners. AT MOST TWO may be over 500k members, and AT LEAST THREE must be under 200k. r/Entrepreneur, r/smallbusiness, r/business and r/marketing are almost never the right answer — they are where generic advice goes to die, and naming them signals you did not look hard. Find the narrow subreddit where this specific buyer actually posts.
- Rules text must reflect how self-promotion actually works there (promo threads, 9:1 rule, karma/age gates, no links in comments, flair requirements, weekly megathreads).
- Each play is a PLATFORM-AGNOSTIC AGENT SKILL FILE (a SKILL.md-style instruction set) that the reader can drop into any coding/agent harness — Claude Code, Codex, Hermes, Cursor, OpenCode, or a plain LLM chat. Write the steps as instructions addressed to the agent ("Research…", "Draft…", "Report back with…").
- Never name a specific SaaS automation vendor (no Zapier, Make, n8n, Airtable, GummySearch, Lovable, Slack, Notion). Refer only to generic, universally available capabilities: web search/browsing, the public Reddit site or API, a spreadsheet or CSV, a local file, the Reddit Ads dashboard.
- Plays must be legitimate, human-in-the-loop: the agent researches, monitors and drafts; a real human reviews and posts or publishes from a real account. Never describe fake accounts, vote manipulation, evading bans, spinning content to dodge filters, or fully automated posting.
- Exactly one of the three plays must be about running a paid Reddit ad campaign (Reddit Ads: campaign objective, subreddit/interest/keyword targeting, budget and bid, creative variants, comment moderation on the promoted post, and reading results). Its skillName must be "reddit-ad-campaign".
- Every play has exactly 2 guardrails, each one sentence that merges the essentials: (a) human approval before anything is posted or spent, plus value-to-promo ratio and account age/karma warm-up; (b) how to avoid the link and repetition patterns AutoModerator flags (for the ads play, disclosure and comment moderation instead).
- skillName is kebab-case, 2-4 words, no spaces. description is one line in the style "Does X. Use when Y." inputs are the things the human must supply before running (accounts, budget, links, brand facts). output is the reviewable artifact the agent hands back.
- Be specific to this business. No generic filler. No markdown, no emojis. Keep each field tight and readable.

Writing the steps — these are the difference between a usable skill file and a memo:
- Every step must be an instruction the agent can act on, and must name the artifact or decision it produces. "Analyse weekly performance including CTR, CPC and conversions" is a list of metric names, not a step. "Pull last week's campaign metrics and report the two ad variants with the worst cost-per-click, with a recommended bid change for each" is a step.
- No step may be pure analysis with no stated output. If a step examines something, say what it hands back.
- Steps run in order and may refer to what an earlier step produced. Do not write five independent suggestions.
- Every input must be something a human can paste or attach in a chat: a URL, a number, a block of copy, a file, a budget cap. Never ask for credentials, account passwords, API keys, or dashboard logins — the human operates those, not the agent.

Length discipline (enforce yourself): businessSummary <= 320 characters; audience and category <= 120 characters; each subreddit field <= 400 characters; description <= 180 characters; each play step <= 240 characters; EXACTLY 5 steps per play; EXACTLY 3 inputs per play; EXACTLY 2 guardrails per play; output <= 240 characters.
Return exactly 5 subreddits and exactly 3 plays.

Reply with ONE JSON object and nothing else. Use these exact keys, exactly as spelled here — do not rename, add or omit any key:
{
  "businessSummary": string,
  "audience": string,
  "category": string,
  "subreddits": [
    { "name": string, "size": string, "fit": string, "rewards": string, "rules": string, "firstPost": string }
  ],
  "plays": [
    { "skillName": string, "title": string, "description": string, "goal": string, "inputs": [string], "steps": [string], "guardrails": [string], "output": string, "cadence": string, "measure": string }
  ]
}
Field meanings: businessSummary = the company brief, never the price list; size = approximate member count; fit = why this subreddit fits this business; rewards = what the community upvotes and respects; rules = the self-promotion rules and automod behaviour to respect; firstPost = a concrete first-post or first-comment angle. For plays: skillName = kebab-case skill file name; description = the one-line trigger description; inputs = what the human supplies; steps = the ordered agent instructions; output = the reviewable artifact; cadence = how often to run the skill; measure = the metrics that prove it works.`;

// ── Normalising the model's reply ───────────────────────────────────────────

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug || "reddit-play";
}

/**
 * Truncate to `max`, breaking at a word boundary.
 *
 * The original sliced blind, so an over-long field landed in a downloadable
 * .md file cut mid-word ("…campaign perfor…"). Backing up to the last space
 * costs nothing and only ever fires when the model has already ignored its
 * stated budget. If there is no space in the last quarter of the slice (one
 * very long token), fall back to the hard cut rather than gutting the text.
 */
function clampText(value: unknown, max: number, fallback = "") {
  const trimmed = typeof value === "string" ? value.trim() : "";
  const text = trimmed || fallback;
  if (text.length <= max) return text;

  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const body = lastSpace > max * 0.75 ? cut.slice(0, lastSpace) : cut;
  return `${body.trimEnd()}…`;
}

/** First key that carries a usable value. Models rename fields more than you'd hope. */
function pick(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value;
    if (Array.isArray(value) && value.length) return value;
  }
  return undefined;
}

function toStringList(value: unknown, max: number, cap: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .slice(0, cap)
    .map((v) => clampText(v, max));
}

/**
 * Models occasionally rename keys; map the common variants before use.
 *
 * Every field is constructed through clampText with a fallback and every array
 * is sliced to a fixed length, so the returned object's shape is guaranteed
 * here rather than asserted afterwards. The prototype ran a final zod parse
 * over this; it was belt-and-braces over code that already cannot emit a
 * different shape, and this repo carries no backend dependencies.
 */
function normalizeReport(raw: unknown): Report {
  const root = (raw ?? {}) as Record<string, unknown>;
  const subredditsRaw = Array.isArray(root["subreddits"]) ? (root["subreddits"] as unknown[]) : [];
  const playsRaw = Array.isArray(root["plays"]) ? (root["plays"] as unknown[]) : [];

  const subreddits = subredditsRaw.slice(0, 5).map((item) => {
    const s = (item ?? {}) as Record<string, unknown>;
    const rawName = clampText(pick(s, ["name", "subreddit", "title"]), 60, "r/unknown");
    return {
      name: clampText(rawName.startsWith("r/") ? rawName : `r/${rawName.replace(/^\/?r\//, "")}`, 60),
      size: clampText(pick(s, ["size", "subscriberCount", "members", "subscribers"]), 60, "size unknown"),
      fit: clampText(pick(s, ["fit", "whyItFits", "why", "reason"]), 500, "—"),
      rewards: clampText(
        pick(s, ["rewards", "whatItRewards", "communityRewards", "whatTheCommunityRewards"]),
        500,
        "Value-first, experience-led posts that answer a real question.",
      ),
      rules: clampText(pick(s, ["rules", "rulesToRespect", "selfPromoRules", "automodRules"]), 500, "—"),
      firstPost: clampText(
        pick(s, ["firstPost", "firstPostAngle", "postAngle", "angle", "firstMove"]),
        500,
        "Open with a specific lesson from your own work, no links.",
      ),
    };
  });

  const plays = playsRaw.slice(0, 3).map((item) => {
    const p = (item ?? {}) as Record<string, unknown>;
    const title = clampText(pick(p, ["title", "name", "play"]), 120, "Play");
    return {
      skillName: slugify(clampText(pick(p, ["skillName", "slug", "fileName", "skill"]), 60, title)),
      title,
      description: clampText(
        pick(p, ["description", "summary", "when", "trigger"]),
        220,
        "Reddit growth skill for an AI coding agent. Use when preparing Reddit activity for this brand.",
      ),
      goal: clampText(pick(p, ["goal", "objective", "outcome"]), 300, "—"),
      inputs: toStringList(pick(p, ["inputs", "requires", "prerequisites", "context"]), 200, 3),
      steps: toStringList(pick(p, ["steps", "instructions", "setup", "setupSteps", "howTo"]), 300, 5),
      guardrails: toStringList(pick(p, ["guardrails", "safeguards", "automodGuardrails"]), 280, 2),
      output: clampText(
        pick(p, ["output", "deliverable", "artifact"]),
        280,
        "A draft for human review before anything is posted.",
      ),
      cadence: clampText(pick(p, ["cadence", "frequency", "rhythm"]), 240, "—"),
      measure: clampText(pick(p, ["measure", "metrics", "whatToMeasure", "kpis"]), 240, "—"),
    };
  });

  return {
    businessSummary: clampText(pick(root, ["businessSummary", "summary", "business"]), 700, "—"),
    audience: clampText(pick(root, ["audience", "primaryAudience", "icp", "buyers"]), 200, "—"),
    category: clampText(pick(root, ["category", "vertical", "industry"]), 200, "—"),
    subreddits,
    plays,
  };
}

/**
 * Models wrap JSON in prose or fences more often than they should.
 *
 * Even with responseMimeType: application/json, the flash-lite tier emits a
 * trailing comma before a closing brace or bracket roughly one run in three —
 * observed as `SyntaxError: Expected double-quoted property name`. That is a
 * deterministic, safe thing to repair, so repair it rather than spending a
 * whole retry on a stray character.
 */
function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  const candidate = (fenced ?? text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Model returned no JSON object");
  const body = candidate.slice(start, end + 1);
  try {
    return JSON.parse(body);
  } catch {
    // Only touches commas that sit immediately before a closer, so it cannot
    // alter any string content.
    return JSON.parse(body.replace(/,(\s*[}\]])/g, "$1"));
  }
}

// ── The deliverable ─────────────────────────────────────────────────────────

/**
 * Render a play as a platform-agnostic SKILL.md file body.
 *
 * Frontmatter stays minimal (name + description) on purpose: the file has to
 * drop into Claude Code, Codex, Cursor or a plain chat unmodified, and every
 * extra key is one more thing a harness might choke on.
 */
function toSkillFile(play: Play, report: Report, url: string, generatedOn: string) {
  const host = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const subs = report.subreddits.map((s) => `${s.name} (${s.size})`).join(", ");
  const lines = [
    "---",
    `name: ${play.skillName}`,
    `description: ${play.description}`,
    "---",
    "",
    `# ${play.title}`,
    "",
    "## Context",
    `- Brand site: ${host}`,
    `- What they sell: ${report.businessSummary}`,
    `- Audience: ${report.audience}`,
    `- Target subreddits: ${subs}`,
    // Subreddit sizes and rules drift, and this file will outlive the session
    // it was generated in. Dating it lets a reader judge staleness themselves.
    `- Brief generated: ${generatedOn} by Subreddit Scout (andorlabs.ca)`,
    "",
    // The per-subreddit rules used to be shown on the results page and nowhere
    // else, which had it backwards: the reader skims those five paragraphs once,
    // while the AGENT drafting a post needs them every single run. An agent that
    // does not know r/startups gates link posts on karma will cheerfully draft
    // one that gets removed.
    "## House rules per subreddit (respect these when drafting)",
    ...report.subreddits.map((s) => `- ${s.name}: ${s.rules}`),
    "",
    "## Goal",
    play.goal,
    "",
    "## Inputs the human provides",
    ...play.inputs.map((i) => `- ${i}`),
    "",
    "## Procedure",
    ...play.steps.map((s, i) => `${i + 1}. ${s}`),
    "",
    "## Guardrails (never skip)",
    ...play.guardrails.map((g) => `- ${g}`),
    // Nothing else in the file tells the agent what to do when a step fails,
    // and the default failure mode of an agent mid-procedure is to invent a
    // plausible result and carry on.
    "- If a step cannot be completed — a subreddit is gone, a rule has changed, an input is missing — stop and report back. Do not guess and do not substitute.",
    "",
    "## Output",
    play.output,
    "",
    "## Cadence",
    play.cadence,
    "",
    "## Success metrics",
    play.measure,
    "",
    "Works with any agent harness (Claude Code, Codex, Hermes, Cursor, or a plain chat model).",
    "Prepared by And/or Labs — https://andorlabs.ca",
  ];
  return lines.join("\n");
}

// ── Lead capture ────────────────────────────────────────────────────────────

/**
 * Push the captured lead into Loops. Never throws, never blocks the report.
 *
 * Upsert (`/contacts/update`), not create, because a repeat visitor running a
 * second brief is expected and should not be a 409. Note `subscribe.ts` uses
 * `/contacts/create` — different endpoint, different intent.
 */
async function syncLeadToLoops(
  apiKey: string,
  input: { email: string; websiteUrl: string },
): Promise<void> {
  try {
    const res = await fetch(LOOPS_ENDPOINT, {
      method: "PUT",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        email: input.email,
        subscribed: true,
        source: "Subreddit Scout",
        userGroup: "reddit-brief-leads",
        companyDomain: emailDomain(input.email),
        websiteUrl: input.websiteUrl,
        mailingLists: LEAD_LISTS,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[scout] Loops ${res.status}:`, detail.slice(0, 500));
    }
  } catch (err) {
    console.error("[scout] Loops unreachable:", err);
  }
}

// ── Handler ─────────────────────────────────────────────────────────────────

/**
 * Is this a local development origin?
 *
 * `astro dev` serves the page (with the dev-only Agentation and CopyDiffer
 * islands) while `wrangler pages dev` serves this Function on another port, so
 * a dev request legitimately arrives with a different Origin than the URL it
 * hit. Rewriting the header in Vite's proxy proved unreliable, so the check
 * lives here where it can be read and reasoned about.
 *
 * This does NOT weaken production. The origin check exists to stop a malicious
 * page using a visitor's browser to spend our inference quota, and browsers set
 * Origin themselves — a page on evil.com cannot claim to be localhost. Anything
 * that can forge the header (curl, a script) could equally forge the real
 * origin, so no defence is lost.
 */
function isLocalOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".localhost");
  } catch {
    return false;
  }
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Same-origin only; no CORS headers on purpose.
      "cache-control": "no-store",
    },
  });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  /**
   * Same-origin check.
   *
   * The prototype ran on TanStack Start, which supplied CSRF middleware for
   * free; that protection vanishes in the port. It matters more here than on
   * /api/subscribe because every call to this endpoint spends money on
   * inference. Comparing against the request's own origin rather than a
   * hardcoded domain keeps preview deployments and `wrangler pages dev`
   * working without a second allowlist to maintain.
   *
   * This is not the whole abuse story — pair it with a Cloudflare Rate
   * Limiting rule on this path (suggested: 5 requests / 10 min / IP), which
   * replaces the per-email cache the dropped Supabase table used to provide.
   */
  const origin = request.headers.get("Origin");
  if (!origin || !(origin === new URL(request.url).origin || isLocalOrigin(origin))) {
    return json({ error: "Bad request." }, 403);
  }

  let payload: { email?: unknown };
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Malformed request." }, 400);
  }

  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return json({ error: "That doesn't look like an email address." }, 400);
  }

  const domain = emailDomain(email);
  if (FREE_EMAIL_DOMAINS.has(domain)) {
    return json(
      { error: "We research the site behind your email, so a personal address gives us nothing to read. Use your work email." },
      400,
    );
  }
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return json({ error: "That's a disposable address. Use your work email." }, 400);
  }

  const url = normalizeUrl(domain);
  if (!url) {
    return json({ error: "We couldn't read a company website from that email." }, 400);
  }

  // Missing key is an operator error, not a visitor error. Log it for the Pages
  // tail; never tell the browser which piece of config is absent.
  if (!env.GEMINI_API_KEY) {
    console.error("[scout] GEMINI_API_KEY is not set — brief dropped for:", email);
    return json({ error: "The scout is briefly unavailable. Try again shortly." }, 503);
  }
  // Bound to a const because the guard above narrows `env.GEMINI_API_KEY` here
  // but not inside the askGemini closure, where it widens back to
  // `string | undefined` and fails to satisfy HeadersInit.
  const geminiKey = env.GEMINI_API_KEY;

  // Capture the lead BEFORE generating, not after.
  //
  // This used to sit below the `if (!report) return 502` bail-out, which meant a
  // Gemini failure threw the lead away too: the visitor handed over a work email,
  // got an error, and we kept nothing. That is exactly backwards — the moments
  // the model is flaky are the moments the lead matters most, because it is the
  // only way to follow up on a brief that never arrived.
  //
  // They submitted and consented at this point; whether the model then succeeds
  // is our problem, not a reason to discard them.
  if (env.LOOPS_API_KEY) {
    await syncLeadToLoops(env.LOOPS_API_KEY, { email, websiteUrl: url });
  } else {
    console.error("[scout] LOOPS_API_KEY is not set — lead not captured:", email);
  }

  const site = await readSite(url);

  const userPrompt = site.blocked
    ? `Website: ${url} (domain: ${domain}). The site could not be read automatically${
        site.title ? `, but its page title is: "${site.title}"` : ""
      }. Infer what the business most likely does from the domain name and any title above, and say in businessSummary that this was inferred from limited information. Then produce the brief.`
    : `Website: ${url} (domain: ${domain}).\n\nExtracted page content:\n"""\n${site.text}\n"""\n\nFirst work out what this business sells, who buys it, and its category. Then produce the brief.`;

  /** One call to Gemini. Returns the completion text, or throws. */
  const askGemini = async (): Promise<string> => {
    const res = await fetch(GEMINI_ENDPOINT, {
      method: "POST",
      headers: {
        // Header rather than ?key=, so the secret never lands in a URL that
        // some proxy or access log along the way would happily record.
        "x-goog-api-key": geminiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: {
          // JSON mode. The prompt already demands one JSON object, but asking
          // the API to enforce it removes the most common failure — a helpful
          // sentence wrapped around the payload. extractJson and
          // normalizeReport stay as the net for everything else.
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          // The brief should be specific, not inventive. Subreddit names are
          // recalled facts and this is the knob that governs how freely the
          // model embellishes them.
          temperature: 0.4,
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Gemini ${res.status}: ${detail.slice(0, 300)}`);
    }

    const body = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      promptFeedback?: { blockReason?: string };
    };

    // A safety block returns 200 with no usable candidate, so it has to be
    // caught by inspection rather than by status code.
    const blocked = body.promptFeedback?.blockReason ?? body.candidates?.[0]?.finishReason;
    if (blocked && blocked !== "STOP") throw new Error(`Generation stopped: ${blocked}`);

    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text) throw new Error("Empty completion");
    return text;
  };

  /** One call to OpenCode Zen. Returns the completion text, or throws. */
  const askOpenCode = async (key: string): Promise<string> => {
    const res = await fetch(OPENCODE_ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: OPENCODE_MODEL,
        // Same system/user split as the Gemini call, expressed the OpenAI way,
        // so both providers are held to the identical prompt. If the two drift,
        // the fallback silently starts producing a different brief.
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.4,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`OpenCode ${res.status}: ${detail.slice(0, 300)}`);
    }

    const body = (await res.json()) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[];
    };
    const choice = body.choices?.[0];
    // A length-truncated completion is not a brief, it is half a brief that will
    // fail extractJson in a confusing way. Name it here instead.
    if (choice?.finish_reason === "length") throw new Error("Completion truncated");
    const text = choice?.message?.content ?? "";
    if (!text) throw new Error("Empty completion");
    return text;
  };

  /**
   * Two attempts.
   *
   * Malformed JSON from the flash-lite tier is intermittent rather than
   * systematic — the same prompt succeeds on a retry — so a second call is the
   * difference between a working tool and one that fails for a third of
   * visitors. At ~8s a call this is affordable in a way it would not have been
   * on a 27s model. Deliberately not a loop over N: if two consecutive attempts
   * fail, something is actually wrong and burning more quota will not fix it.
   */
  /**
   * Gemini twice, then OpenCode once.
   *
   * Two Gemini attempts because malformed JSON on the flash-lite tier is
   * intermittent rather than systematic — the same prompt succeeds on a retry.
   * The third attempt changes VENDOR rather than retrying the same one again,
   * because by then the likely cause is Google-side (quota, 5xx) and a third
   * Gemini call would just fail the same way.
   *
   * Skipped entirely when OPENCODE_API_KEY is unset, which is the default.
   */
  const attempts: { provider: string; run: () => Promise<string> }[] = [
    { provider: "gemini", run: askGemini },
    { provider: "gemini", run: askGemini },
    ...(env.OPENCODE_API_KEY
      ? [{ provider: "opencode", run: () => askOpenCode(env.OPENCODE_API_KEY as string) }]
      : []),
  ];

  let report: Report | undefined;
  for (let i = 0; i < attempts.length && !report; i += 1) {
    const { provider, run } = attempts[i];
    try {
      report = normalizeReport(extractJson(await run()));
      // Only worth a line when the primary did not serve it — that is the
      // signal that Gemini is having a bad day, and it is the only way to
      // notice from the logs that the fallback is carrying traffic.
      if (i > 0) console.log(`[scout] served by ${provider} on attempt ${i + 1}`);
    } catch (err) {
      console.error(`[scout] attempt ${i + 1}/${attempts.length} (${provider}) failed:`, err);
    }
  }

  if (!report) {
    return json({ error: "We couldn't finish the research just now. Try again in a moment." }, 502);
  }

  // Rendered here rather than in the browser so toSkillFile lives in exactly
  // one place; the page only needs to wrap each body in a Blob.
  const generatedOn = new Date().toISOString().slice(0, 10);
  const skillFiles = report.plays.map((play) => ({
    filename: `${play.skillName}.SKILL.md`,
    body: toSkillFile(play, report, url, generatedOn),
  }));

  return json({ ok: true, report, url, partial: site.blocked, skillFiles }, 200);
};
