/**
 * Rank My AdTech — the ranking pipeline.
 *
 * Someone submits a company URL. We read four or five of its pages, work out
 * what the company is and where it sits, then put it in front of three models
 * from three different labs and have a fourth write up what they said.
 *
 * The shape, in order, and why each step sits where it does:
 *
 *   crawl     Four or five pages, not one. A homepage is written to impress, so
 *             judging from it alone measures copywriting. The about, pricing,
 *             careers and blog pages are where a company accidentally tells you
 *             the truth.
 *   identify  One cheap call: is this adtech, what is it called, which
 *             subcategory. Deliberately separate from judging — a model that
 *             has just decided a company is unimpressive should not also be
 *             choosing which cohort it competes in.
 *   place     Public companies refused outright. Band read from structural
 *             evidence (an announced round, an accelerator batch) and never
 *             from tone; side derived from subcategory by lookup, so the two
 *             can never contradict each other.
 *   panel     THREE model calls, in parallel, to three labs. Each answers all
 *             three questions against anchored 0-10 scales. The parallelism is
 *             the isolation: they cannot see each other by construction.
 *   write     A fourth model, from a fourth family, reads all nine answers and
 *             writes the paragraph. It scores nothing, which is what lets it
 *             report a split honestly rather than defend a number.
 *
 * Three rules carried over, all learned the hard way: totals are arithmetic in
 * code and never asked of a model; a provider is a LADDER whose rung fails on an
 * unusable answer rather than merely on an HTTP error; and a ranking publishes
 * complete or not at all.
 *
 * Required environment:
 *   RANKINGS         D1 binding, configured on the Pages project itself rather
 *                    than in a wrangler config file — Pages does not support
 *                    partial configuration, so a root wrangler.toml would take
 *                    over the namespace holding this project's secrets.
 *   GEMINI_API_KEY / NVIDIA_API_KEY / OPENCODE_API_KEY   one per panel seat,
 *                    and all three are required: the panel refuses to sit short.
 *   LOOPS_API_KEY    optional; only used when a submission carries an email
 *   DEPLOY_HOOK_URL  the board is static, so a ranking is invisible until a
 *                    build runs
 */

import { readSite } from "../_lib/crawl";
import { detectStack, byCategory } from "../_lib/stack";
import { lookupCompany, lookupPress, divisionFor, ageOf, type FactsEnv } from "../_lib/facts";
import { resolveLogo } from "../_lib/logo";

import {
  buildIdentifyPrompt, normalizeIdentity, assertIdentityUsable,
  place, placeFromMarkup, sideFor, cohortLabel, categoryLabel, categoryFor,
  CATEGORIES, CATEGORY_NOT, BAND_LABELS, SIDE_LABELS,
} from "../_lib/classify";
import { runPanel, resolveRecall, QUESTIONS, WRITER, PANELISTS } from "../_lib/panel";
import { buildWriterPrompt, normalizeSummary, assertSummaryUsable } from "../_lib/writer";
import { askLadder, extractJson, keyFor, type Provider } from "../_lib/providers";

interface Env {
  RANKINGS: D1Database;
  /** Optional. Absent, the jurors work from the site alone. */
  EXA_API_KEY?: string;
  /** Optional. Absent, the panel is asked to recall funding as it used to. */
  INDEXED_API_KEY?: string;
  GEMINI_API_KEY?: string;
  NVIDIA_API_KEY?: string;
  OPENCODE_API_KEY?: string;
  CONTEXT_DEV_API_KEY?: string;
  LOOPS_API_KEY?: string;
  DEPLOY_HOOK_URL?: string;
  NIM_MODEL?: string;
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
        email, source: "Rank My AdTech", userGroup: "Lead magnet",
        rankedDomain: domain, mailingLists: LEAD_LISTS,
      }),
    });
  } catch (err) {
    // A dead CRM must never cost the visitor their ranking.
    console.error("[rank] loops sync failed:", err);
  }
}

// ── Input ───────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.ca", "yahoo.co.uk",
  "hotmail.com", "hotmail.ca", "hotmail.co.uk", "outlook.com", "live.com",
  "msn.com", "aol.com", "icloud.com", "me.com", "mac.com", "proton.me",
  "protonmail.com", "gmx.com", "gmx.de", "mail.com", "mail.ru", "yandex.com",
  "yandex.ru", "zoho.com", "qq.com", "163.com", "126.com", "naver.com",
]);

const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com",
  "temp-mail.org", "yopmail.com", "trashmail.com", "sharklasers.com",
  "getnada.com", "dispostable.com", "throwawaymail.com", "maildrop.cc",
]);

