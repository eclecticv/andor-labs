/**
 * Rank My AdTech — the ranking pipeline.
 *
 * Someone submits a company URL. We read four or five of its pages, look at
 * what GTM tooling the markup gives away, check it is not past a Series B, and
 * ask one model to score it on the four dimensions And/or Labs sells against.
 *
 * The shape, in order, and why each step sits where it does:
 *
 *   crawl   Four or five pages, not one. A homepage is written to impress, so
 *           scoring from it alone measures copywriting. The about, pricing,
 *           careers and blog pages are where a company accidentally tells you
 *           the truth.
 *   stack   Read from markup. Free, precise, and the evidence behind the GTM
 *           maturity dimension.
 *   stage   A one-sided "too big" test over structural signals — announced
 *           rounds, job boards, offices — and never over tone. Marketing copy
 *           exists to make a company sound established, so inferring stage from
 *           it is biased upward by construction. That bug put a seed company in
 *           the same division as The Trade Desk once already.
 *   score   ONE model call. The three-model panel it replaces existed so that
 *           disagreement was itself the product; this tool sells something
 *           else, so the budget moves from breadth of opinion to depth of
 *           evidence.
 *
 * Two rules carried over, both learned the hard way: the total is arithmetic in
 * code and the model is never asked for one, and a provider is a LADDER whose
 * rung fails on an unusable answer rather than merely on an HTTP error.
 *
 * Required environment:
 *   RANKINGS         D1 binding, configured on the Pages project itself rather
 *                    than in a wrangler config file — Pages does not support
 *                    partial configuration, so a root wrangler.toml would take
 *                    over the namespace holding this project's secrets.
 *   GEMINI_API_KEY / NVIDIA_API_KEY / OPENCODE_API_KEY   the scorer's ladder
 *   LOOPS_API_KEY    optional; only used when a submission carries an email
 *   DEPLOY_HOOK_URL  the board is static, so a ranking is invisible until a
 *                    build runs
 */

import { readSite } from "../_lib/crawl";
import { detectStack, byCategory, coreCoverage } from "../_lib/stack";
import { assessStage, countOpenRoles, tooBigMessage } from "../_lib/stage";
import { resolveLogo } from "../_lib/logo";
import {
  buildPrompt, normalizeScore, assertScoreUsable, DIMENSIONS, categoryLabel,
} from "../_lib/score";
import { askLadder, extractJson, keyFor, type Provider } from "../_lib/providers";

