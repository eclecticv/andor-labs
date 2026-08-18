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
 *   grade     ONE model call. Five dimensions on anchored 1-5 scales, the case
 *             against written before any score exists, the classification, and
 *             the verdict paragraph — all in a single response.
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
 *   NVIDIA_API_KEY   the grader runs on NIM and is pinned to one model, so this
 *                    is the only model key the ranking path needs. GEMINI and
 *                    OPENCODE keys are still read by _lib/providers for the
 *                    identify step and for local tooling.
 *   LOOPS_API_KEY    optional; only used when a submission carries an email
 *   DEPLOY_HOOK_URL  the board is static, so a ranking is invisible until a
 *                    build runs
 */

import { readSite } from "../_lib/crawl";
import { detectStack, byCategory } from "../_lib/stack";
import { resolveLogo } from "../_lib/logo";

import {
  buildIdentifyPrompt, normalizeIdentity, assertIdentityUsable,
  place, placeFromMarkup, sideFor, cohortLabel, categoryLabel, categoryFor,
  CATEGORIES, CATEGORY_NOT, BAND_LABELS, SIDE_LABELS,
} from "../_lib/classify";
import { runGrader, recallFrom, DIMENSIONS, DIMENSION_KEYS, GRADER } from "../_lib/grader";
import { askLadder, extractJson, keyFor, type Provider } from "../_lib/providers";

