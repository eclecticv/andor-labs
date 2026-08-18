/**
 * Run the ranking pipeline outside Workers, against the real models.
 *
 * Everything up to the database write is portable — crawl, identify, place,
 * panel and writer are plain fetch — so this exercises the ACTUAL modules the
 * Function uses rather than a reimplementation of them. Only the D1 write is
 * replaced, and it is emitted as SQL for wrangler to apply.
 *
 * Why this exists: `wrangler pages dev` cannot bind the remote D1, so the only
 * other way to put a real ranking on the board is to deploy first and submit
 * against production. That makes the deploy the test. This lets the whole model
 * layer be exercised, read and corrected before anything ships.
 *
 * Emits SQL on stdout and progress on stderr — but the provider ladder also
 * logs to stdout when it skips a rung, so the SQL needs filtering before use:
 *
 *   set -a; . ./.dev.vars; set +a
 *   npx tsx scripts/rank-local.mts example.com > /tmp/seed.sql
 *   grep -v '^\[rank\]' /tmp/seed.sql > /tmp/seed-clean.sql
 *   npx wrangler d1 execute andor-rankings -c d1.wrangler.jsonc --remote \
 *     --file /tmp/seed-clean.sql -y
 *
 * ── Iterating without paying for it ──
 * Every network stage is cached to .scratch/rank-cache/<domain>/, keyed by a
 * fingerprint of that stage's inputs (see scripts/lib/rank-cache.ts). So the
 * first run on a domain costs four model calls and every run after it costs
 * whatever you actually changed:
 *
 *   --replay              refuse to call anything; a miss is an error, so a
 *                         replay run is provably free. This is the loop for
 *                         tuning classify.ts, the SQL, or anything on the page.
 *   --refresh=panel       re-run the three seats (rubric or model changes)
 *   --refresh=writer      re-roll the prose (the writer runs at temp 0.8, so
 *                         the same prompt legitimately gives a new answer)
 *   --refresh=crawl       re-read the site
 *   --refresh             everything, i.e. the old behaviour
 */
import { readSite } from "../functions/_lib/crawl";
import { detectStack, byCategory } from "../functions/_lib/stack";
import { resolveLogo } from "../functions/_lib/logo";

import {
  buildIdentifyPrompt, normalizeIdentity, assertIdentityUsable,
  place, placeFromMarkup, sideFor, cohortLabel, categoryLabel, categoryFor,
  CATEGORIES, CATEGORY_NOT,
} from "../functions/_lib/classify";
import {
  runGrader, recallFrom, GRADER, DIMENSION_KEYS,
  buildGraderPrompt, buildGraderSystem,
  type Grade, type GraderInput,
} from "../functions/_lib/grader";
import { askLadder, extractJson, keyFor, type Provider } from "../functions/_lib/providers";
import { stage, fingerprint, parseCacheFlags, type CacheOptions } from "./lib/rank-cache";

const env = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  NVIDIA_API_KEY: process.env.NVIDIA_API_KEY,
  OPENCODE_API_KEY: process.env.OPENCODE_API_KEY,
};
const CONTEXT_DEV_API_KEY = process.env.CONTEXT_DEV_API_KEY;