export const emailDomain = (email: string) => email.split("@")[1]?.trim().toLowerCase() ?? "";

/** Reduce a submitted URL to its bare host, or null when it is not one. */
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

export function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

/**
 * Hash rather than store the address. Rate limiting needs to know two requests
 * shared an origin, which does not require knowing where that origin is.
 */
async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(`rank-my-adtech:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── The designed failure ────────────────────────────────────────────────────

/**
 * A ranking publishes complete or it does not publish.
 *
 * That is a deliberate trade — a page with two of three panelists on it is
 * worse than an outage, because its numbers would not be comparable to any
 * other row on the board — so the failure has to read as part of the bit rather
 * than as a red box. Each stage names which part fell over.
 *
 * EVERY ONE OF THESE SHIPS AS HTTP 200. That is not sloppiness about status
 * codes, it is the only way this copy reaches a reader: Cloudflare intercepts
 * any 5xx from a Pages Function and replaces the body with its own plain-text
 * error page. Returning `json(failure("read"), 502)` therefore sent the browser
 * the six bytes `error code: 502`, `res.json()` threw, and the client's catch
 * reported "The panel is unreachable" — for a cake shop whose site returned
 * zero characters and never reached a model at all.
 *
 * So the whole designed-failure system was dead on arrival for three years'
 * worth of careful copy, and every distinct failure looked like one model
 * outage. These are OUTCOMES, not server errors: the request was understood and
 * answered. 200 with `status: "failed"` is also the honest encoding, and the
 * client already branches on that field before it looks at `res.ok`.
 */
export function failure(stage: "read" | "identify" | "panel" | "write") {
  const copy = {
    read: {
      headline: "We could not get a look at them.",
      detail:
        "We fetched that site and came back with almost nothing — it renders in the browser, or it blocks us. Nothing was published. Try a different domain, or the same one shortly.",
    },
    identify: {
      headline: "We could not work out what they are.",
      detail:
        "The pages came back and then nothing would tell us what business this is. That is usually the site's fault and occasionally ours. Try again shortly.",
    },
    panel: {
      headline: "The panel did not sit.",
      detail:
        "One of the three judges did not answer, so nothing was published — a panel of two would not be comparable to the rest of this board. Try again shortly.",
    },
    write: {
      headline: "The panel voted. Nobody would write it up.",
      detail:
        "All nine ratings came back and then the writer declined to put its name to a paragraph. Genuinely the funniest way this can fail. Try again shortly.",
    },
  }[stage];
  return { status: "failed" as const, stage, ...copy };
}

/**
 * The failure for whichever stage was last checkpointed.
 *
 * `runJob` marks each stage into `rank_job.stage` as it starts, so a stalled or
 * crashed run already records where it died. Two callers used to throw that
 * away and report `failure("panel")` unconditionally: the staleness sweeper and
 * the catch-all in `runJob`. The cost was not cosmetic — it collapsed four
 * distinct faults into one sentence, so a crawl that hung, an identify call
 * that never returned and an actual juror outage were indistinguishable from
 * the outside, and the panel took the blame for all of them.
 *
 * `persist` maps to `write` because that is the stage's reader-facing name, and
 * an unmarked job (dead before `read`) is a read failure — nothing else can
 * have run yet.
 */
export function failureForStage(stage: string | null | undefined) {
  switch (stage) {
    case "identify": return failure("identify");
    case "panel": return failure("panel");
    case "persist":
    case "write": return failure("write");
    default: return failure("read");
  }
}

// ── The rebuild trigger ─────────────────────────────────────────────────────

const BUILD_THROTTLE_MINUTES = 5;

async function triggerRebuild(env: Env): Promise<void> {
  if (!env.DEPLOY_HOOK_URL) {
    console.warn("[rank] DEPLOY_HOOK_URL unset — ranking stored but the board will not refresh");
    return;
  }
  try {
    const state = await env.RANKINGS.prepare("SELECT last_fired_at FROM build_state WHERE id = 1")
      .first<{ last_fired_at: string | null }>();
    const last = state?.last_fired_at ? Date.parse(`${state.last_fired_at}Z`) : 0;
    if (last && (Date.now() - last) / 60_000 < BUILD_THROTTLE_MINUTES) {
      await env.RANKINGS.prepare("UPDATE build_state SET pending = 1 WHERE id = 1").run();
      return;
    }
    // Only record a fire that actually fired. Stamping the throttle regardless
    // once let a wrong hook URL 404 on every call while the logs looked healthy.
    // Bounded — even backgrounded via waitUntil(), an unbounded fetch here
    // would burn the isolate's execution budget indefinitely on a hung hook.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    let hook: Response;
    try {
      hook = await fetch(env.DEPLOY_HOOK_URL, { method: "POST", signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!hook.ok) {
      console.error(`[rank] deploy hook ${hook.status} — board will not refresh`);
      await env.RANKINGS.prepare("UPDATE build_state SET pending = 1 WHERE id = 1").run();
      return;
    }
    await env.RANKINGS.prepare(
      "UPDATE build_state SET last_fired_at = datetime('now'), pending = 0 WHERE id = 1",
    ).run();
  } catch (err) {
    console.error("[rank] rebuild trigger failed:", err);
  }
}

/**
 * Fire a build that is OWED but was never triggered.
 *
 * `pending` is written in two places above and read in none, which makes the
 * throttle a queue with no consumer: rank two companies four minutes apart and
 * the second sits in D1, complete and correct, with no build scheduled to
 * publish it. It surfaces only when some later, unrelated submission happens to
 * fall outside the window and sweeps it up.
 *
 * Pages has no cron, so there is no background sweeper to add. The consumer is
 * therefore whoever is actually waiting on the page: the status endpoint calls
 * this every time it answers "not yet". `triggerRebuild` still owns the
 * throttle — inside the window it re-flags pending and returns — so polling
 * cannot stampede the hook.
 */
async function drainPendingBuild(env: Env): Promise<void> {
  const state = await env.RANKINGS.prepare(
    "SELECT pending FROM build_state WHERE id = 1",
  ).first<{ pending: number }>();
  if (!state?.pending) return;
  await triggerRebuild(env);
}

/**
 * Has a build carrying this row actually deployed yet?
 *
 * Asking the origin for the page is the only honest answer. Comparing the row's
 * timestamp against `last_fired_at` would say a build was TRIGGERED, which is a
 * different claim: the hook returning 200 means Cloudflare accepted the
 * request, not that the deploy finished, and a failed build fires the hook just
 * as cheerfully as a good one.
 *
 * `/tools/...` is a static asset rather than a Function route, so this cannot
 * recurse into this Worker.
 */
async function isPublished(origin: string, slug: string): Promise<boolean> {
  try {
    const res = await fetch(`${origin}/tools/rank-my-adtech/${slug}/`, {
      method: "GET",
      redirect: "manual",
      headers: { "cache-control": "no-cache" },
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

// ── HTTP plumbing ───────────────────────────────────────────────────────────

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json; charset=utf-8" },
  });

function isLocalOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".localhost");
  } catch {
    return false;
  }
}

const RATE_LIMIT_PER_DAY = 5;
/** Company pages sit beside these routes, so a company cannot own the name. */
const RESERVED_SLUGS = new Set(["leaderboard", "index", "api", "og"]);

// ── Handler ─────────────────────────────────────────────────────────────────

/**
 * Is this ranking's page live yet?
 *
 * The board is static, so a ranking exists in D1 a whole build before it exists
 * at a URL. The result card used to link straight at that URL and the
 * already-ranked path used to redirect to it, both within a second of the
 * deploy hook firing — so the reliable outcome of ranking a company was a 404
 * on your own panel.
 *
 * The client polls this instead of guessing, and answering also drains any
 * build the throttle swallowed.
 */
/**
 * A run is abandoned rather than slow after this long.
 *
 * waitUntil() keeps the pipeline alive past the response — and NOT for as long
 * as this pipeline needs. Measured with stage checkpoints on 2026-08-19:
 * id5.io reached `read` at 5s, `identify` at 11s, `panel` at 22s and then
 * stopped forever; Confiant, which ranks locally in 174s, produced no row at
 * all. The bound is on the whole invocation rather than on the response, so
 * moving work behind waitUntil bought instant acknowledgement and durable
 * failure reporting — both worth having — but did not raise the ceiling.
 *
 * 240s, not 360: a healthy long run reaches `persist` inside three minutes, so
 * six was making every doomed run cost the visitor twice as long to be told.
 */
const JOB_STALE_SECONDS = 240;

export const onRequestGet: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const url = new URL(request.url);

  /**
   * Poll a backgrounded ranking.
   *
   * Answers with the stored payload once the pipeline has finished, and with
   * `{status:"running"}` while it has not. A job that has been running past the
   * staleness window is reported as failed — the alternative is a spinner that
   * never resolves, which is the one outcome worse than a stated failure.
   */
  const job = (url.searchParams.get("job") ?? "").trim().toLowerCase();
  if (job) {
    if (!/^[a-f0-9]{32}$/.test(job)) return json({ error: "Bad job id." }, 400);
    const row = await env.RANKINGS.prepare(
      `SELECT status, payload, stage,
              CAST((julianday('now') - julianday(created_at)) * 86400 AS INTEGER) AS age,
              CAST((julianday('now') - julianday(COALESCE(stage_at, created_at))) * 86400 AS INTEGER) AS stageAt
         FROM rank_job WHERE id = ?`,
    ).bind(job).first<{ status: string; payload: string | null; stage: string | null; age: number; stageAt: number }>();

    if (!row) return json({ error: "No such job." }, 404);

    if (row.status === "running") {
      if (row.age > JOB_STALE_SECONDS) {
        // Report the stage that actually stalled, not a guess. This used to
        // hardcode failure("panel") — so a run that froze in `identify` and
        // never reached a juror still told the reader the panel would not sit.
        // Every distinct stall read as one panel outage, which is precisely
        // what made the real fault invisible for so long. The row knows.
        const stalled = failureForStage(row.stage);
        await env.RANKINGS.prepare(
          "UPDATE rank_job SET status = 'failed', payload = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?",
        ).bind(JSON.stringify(stalled), job).run();
        return json(stalled, 200);
      }
      return json({ status: "running", age: row.age, stage: row.stage, stageAt: row.stageAt }, 200);
    }

    // Stored verbatim by runJob, so this stays a thin read.
    try {
      return json(JSON.parse(row.payload ?? "{}"), 200);
    } catch {
      return json(failure("write"), 200);
    }
  }

  const slug = (url.searchParams.get("slug") ?? "").trim().toLowerCase();
  // The shape slugify() produces, and nothing else — this string goes into a
  // subrequest path.
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) return json({ error: "Bad slug." }, 400);

  const ready = await isPublished(url.origin, slug);
  if (!ready) waitUntil(drainPendingBuild(env));

  return new Response(JSON.stringify({ ready }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // A cached "not ready" would strand the very page it reports on.
      "cache-control": "no-store",
    },
  });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
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

  /**
   * Email is OPTIONAL — the form asks for a URL and nothing else. Entry is
   * frictionless and anyone can submit anyone, at the cost of the lead capture
   * this tool was originally built around. When an address IS supplied it is
   * still held to the work-address standard, since a free-mail one tells us
   * nothing.
   */
  const email = (payload.email ?? "").trim().toLowerCase();
  if (email) {
    if (!EMAIL_RE.test(email)) return json({ error: "That email does not look right." }, 400);
    const from = emailDomain(email);
    if (DISPOSABLE_DOMAINS.has(from)) return json({ error: "Use a real address." }, 400);
    if (FREE_EMAIL_DOMAINS.has(from)) {
      return json({ error: "Work email, please — a personal one tells us nothing." }, 400);
    }
  }

  const domain = normalizeDomain(payload.domain || (email ? emailDomain(email) : ""));
  if (!domain) return json({ error: "That does not look like a company URL." }, 400);

  // ── Rate limit ────────────────────────────────────────────────────────────
  const ipHash = await hashIp(request.headers.get("cf-connecting-ip") ?? "unknown");
  const recent = await env.RANKINGS.prepare(
    "SELECT COUNT(*) AS n FROM submission WHERE ip_hash = ? AND created_at > datetime('now', '-1 day')",
  ).bind(ipHash).first<{ n: number }>();
  if ((recent?.n ?? 0) >= RATE_LIMIT_PER_DAY) {
    return json({ error: "That is enough rankings for one day. Come back tomorrow." }, 429);
  }
  await env.RANKINGS.prepare("INSERT INTO submission (email, domain, ip_hash) VALUES (?, ?, ?)")
    .bind(email, domain, ipHash).run();

  // Lead first, always: the moments the pipeline is flaky are the moments the
  // lead matters most.
  if (email && env.LOOPS_API_KEY) await syncLeadToLoops(env.LOOPS_API_KEY, email, domain);

  /**
   * One company is one row — but only once it has a RANKING.
   *
   * The dedup used to match on the company row alone, which turned a company
   * without a ranking into a permanent block: invisible on the board, because
   * the board joins ranking, yet refusing every resubmission. Migration 0004
   * dropped the ranking table and left company, and six domains became
   * unrankable in exactly that way.
   *
   * So the check joins ranking, and any company row left without one is
   * cleared before the insert rather than colliding with the UNIQUE domain.
   */
  const existing = await env.RANKINGS.prepare(
    `SELECT c.slug FROM company c JOIN ranking r ON r.company_id = c.id
     WHERE c.domain = ? AND c.status = 'published'`,
  ).bind(domain).first<{ slug: string }>();
  if (existing) return json({ status: "already-ranked", slug: existing.slug, domain }, 200);

  /**
   * From here the work outlives the response.
   *
   * Everything above this line is fast — parse, rate limit, dedup — and every
   * answer it can give is immediate. Everything below is the pipeline: a crawl,
   * a classify call, three panel calls and a writer, which on the real board
   * runs between 60 and 140 seconds and occasionally longer.
   *
   * That used to happen inside this request, and Cloudflare's edge cuts a
   * request at roughly 120 seconds. It is not a setting a Function can raise:
   * measured on this board, a 119s run returned cleanly and a 125s run was
   * killed with a 524 and nothing written. Ezoic needs ~137s. So the ceiling
   * was a coin flip on every slow company, and it landed in the worst possible
   * place — after three labs had been paid for and before anything was saved.
   *
   * That reasoning was right about the 524 and wrong about the remedy.
   *
   * waitUntil() does NOT keep the pipeline alive for minutes. Cloudflare caps
   * it at THIRTY SECONDS after the response is on the wire, and cancels
   * whatever is still running:
   *
   *   "waitUntil() extends execution for up to 30 seconds after the response
   *    or disconnect. If tasks exceed this limit, they are canceled."
   *
   * So backgrounding the pipeline traded a ~100s ceiling for a 30s one and
   * every ranking began dying mid-`identify` — measured here, a run checkpointed
   * `identify` at t+2s, never advanced, and was swept up as a failure 240s
   * later. A HEALTHY run is 60-140s. Nothing could ever finish.
   *
   * An incoming HTTP request, by contrast, has NO wall-time limit while the
   * client stays connected. So the pipeline runs in the request again, which is
   * what it did back when this board was filling up. rank_job, the stage
   * checkpoints and the designed failures all stay — they are how this was
   * finally diagnosed — and the response shape is unchanged, so the client's
   * first poll simply finds the verdict already written.
   */
  const jobId = crypto.randomUUID().replace(/-/g, "");
  await env.RANKINGS.prepare("INSERT INTO rank_job (id, domain) VALUES (?, ?)")
    .bind(jobId, domain).run();

  /**
   * Stream the response, so the edge never sees an idle connection.
   *
   * Running in the request buys unlimited wall time only in principle. In
   * practice Cloudflare's edge cuts a connection that has produced no bytes for
   * roughly 100 seconds, which is the 524 that started all of this — and the
   * panel now needs longer than that, because GLM 5.3 is a reasoning model and
   * spends most of its budget thinking before it writes a character. Measured
   * on Zen: 1,666 reasoning tokens and 35s against a 369-token prompt, 91s
   * against a slightly larger one, and the real panel prompt carries a whole
   * site corpus.
   *
   * The platform states the remedy plainly: "a Worker that is still streaming a
   * response body remains active", with no wall-time limit while the client
   * stays connected. So the body opens immediately and a newline goes down it
   * every fifteen seconds until the pipeline is done. Bytes are flowing, the
   * edge stays out of it, and the seats get to finish thinking.
   *
   * Deliberately NOT waitUntil() — that is the 30s trap this just came out of.
   * The invocation is held open by the open stream itself.
   *
   * The client needs no change for this. Those heartbeats are leading
   * whitespace, which is legal in front of any JSON value, so the `res.json()`
   * that has always parsed this response still parses it.
   */
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  let finished = false;

  const heartbeat = async () => {
    while (!finished) {
      await new Promise((r) => setTimeout(r, 15_000));
      if (finished) break;
      try {
        await writer.write(enc.encode("\n"));
      } catch {
        break; // Client hung up. runJob still records the outcome in rank_job.
      }
    }
  };

  const pump = async () => {
    try {
      await runJob(env, waitUntil, domain, jobId);
    } finally {
      finished = true;
      try {
        await writer.write(enc.encode(JSON.stringify({ status: "queued", job: jobId, domain })));
      } catch { /* nothing left to write to */ }
      await writer.close().catch(() => {});
    }
  };

  heartbeat();
  pump();

  return new Response(readable, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Buffering anywhere in front of this would defeat the entire point.
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
};

/**
 * Run the pipeline and record whatever it came to.
 *
 * Nothing here throws to a caller — there is no caller left to catch it. An
 * unexpected error has to become a stored failure or the job sits at "running"
 * forever and the client polls a corpse.
 */
async function runJob(
  env: Env,
  waitUntil: (p: Promise<unknown>) => void,
  domain: string,
  jobId: string,
): Promise<void> {
  /**
   * Checkpoint each stage as it starts.
   *
   * Fire-and-forget: a checkpoint write must never be on the pipeline's
   * critical path, and losing one costs a diagnostic rather than a ranking.
   * This exists because a backgrounded run that produces NOTHING is
   * indistinguishable from a slow one — the first long run under waitUntil left
   * no company row and no error, and there was no way to tell whether the
   * platform had evicted it or the panel was still thinking.
   */
  // Held in the isolate as well as in D1, so the catch-all below can name the
  // stage without a read — and can still name it when the checkpoint write is
  // the thing that failed.
  let lastStage: string | null = null;
  const mark = (stage: string) => {
    lastStage = stage;
    waitUntil(
      env.RANKINGS.prepare(
        "UPDATE rank_job SET stage = ?, stage_at = CURRENT_TIMESTAMP WHERE id = ?",
      ).bind(stage, jobId).run().catch(() => {}),
    );
  };

  let payload: Record<string, unknown>;
  let status: "ranked" | "failed" | "refused";
  try {
    payload = await runPipeline(env, waitUntil, domain, mark);
    status =
      payload.status === "failed" ? "failed"
      : payload.status === "not-eligible" ? "refused"
      : "ranked";
  } catch (err) {
    // Name the stage that threw. Reporting every unexpected error as a panel
    // failure meant a D1 outage, a crawl that blew up and a genuine juror
    // timeout all published the same sentence.
    console.error(`[rank] ${domain} job ${jobId} threw in ${lastStage ?? "read"}:`, err);
    payload = failureForStage(lastStage);
    status = "failed";
  }
  try {
    await env.RANKINGS.prepare(
      "UPDATE rank_job SET status = ?, payload = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).bind(status, JSON.stringify(payload), jobId).run();
  } catch (err) {
    // Nothing left to tell. The staleness rule on the read side is what stops
    // this becoming a job that polls forever.
    console.error(`[rank] ${domain} job ${jobId} could not be recorded:`, err);
  }
}

/**
 * The pipeline itself: crawl, identify, place, panel, write, persist.
 *
 * Returns the payload the client will eventually receive rather than a
 * Response, because by the time this finishes the response is long gone.
 */
async function runPipeline(
  env: Env,
  waitUntil: (p: Promise<unknown>) => void,
  domain: string,
  mark: (stage: string) => void = () => {},
): Promise<Record<string, unknown>> {
  mark("read");
  // ── Read ──────────────────────────────────────────────────────────────────
  // context.dev is a fallback only — called by readSite() solely when the
  // direct fetch already came back thin (client-rendered shell, WAF block).
  const site = await readSite(domain, env.CONTEXT_DEV_API_KEY);
  // .pages, not .html — a context.dev rescue can return prose with no raw
  // markup (stack detection just finds nothing, which is already how the page
  // describes a warehouse-native setup).
  if (!site.pages) return failure("read");

  /**
   * Hard floor, not a flag. `thin` used to publish anyway (as "provisional"),
   * and identical empty input produced a 12.6-point spread: Assertive Yield
   * (React shell, 51 chars) scored 9.3 while HUMAN Security (bot-blocked, 35
   * chars) scored 21.9 — when there is no document, the score is brand recall,
   * not a reading. "Three models read your site" has to be true to publish.
   */
  const corpus = site.pages.replace(/^## .*$/gm, "").replace(/\s+/g, " ").trim();
  if (corpus.length < 1_500) {
    return failure("read");
  }

  const detected = detectStack(site.html);


  // ── Identify ──────────────────────────────────────────────────────────────
  // Any provider will do here; this is a factual question, not a judgement, so
  // it takes the first ladder that answers rather than a named seat.
  mark("identify");
  const identifyPrompt = buildIdentifyPrompt(domain, site.pages, site.thin);
  let identity: ReturnType<typeof normalizeIdentity> | undefined;
  // OpenCode Go leads by standing preference — one subscription across ~26
  // curated open models, so it is the cheapest rung that answers and the least
  // likely to rate-limit. Gemini and NIM stay beneath it as fallback.
  for (const provider of ["opencode", "gemini", "nvidia"] as Provider[]) {
    if (!keyFor(provider, env)) continue;
    try {
      const { value } = await askLadder(provider, env, identifyPrompt, (text) =>
        assertIdentityUsable(normalizeIdentity(extractJson(text))),
      );
      identity = value;
      break;
    } catch (err) {
      console.error(`[rank] identify: ${provider} exhausted:`, err);
    }
  }
  if (!identity) return failure("identify");

  if (!identity.eligible) {
    return {
      status: "not-eligible",
      domain,
      name: identity.name,
      verdict: identity.ineligibleReason || "We could not find an adtech company here.",
    };
  }

  /**
   * Refuse public companies BEFORE the panel, not after.
   *
   * Placement proper needs the panel's recall and so has to run later, but the
   * public check is pure markup and costs nothing. Running it here means a
   * listed company is turned away after one small call instead of after three
   * panel calls and a writer.
   */
  const markup = placeFromMarkup(site.html, site.pages);
  if (markup.isPublic) {
    return {
      status: "not-eligible",
      domain,
      name: identity.name,
      verdict: `This is a public company — it ${markup.isPublic}. The board is for startups, and a startup with a ticker symbol is just a company.`,
    };
  }

  // ── The panel ─────────────────────────────────────────────────────────────
  let panel: Awaited<ReturnType<typeof runPanel>>;
  /**
   * Look the company up BEFORE the panel sits, so the facts are in the prompt.
   *
   * On the critical path by definition — the seats need it in their input — but
   * it fails soft to null, and a null just means the jurors work from the site
   * alone. It runs after `identify` because the search needs a company NAME.
   */
  const [facts, press] = await Promise.all([
    lookupCompany(env as FactsEnv, domain, identity.name),
    lookupPress(env as FactsEnv, domain, identity.name),
  ]);
  if (facts) {
    console.log(
      `[rank] ${domain} — facts: founded ${facts.foundedYear || "?"}` +
      ` · ${facts.headcountRange || "size ?"} · ${divisionFor(facts.headcountRange) ?? "unclassed"}` +
      ` · $${facts.costUsd}`,
    );
  }

  try {
    mark("panel");
    panel = await runPanel(env, {
      domain, pages: site.pages, thin: site.thin, facts, press,
      categories: CATEGORIES, categoryNotes: CATEGORY_NOT,
    });
  } catch (err) {
    console.error(`[rank] ${domain}: ${err instanceof Error ? err.message : err}`);
    return failure("panel");
  }

  /**
   * ── Place, on the panel's evidence ──────────────────────────────────────
   *
   * Both facts the board's structure depends on are resolved by majority
   * across three labs rather than by any single call. Category decides which
   * two tables a company appears in, so one model's bad afternoon used to
   * shift every rank around it; requiring two independent models to agree is
   * what stopped that.
   */
  const recall = resolveRecall(panel.takes);
  // A human correction beats the panel — see CATEGORY_OVERRIDES.
  const category = categoryFor(domain, recall.category, identity.category);

  const placement = place(site.html, site.pages, identity.stage, recall);
  if (!placement.eligible) {
    return { status: "not-eligible", domain, name: identity.name, verdict: placement.reason };
  }
  const side = sideFor(category);
  const cohort = cohortLabel(placement.band, side);

  console.log(
    `[rank] ${domain} — ${panel.total}/30 · ${cohort} · ${category}` +
    ` (cat ${recall.categoryVotes}/3, round ${recall.round || "none"} ${recall.roundVotes}/3)` +
    ` by ${panel.takes.map((t) => t.modelUsed).join(", ")}`,
  );

  // ── The write-up ──────────────────────────────────────────────────────────
  // The writer is pinned to its own model rather than taking whatever the
  // OpenCode ladder prefers, because the panel section names it on the page.
  let summary: string;
  try {
    const { value } = await askLadder(
      WRITER.provider,
      env,
      buildWriterPrompt({
        name: identity.name,
        oneLiner: identity.oneLiner,
        categoryLabel: categoryLabel(category),
        cohort,
        panel,
      }),
      (text) => assertSummaryUsable(normalizeSummary(extractJson(text))),
      {
        preferred: WRITER.model,
        // Pinned like the jurors: the company page states, statically, that
        // THIS model wrote the verdict — a substituted writer makes that line
        // false. Two attempts, since the ladder is now one rung.
        only: [WRITER.model],
        attempts: 2,
        // The one call in the pipeline that is NOT at temperature 0. Scores have
        // to be repeatable; prose does not, and a joke sampled greedily is the
        // most obvious joke available. The numbers this paragraph describes are
        // already fixed, so nothing rankable moves when this varies.
        temperature: 0.8,
      },
    );
    summary = value;
    mark("persist");
  } catch (err) {
    console.error(`[rank] writer failed:`, err);
    return failure("write");
  }

  // ── Persist ───────────────────────────────────────────────────────────────

  /* Clear this domain's rankless rows FIRST.

     This ran after the clash check, which made a company collide with its own
     abandoned attempt. Any run that inserts a company row and then fails before
     writing a ranking leaves that row behind; the next run for the same domain
     saw it, called it a clash, and disambiguated a name that had nothing to
     disambiguate from — and only then deleted the row it had been avoiding.
     The Media Trust shipped as `the-media-trust-mediatrust-c` this way, with no
     second Media Trust anywhere in the table.

     Sequence matters, not the check: delete the ghosts, then ask what is
     actually taken. */
  await env.RANKINGS.prepare(
    `DELETE FROM company WHERE domain = ?
       AND id NOT IN (SELECT company_id FROM ranking)`,
  ).bind(domain).run();

  /* The disambiguator is the domain's own label — `mediatrust`, not
     `mediatrust-c`. Slicing the slugified domain to 12 characters cut mid-word
     on anything longer, so a collision produced a slug that reads as a
     truncation bug and stays in the URL forever. */
  const domainTag = slugify(domain.split(".")[0]);
  let slug = slugify(identity.name) || slugify(domain);
  if (RESERVED_SLUGS.has(slug)) slug = `${slug}-${domainTag}`;
  const clash = await env.RANKINGS.prepare("SELECT 1 FROM company WHERE slug = ?").bind(slug).first();
  if (clash) slug = `${slug}-${domainTag}`;

  const logo = (await resolveLogo(site.html, site.finalUrl))?.url ?? null;

  const companyRow = await env.RANKINGS.prepare(
    `INSERT INTO company (domain, name, slug, logo_url, one_liner,
                          founded_year, division, headcount, facts_json,
                          category, stage, band, side, band_evidence, band_inferred, provisional)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  ).bind(
    domain, identity.name, slug, logo, identity.oneLiner,
    /* From the search, not hardcoded. NULL when the lookup found no size or no
       founding year — the page shows a weight class and an age only when one
       was actually established. */
    facts?.foundedYear || null,
    facts ? divisionFor(facts.headcountRange) : null,
    facts?.headcountRange || null,
    facts ? JSON.stringify(facts) : null,
    category, identity.stage,
    placement.band, side, placement.bandEvidence, placement.bandInferred ? 1 : 0,
    site.thin ? 1 : 0,
  ).first<{ id: number }>();

  if (!companyRow?.id) return failure("write");

  const rankingRow = await env.RANKINGS.prepare(
    `INSERT INTO ranking (company_id, total, innovation, difficulty, outlook,
                          split_question, split_spread, summary, stack_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  ).bind(
    companyRow.id, panel.total,
    panel.means.innovation, panel.means.difficulty, panel.means.outlook,
    panel.split?.question ?? null, panel.split?.spread ?? 0,
    summary, JSON.stringify(byCategory(detected)),
  ).first<{ id: number }>();

  if (!rankingRow?.id) return failure("write");

  // One row per panelist. Batched so three takes land together or not at all —
  // a ranking with two of its three takes written would render as a short panel
  // and be indistinguishable on the page from one that legitimately sat two.
  await env.RANKINGS.batch(
    panel.takes.map((take) =>
      env.RANKINGS.prepare(
        `INSERT INTO panel_take (ranking_id, panelist_id, model_used,
                                 innovation, difficulty, outlook, ratings_json, adjective)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        rankingRow.id, take.panelistId, take.modelUsed,
        take.ratings.innovation.score, take.ratings.difficulty.score,
        take.ratings.outlook.score,
        JSON.stringify(take.ratings), take.adjective,
      ),
    ),
  );

  /**
   * Bug found live 2026-08-15: this used to be `await`ed here, on the critical
   * path between "the ranking is safely in D1" and "the client gets its
   * response." The hook fetch below had no timeout, so any slowness on the
   * far end held the whole HTTP response open — a run that had already
   * succeeded (the row IS written by this point) would time out client-side
   * as "the panel is unreachable," and the deploy that would have put it on
   * the board never got a clean confirmation either. admiral.com published
   * cleanly and sat invisible for hours because of exactly this.
   *
   * waitUntil() runs it after the response is already on the wire — a slow
   * or hung deploy hook can no longer cost the visitor their result.
   */
  waitUntil(triggerRebuild(env));

  return {
    status: "ranked",
    slug, domain,
    name: identity.name,
    oneLiner: identity.oneLiner,
    logo,
    category,
    categoryLabel: categoryLabel(category),
    band: placement.band,
    bandLabel: BAND_LABELS[placement.band],
    bandEvidence: placement.bandEvidence,
    bandInferred: placement.bandInferred,
    side,
    sideLabel: SIDE_LABELS[side],
    cohort,
    recall,
    total: panel.total,
    means: panel.means,
    split: panel.split,
    questions: QUESTIONS.map((q) => ({ key: q.key, label: q.label })),
    panel: panel.takes.map((t) => ({
      ...t,
      name: PANELISTS.find((p) => p.id === t.panelistId)?.name ?? t.panelistId,
      lab: PANELISTS.find((p) => p.id === t.panelistId)?.lab ?? "",
    })),
    summary,
    stack: byCategory(detected),
  };
}
