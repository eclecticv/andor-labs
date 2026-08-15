/**
 * Talking to model providers.
 *
 * Extracted from the handler so the pipeline reads as pipeline. Everything here
 * is about REACHING a model and getting parseable JSON back; nothing here knows
 * what a ranking is.
 *
 * The one idea worth keeping in mind: every provider is a LADDER, and a rung
 * counts as failed if it returns something unusable, not merely if the HTTP
 * call errors. A model that answers 200 with "..." has failed.
 */

export interface ProviderEnv {
  GEMINI_API_KEY?: string;
  NVIDIA_API_KEY?: string;
  OPENCODE_API_KEY?: string;
  NIM_MODEL?: string;
}

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
 * 3.5 leads, and the newer models sit below it.
 *
 * Which is backwards from how a ladder normally reads, and is measured rather
 * than assumed: 3.7 has 503'd on every call since it appeared, and as of
 * 2026-08-15 so does 3.6. Leading with them bought nothing and cost TWO wasted
 * round trips on every Gemini call — and this pipeline makes two of those per
 * ranking, so it was four dead calls per company.
 *
 * They stay on the ladder rather than being deleted, because a 503 is a
 * capacity signal and capacity comes back. When it does, this order should be
 * reverted — the comment is here so the next person knows it was deliberate and
 * what would justify undoing it.
 */
const GEMINI_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.7-flash",
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
  // The 49B leads the 120B: the larger model reasons at length before
  // answering and, now that a single call has to produce four reasonings, four
  // improvement lines and a verdict, it routinely runs out of budget and fails
  // the usability check. A rung that costs a wasted minute is worth less than
  // one that answers.
  "nvidia/llama-3.3-nemotron-super-49b-v1.5",
  "nvidia/nemotron-3-super-120b-a12b",
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
export async function nimCandidates(key: string, override?: string): Promise<string[]> {
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


/**
 * Temperature 0 everywhere by default.
 *
 * The board asks a company to accept a public number, so re-running a ranking
 * has to land in roughly the same place or the number means nothing. Sampling
 * at 0.7 was right when the output was a one-off verdict for entertainment; it
 * is wrong now that the output is a rank other companies are sorted against.
 *
 * Worth being clear about what this does and does not buy: temperature 0 makes
 * the SAMPLING deterministic, not the scoring. Two runs can still differ if the
 * provider silently updates a model, or if the ladder seats a different rung.
 * The heavier lever is in the prompt — anchored scales, so the model classifies
 * against fixed definitions instead of inventing a scale each time.
 */
const DEFAULT_TEMPERATURE = 0;

/**
 * No model call may hang forever.
 *
 * The ladder's entire premise is that it moves on when a rung fails — but a
 * provider that accepts the connection and then goes quiet never fails, so the
 * ladder never advances and the ranking stops dead. Observed locally: one call
 * held a run for over ten minutes without erroring, and it would have held it
 * indefinitely.
 *
 * In production the shape is worse than slow. The Function would keep its
 * request open until Cloudflare kills it, so the visitor gets a dropped
 * connection rather than the designed failure card — the one outcome this
 * pipeline is built to avoid.
 *
 * 75 seconds is generous for a reasoning model writing three summaries (the
 * slowest legitimate call measured was ~50s) and short enough that all three
 * rungs of a ladder can still be tried inside a request.
 */
const CALL_TIMEOUT_MS = 75_000;

/**
 * Fetch with a deadline, reporting a timeout as a timeout.
 *
 * The distinction matters in the ladder's failure log: "timed out" tells you a
 * provider is degraded, where a bare "network error" reads as a blip and gets
 * ignored.
 */
async function fetchWithDeadline(url: string, init: RequestInit, label: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`${label} timed out after ${CALL_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function callGemini(
  key: string,
  model: string,
  prompt: string,
  temperature = DEFAULT_TEMPERATURE,
): Promise<string> {
  const res = await fetchWithDeadline(`${geminiEndpoint(model)}?key=${key}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature, responseMimeType: "application/json" },
    }),
  }, model);
  if (!res.ok) throw new Error(`gemini ${res.status}`);
  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = body.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text) throw new Error("gemini empty");
  return text;
}