const q = (v: unknown) =>
  v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`;

const slugify = (v: string) =>
  v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

async function rank(domain: string, cache: CacheOptions) {
  const t0 = Date.now();
  // The crawl has no inputs beyond the domain, so it never self-invalidates —
  // it refreshes when asked for by name and not otherwise.
  const site = await stage(domain, "crawl", "*", cache, () => readSite(domain, CONTEXT_DEV_API_KEY));
  if (!site.pages) throw new Error("read failed");
  // Same floor as the live Function: under 1,500 chars of real corpus, refuse
  // before the identify call rather than feed a model a page shell (or, once,
  // an unstripped CSS blob) and let it guess.
  const corpus = site.pages.replace(/^## .*$/gm, "").replace(/\s+/g, " ").trim();
  if (corpus.length < 1_500) throw new Error(`read failed — only ${corpus.length} chars of real corpus`);
  console.error(`  read ${site.pages.length} chars`);

  const detected = detectStack(site.html);

  const identifyPrompt = buildIdentifyPrompt(domain, site.pages, site.thin);
  const identity = await stage(domain, "identify", fingerprint(identifyPrompt), cache, async () => {
    // OpenCode Go leads — mirrors the Function's order so a local re-run seats
    // the same identifier the live pipeline would.
    for (const provider of ["opencode", "gemini", "nvidia"] as Provider[]) {
      if (!keyFor(provider, env)) continue;
      try {
        const { value } = await askLadder(provider, env, identifyPrompt,
          (t) => assertIdentityUsable(normalizeIdentity(extractJson(t))));
        return value;
      } catch (e) { console.error(`  identify ${provider}: ${e}`); }
    }
    throw new Error("identify failed");
  });
  if (!identity.eligible) return { refused: identity.ineligibleReason, domain };
  console.error(`  ${identity.name} — ${identity.category} — model stage "${identity.stage}"`);

  const markup = placeFromMarkup(site.html, site.pages);
  if (markup.isPublic) return { refused: `Public company — ${markup.isPublic}.`, domain };

  const graderInput: GraderInput = {
    domain, pages: site.pages, thin: site.thin, categories: CATEGORIES, categoryNotes: CATEGORY_NOT,
  };
  /**
   * The whole grade is cached as one unit, because it arrives as one.
   *
   * Under the panel this stage cached RAW takes and recomputed the aggregate on
   * replay, so tuning how scores combined cost nothing. There is no aggregation
   * step left — one model returns the five grades already decided — so the
   * fingerprint below covers the prompt, the pinned model and the system
   * message, and any change to the rubric correctly re-grades.
   */
  const grade = await stage<Grade>(
    domain, "grade",
    fingerprint(buildGraderPrompt(graderInput), [GRADER.model, buildGraderSystem()]),
    cache,
    async () => runGrader(env, graderInput),
  );

  const recall = recallFrom(grade);
  const category = categoryFor(domain, recall.category, identity.category);
  const placement = place(site.html, site.pages, identity.stage, recall);
  if (!placement.eligible) return { refused: placement.reason, domain };
  const side = sideFor(category);
  const cohort = cohortLabel(placement.band, side);
  console.error(`  ${cohort} · ${category} · round ${recall.round || "none"} — ${placement.bandEvidence}`);
  console.error(
    `  ${grade.grade}/5 (${grade.letter}) — ` +
    DIMENSION_KEYS.map((k) => `${k}=${grade.scores[k].score}`).join("  "),
  );
  for (const line of grade.caseAgainst) console.error(`  against: ${line}`);

  /* No writer stage. The verdict came back in the same response as the grades,
     which is the whole point of the change — there is nothing left to re-roll
     independently, and `--refresh=grade` re-rolls prose and numbers together
     because they were always one decision. */
  const summary = grade.summary;

  const logo = await stage(domain, "logo", "*", cache,
    async () => (await resolveLogo(site.html, site.finalUrl))?.url ?? null);
  const slug = slugify(identity.name) || slugify(domain);
  console.error(`  done in ${Math.round((Date.now() - t0) / 1000)}s\n`);

  return {
    domain, slug, identity, placement, side, cohort, grade, summary, logo, category,
    stack: byCategory(detected), thin: site.thin,
  };
}

const sqlFor = (r: any) => {
  const lines = [
    `DELETE FROM company WHERE domain = ${q(r.domain)} AND id NOT IN (SELECT company_id FROM ranking);`,
    `INSERT INTO company (domain, name, slug, logo_url, one_liner, division, category, stage, band, side, band_evidence, band_inferred, provisional)
 VALUES (${q(r.domain)}, ${q(r.identity.name)}, ${q(r.slug)}, ${q(r.logo)}, ${q(r.identity.oneLiner)}, 'middleweight', ${q(r.category)}, ${q(r.identity.stage)}, ${q(r.placement.band)}, ${q(r.side)}, ${q(r.placement.bandEvidence)}, ${r.placement.bandInferred ? 1 : 0}, ${r.thin ? 1 : 0});`,
    `INSERT INTO ranking (company_id, grade, originality, defensibility, traction, execution, durability, reasons_json, case_against_json, summary, stack_json, model_used)
 VALUES ((SELECT id FROM company WHERE domain = ${q(r.domain)}), ${r.grade.grade}, ${r.grade.scores.originality.score}, ${r.grade.scores.defensibility.score}, ${r.grade.scores.traction.score}, ${r.grade.scores.execution.score}, ${r.grade.scores.durability.score}, ${q(JSON.stringify(Object.fromEntries(DIMENSION_KEYS.map((k) => [k, r.grade.scores[k].reason]))))}, ${q(JSON.stringify(r.grade.caseAgainst))}, ${q(r.summary)}, ${q(JSON.stringify(r.stack))}, ${q(r.grade.modelUsed)});`,
  ];
  /* No per-juror rows to emit: one grader has a byline, not a seat. */
  return lines.join("\n");
};

/**
 * Domains come from argv or stdin, and each one's SQL is printed AS IT LANDS.
 *
 * Not buffered to the end on purpose: a run over two dozen companies takes the
 * better part of an hour, and accumulating everything in memory means one
 * failure at company twenty throws away nineteen good rankings and an hour of
 * model calls.
 */
const { opts: cache, rest: fromArgs } = parseCacheFlags(process.argv.slice(2));
const domains = fromArgs.length
  ? fromArgs
  : (await new Response(process.stdin as any).text())
      .split("\n").map((d) => d.trim()).filter((d) => d && !d.startsWith("#"));

let ranked = 0, refused = 0, failed = 0;
for (const d of domains) {
  console.error(`── ${d}`);
  try {
    const r: any = await rank(d, cache);
    if (r.refused) { console.error(`  REFUSED: ${r.refused}\n`); refused++; continue; }
    console.error(`  "${r.summary}"\n`);
    console.log(sqlFor(r));
    console.log("");
    ranked++;
  } catch (e) {
    console.error(`  FAILED: ${e}\n`);
    failed++;
  }
}
console.error(`\n═══ ${ranked} ranked · ${refused} refused · ${failed} failed ═══`);