interface Env {
  RANKINGS: D1Database;
  GEMINI_API_KEY?: string;
  NVIDIA_API_KEY?: string;
  OPENCODE_API_KEY?: string;
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
 * That is a deliberate trade — a half-scored page under a promise of four
 * dimensions is worse than an outage — so the failure has to read as part of
 * the bit rather than as a red box. Each stage names which part fell over.
 */
export function failure(stage: "read" | "score") {
  const copy = {
    read: {
      headline: "We could not get a look at them.",
      detail:
        "We fetched that site and came back with almost nothing. Either it is very well defended, it renders entirely in the browser, or we are having a bad afternoon. The authorities have been notified.",
    },
    score: {
      headline: "Every judge we own declined.",
      detail:
        "The pages were read and the evidence gathered, and then not one model would produce something printable in front of an audience. Try again shortly.",
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
    const hook = await fetch(env.DEPLOY_HOOK_URL, { method: "POST" });
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

  // One company is one row, permanently. This is the cost control as much as
  // the dedup: a resubmission must not spend a model call reprinting an answer.
  const existing = await env.RANKINGS.prepare(
    "SELECT slug FROM company WHERE domain = ? AND status = 'published'",
  ).bind(domain).first<{ slug: string }>();
  if (existing) return json({ status: "already-ranked", slug: existing.slug, domain }, 200);

  // ── Read ──────────────────────────────────────────────────────────────────
  const site = await readSite(domain);
  if (!site.html) return json(failure("read"), 502);

  const detected = detectStack(site.html);
  const openRoles = countOpenRoles(site.html);

  // ── Stage: structural evidence, never tone ────────────────────────────────
  const stageVerdict = assessStage({
    text: site.pages,
    html: site.html,
    detected,
    sitemapUrlCount: site.sitemapUrlCount ?? undefined,
  });
  if (stageVerdict.tooBig) {
    return json({
      status: "too-big",
      domain,
      verdict: tooBigMessage(stageVerdict, site.titles[0] ?? domain),
    }, 200);
  }

  // ── Score ─────────────────────────────────────────────────────────────────
  const prompt = buildPrompt({
    domain,
    pages: site.pages,
    detected,
    coreCoverage: coreCoverage(detected),
    openRoles,
    sitemapUrlCount: site.sitemapUrlCount,
    stageNotes: stageVerdict.soft,
    thin: site.thin,
  });

  let scored: ReturnType<typeof normalizeScore> | undefined;
  for (const provider of ["opencode", "nvidia", "gemini"] as Provider[]) {
    if (!keyFor(provider, env)) continue;
    try {
      const { value, model } = await askLadder(provider, env, prompt, (text) =>
        assertScoreUsable(normalizeScore(extractJson(text))),
      );
      console.log(`[rank] ${domain} scored by ${model}`);
      scored = value;
      break;
    } catch (err) {
      console.error(`[rank] ${provider} exhausted:`, err);
    }
  }
  if (!scored) return json(failure("score"), 502);

  if (!scored.eligible) {
    return json({
      status: "not-eligible",
      domain,
      name: scored.name,
      verdict: scored.ineligibleReason || "We could not find an AI-native adtech company here.",
    }, 200);
  }

  // ── Persist ───────────────────────────────────────────────────────────────
  let slug = slugify(scored.name) || slugify(domain);
  if (RESERVED_SLUGS.has(slug)) slug = `${slug}-${slugify(domain).slice(0, 12)}`;
  const clash = await env.RANKINGS.prepare("SELECT 1 FROM company WHERE slug = ?").bind(slug).first();
  if (clash) slug = `${slug}-${slugify(domain).slice(0, 12)}`;

  const logo = (await resolveLogo(site.html, site.finalUrl))?.url ?? null;

  const companyRow = await env.RANKINGS.prepare(
    `INSERT INTO company (domain, name, slug, logo_url, one_liner, division, category, stage, provisional)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  ).bind(
    domain, scored.name, slug, logo, scored.oneLiner,
    // `division` is legacy and still NOT NULL. Stage supersedes it; the column
    // goes once the pages stop reading it.
    "middleweight",
    scored.category, scored.stage,
    site.thin || stageVerdict.noEvidence ? 1 : 0,
  ).first<{ id: number }>();

  if (!companyRow?.id) return json({ error: "Could not save that ranking." }, 500);

  const detail = Object.fromEntries(
    DIMENSIONS.map((d) => [d.key, {
      reasoning: scored!.dimensions[d.key].reasoning,
      improve: scored!.dimensions[d.key].improve,
      keyword: scored!.dimensions[d.key].keyword,
    }]),
  );

  await env.RANKINGS.prepare(
    `INSERT INTO ranking (company_id, total, positioning, content, gtm_stack, innovation,
                          detail_json, verdict, stack_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    companyRow.id, scored.total,
    scored.dimensions.positioning.score, scored.dimensions.content.score,
    scored.dimensions.gtm_stack.score, scored.dimensions.innovation.score,
    JSON.stringify(detail), scored.verdict, JSON.stringify(byCategory(detected)),
  ).run();

  await triggerRebuild(env);

  return json({
    status: "ranked",
    slug, domain,
    name: scored.name,
    oneLiner: scored.oneLiner,
    logo,
    category: scored.category,
    categoryLabel: categoryLabel(scored.category),
    stage: scored.stage,
    total: scored.total,
    dimensions: scored.dimensions,
    verdict: scored.verdict,
    stack: byCategory(detected),
  }, 200);
};