/** NIM and OpenCode Zen are both OpenAI-compatible, so they share one caller. */
export async function callOpenAICompatible(
  base: string,
  key: string,
  model: string,
  prompt: string,
  temperature = DEFAULT_TEMPERATURE,
): Promise<string> {
  const res = await fetchWithDeadline(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature,
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
       * full round trip before the ladder moved on.
       *
       * And again to 8000 when the panel prompt grew a category vote and a
       * funding question. deepseek-v4-pro began failing "truncated before
       * answering" on EVERY call, so its seat was silently standing down and
       * Qwen was answering in its place — the declared panel was not the panel
       * that turned up. Each of those cost two dead calls before the ladder
       * found someone, so the headroom buys throughput as well as correctness.
       */
      max_tokens: 8000,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }),
  }, model);
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


export type Provider = "gemini" | "nvidia" | "opencode";

/** The ordered candidates for a provider, reconciled with what it really has. */
export async function modelsFor(provider: Provider, env: ProviderEnv): Promise<string[]> {
  if (provider === "gemini") return GEMINI_MODELS;
  if (provider === "opencode") return OPENCODE_JUROR_MODELS;
  return env.NVIDIA_API_KEY ? nimCandidates(env.NVIDIA_API_KEY, env.NIM_MODEL) : [];
}

export function keyFor(provider: Provider, env: ProviderEnv): string | undefined {
  return provider === "gemini"
    ? env.GEMINI_API_KEY
    : provider === "nvidia"
      ? env.NVIDIA_API_KEY
      : env.OPENCODE_API_KEY;
}

export async function askOnce(
  provider: Provider,
  key: string,
  model: string,
  prompt: string,
  temperature = DEFAULT_TEMPERATURE,
) {
  if (provider === "gemini") return callGemini(key, model, prompt, temperature);
  return callOpenAICompatible(
    provider === "nvidia" ? NIM_BASE : OPENCODE_BASE,
    key,
    model,
    prompt,
    temperature,
  );
}

export interface LadderOptions {
  /**
   * Put this model at the top of the ladder if the provider has it.
   *
   * The panel names its members on the page, with their published architecture
   * next to them. If the ladder seated whichever model it happened to prefer,
   * those bios would describe a model that did not answer — so a panelist's
   * declared model leads its own ladder, and the seat records what actually
   * answered so a fallback is visible rather than silent.
   */
  preferred?: string;
  temperature?: number;
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
export async function askLadder<T>(
  provider: Provider,
  env: ProviderEnv,
  prompt: string,
  accept: (text: string, model: string) => T,
  options: LadderOptions = {},
): Promise<{ model: string; value: T }> {
  const key = keyFor(provider, env);
  if (!key) throw new Error(`${provider}: no key configured`);

  const available = await modelsFor(provider, env);
  if (!available.length) throw new Error(`${provider}: no candidate models`);

  // The preferred model leads, and the rest of the ladder stays intact beneath
  // it as fallback. It is inserted even when the catalogue call did not report
  // it: a /models listing that omits a model we know answers is a worse guide
  // than simply trying it and letting the rung fail.
  const models = options.preferred
    ? [options.preferred, ...available.filter((m) => m !== options.preferred)]
    : available;

  const failures: string[] = [];
  for (const model of models) {
    try {
      const value = accept(
        await askOnce(provider, key, model, prompt, options.temperature),
        model,
      );
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

/** Clamp a model's integer to a range; junk becomes 0, never NaN. */
export const clampInt = (value: unknown, max: number): number => {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, Math.round(n)));
};

/** Trim a model's string to a ceiling, marking the cut so it does not read as a bug. */
export const clampText = (value: unknown, max: number, fallback = ""): string => {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) return fallback;
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
};