interface Env {
  RANKINGS: D1Database;
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
 * That is a deliberate trade — a row graded by a substitute model is worse than
 * an outage, because its numbers would not be comparable to any other row on
 * the board — so the failure has to read as part of the bit rather than as a
 * red box. Each stage names which part fell over.
 */
export function failure(stage: "read" | "identify" | "grade") {
  const copy = {
    read: {
      headline: "We could not get a look at them.",
      detail:
        "We fetched that site and came back with almost nothing. Either it is very well defended, it renders entirely in the browser, or we are having a bad afternoon. The authorities have been notified.",
    },
    identify: {
      headline: "We could not work out what they are.",
      detail:
        "The pages came back and then nothing would tell us what business this is. That is usually the site's fault and occasionally ours. Try again shortly.",
    },
    grade: {
      headline: "The grader would not put its name to it.",
      detail:
        "The pages came back and the grader either could not answer or would not answer usably. Every row on this board is graded by the same model against the same rubric, so a substitute is not an option — there is no ranking rather than an incomparable one. Try again shortly.",
    },
  }[stage];
  return { status: "failed" as const, stage, ...copy };
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

  // ── Read ──────────────────────────────────────────────────────────────────
  // context.dev is a fallback only — called by readSite() solely when the
  // direct fetch already came back thin (client-rendered shell, WAF block).
  const site = await readSite(domain, env.CONTEXT_DEV_API_KEY);
  // .pages, not .html — a context.dev rescue can return prose with no raw
  // markup (stack detection just finds nothing, which is already how the page
  // describes a warehouse-native setup).
  if (!site.pages) return json(failure("read"), 502);

  /**
   * Hard floor, not a flag. `thin` used to publish anyway (as "provisional"),
   * and identical empty input produced a 12.6-point spread: Assertive Yield
   * (React shell, 51 chars) scored 9.3 while HUMAN Security (bot-blocked, 35
   * chars) scored 21.9 — when there is no document, the score is brand recall,
   * not a reading. "Three models read your site" has to be true to publish.
   */
  const corpus = site.pages.replace(/^## .*$/gm, "").replace(/\s+/g, " ").trim();
  if (corpus.length < 1_500) {
    return json(failure("read"), 200);
  }

  const detected = detectStack(site.html);

  // ── Identify ──────────────────────────────────────────────────────────────
  // Any provider will do here; this is a factual question, not a judgement, so
  // it takes the first ladder that answers rather than a named seat.
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
  if (!identity) return json(failure("identify"), 502);

  if (!identity.eligible) {
    return json({
      status: "not-eligible",
      domain,
      name: identity.name,
      verdict: identity.ineligibleReason || "We could not find an adtech company here.",
    }, 200);
  }

  /**
   * Refuse public companies BEFORE the grader, not after.
   *
   * Placement proper needs the grader's recall and so has to run later, but the
   * public check is pure markup and costs nothing. Running it here means a
   * listed company is turned away after one small call instead of after three
   * grader call.
   */
  const markup = placeFromMarkup(site.html, site.pages);
  if (markup.isPublic) {
    return json({
      status: "not-eligible",
      domain,
      name: identity.name,
      verdict: `This is a public company — it ${markup.isPublic}. The board is for startups, and a startup with a ticker symbol is just a company.`,
    }, 200);
  }

  // ── The grade ─────────────────────────────────────────────────────────────
  let grade: Awaited<ReturnType<typeof runGrader>>;
  try {
    grade = await runGrader(env, {
      domain, pages: site.pages, thin: site.thin, categories: CATEGORIES, categoryNotes: CATEGORY_NOT,
    });
  } catch (err) {
    console.error(`[rank] ${domain}: ${err instanceof Error ? err.message : err}`);
    return json(failure("grade"), 502);
  }

  /**
   * ── Place, on the grader's evidence ─────────────────────────────────────
   *
   * The majority vote is gone with the panel; see recallFrom() for what that
   * costs and why it is affordable. The short version: band still prefers
   * structural markup evidence over anything a model said, so a fabricated
   * round cannot overrule an announced one.
   */
  const recall = recallFrom(grade);
  // A human correction beats the model — see CATEGORY_OVERRIDES.
  const category = categoryFor(domain, recall.category, identity.category);

  const placement = place(site.html, site.pages, identity.stage, recall);
  if (!placement.eligible) {
    return json({ status: "not-eligible", domain, name: identity.name, verdict: placement.reason }, 200);
  }
  const side = sideFor(category);
  const cohort = cohortLabel(placement.band, side);

  console.log(
    `[rank] ${domain} — ${grade.grade}/5 (${grade.letter}) · ${cohort} · ${category}` +
    ` · ${DIMENSION_KEYS.map((k) => `${k[0]}${grade.scores[k].score}`).join(" ")}` +
    ` · round ${recall.round || "none"} · by ${grade.modelUsed}`,
  );

  /**
   * There is no write-up step any more.
   *
   * The writer existed because nine ratings from three models needed a fourth
   * to synthesise them, and because a model that had scored nothing could
   * report a split honestly rather than defend its own number. Neither applies
   * to five grades from one grader: it returned the paragraph in the same
   * response, having already written the case against the company before it
   * scored anything.
   */
  const summary = grade.summary;

  // ── Persist ───────────────────────────────────────────────────────────────
  let slug = slugify(identity.name) || slugify(domain);
  if (RESERVED_SLUGS.has(slug)) slug = `${slug}-${slugify(domain).slice(0, 12)}`;
  const clash = await env.RANKINGS.prepare("SELECT 1 FROM company WHERE slug = ?").bind(slug).first();
  if (clash) slug = `${slug}-${slugify(domain).slice(0, 12)}`;

  const logo = (await resolveLogo(site.html, site.finalUrl))?.url ?? null;

  // Clear any rankless row for this domain so the UNIQUE constraint does not
  // reject an insert that the dedup above deliberately allowed through.
  await env.RANKINGS.prepare(
    `DELETE FROM company WHERE domain = ?
       AND id NOT IN (SELECT company_id FROM ranking)`,
  ).bind(domain).run();

  const companyRow = await env.RANKINGS.prepare(
    `INSERT INTO company (domain, name, slug, logo_url, one_liner, division, category, stage,
                          band, side, band_evidence, band_inferred, provisional)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  ).bind(
    domain, identity.name, slug, logo, identity.oneLiner,
    // `division` is legacy and still NOT NULL. Band supersedes it; the column
    // goes once nothing reads it.
    "middleweight",
    category, identity.stage,
    placement.band, side, placement.bandEvidence, placement.bandInferred ? 1 : 0,
    site.thin ? 1 : 0,
  ).first<{ id: number }>();

  if (!companyRow?.id) return json({ error: "Could not save that ranking." }, 500);

  const rankingRow = await env.RANKINGS.prepare(
    `INSERT INTO ranking (company_id, grade, originality, defensibility, traction,
                          execution, durability, reasons_json, case_against_json,
                          summary, stack_json, model_used)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  ).bind(
    companyRow.id, grade.grade,
    grade.scores.originality.score, grade.scores.defensibility.score,
    grade.scores.traction.score, grade.scores.execution.score,
    grade.scores.durability.score,
    // Reasons keyed by dimension, so a column added later cannot silently
    // reorder them the way a positional array would.
    JSON.stringify(Object.fromEntries(DIMENSION_KEYS.map((k) => [k, grade.scores[k].reason]))),
    JSON.stringify(grade.caseAgainst),
    summary, JSON.stringify(byCategory(detected)),
    grade.modelUsed,
  ).first<{ id: number }>();

  if (!rankingRow?.id) return json({ error: "Could not save that ranking." }, 500);

  /**
   * Bug found live 2026-08-15: this used to be `await`ed here, on the critical
   * path between "the ranking is safely in D1" and "the client gets its
   * response." The hook fetch below had no timeout, so any slowness on the
   * far end held the whole HTTP response open — a run that had already
   * succeeded (the row IS written by this point) would time out client-side
   * as "the grader is unreachable," and the deploy that would have put it on
   * the board never got a clean confirmation either. admiral.com published
   * cleanly and sat invisible for hours because of exactly this.
   *
   * waitUntil() runs it after the response is already on the wire — a slow
   * or hung deploy hook can no longer cost the visitor their result.
   */
  waitUntil(triggerRebuild(env));

  return json({
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
    grade: grade.grade,
    letter: grade.letter,
    dimensions: DIMENSIONS.map((d) => ({
      key: d.key,
      label: d.label,
      score: grade.scores[d.key].score,
      reason: grade.scores[d.key].reason,
    })),
    caseAgainst: grade.caseAgainst,
    grader: { name: GRADER.name, lab: GRADER.lab, spec: GRADER.spec, model: grade.modelUsed },
    summary,
    stack: byCategory(detected),
  }, 200);
};
