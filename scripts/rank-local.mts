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
 */
import { readSite } from "../functions/_lib/crawl";
import { detectStack, byCategory } from "../functions/_lib/stack";
import { resolveLogo } from "../functions/_lib/logo";

import {
  buildIdentifyPrompt, normalizeIdentity, assertIdentityUsable,
  place, placeFromMarkup, sideFor, cohortLabel, categoryLabel, categoryFor,
  CATEGORIES, CATEGORY_NOT,
} from "../functions/_lib/classify";
import { runPanel, resolveRecall, WRITER } from "../functions/_lib/panel";
import { buildWriterPrompt, normalizeSummary, assertSummaryUsable } from "../functions/_lib/writer";
import { askLadder, extractJson, keyFor, type Provider } from "../functions/_lib/providers";

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

async function rank(domain: string) {
  const t0 = Date.now();
  const site = await readSite(domain, CONTEXT_DEV_API_KEY);
  if (!site.pages) throw new Error("read failed");
  // Same floor as the live Function: under 1,500 chars of real corpus, refuse
  // before the identify call rather than feed a model a page shell (or, once,
  // an unstripped CSS blob) and let it guess.
  const corpus = site.pages.replace(/^## .*$/gm, "").replace(/\s+/g, " ").trim();
  if (corpus.length < 1_500) throw new Error(`read failed — only ${corpus.length} chars of real corpus`);
  console.error(`  read ${site.pages.length} chars`);

  const detected = detectStack(site.html);

  let identity;
  // OpenCode Go leads — mirrors the Function's order so a local re-run seats
  // the same identifier the live pipeline would.
  for (const provider of ["opencode", "gemini", "nvidia"] as Provider[]) {
    if (!keyFor(provider, env)) continue;
    try {
      const { value } = await askLadder(provider, env, buildIdentifyPrompt(domain, site.pages, site.thin),
        (t) => assertIdentityUsable(normalizeIdentity(extractJson(t))));
      identity = value;
      break;
    } catch (e) { console.error(`  identify ${provider}: ${e}`); }
  }
  if (!identity) throw new Error("identify failed");
  if (!identity.eligible) return { refused: identity.ineligibleReason, domain };
  console.error(`  ${identity.name} — ${identity.category} — model stage "${identity.stage}"`);

  const markup = placeFromMarkup(site.html, site.pages);
  if (markup.isPublic) return { refused: `Public company — ${markup.isPublic}.`, domain };

  const panel = await runPanel(env, {
    domain, pages: site.pages, thin: site.thin, categories: CATEGORIES, categoryNotes: CATEGORY_NOT,
  });

  const recall = resolveRecall(panel.takes);
  const category = categoryFor(domain, recall.category, identity.category);
  const placement = place(site.html, site.pages, identity.stage, recall);
  if (!placement.eligible) return { refused: placement.reason, domain };
  const side = sideFor(category);
  const cohort = cohortLabel(placement.band, side);
  console.error(`  ${cohort} · ${category} (cat ${recall.categoryVotes}/3, round ${recall.round||"none"} ${recall.roundVotes}/3) — ${placement.bandEvidence}`);
  console.error(`  ${panel.total}/30 — ${panel.takes.map((t) => `${t.panelistId} ${t.ratings.innovation.score}/${t.ratings.difficulty.score}/${t.ratings.investability.score}`).join("  ")}`);
  if (panel.split) console.error(`  SPLIT on ${panel.split.question} by ${panel.split.spread}`);

  const { value: summary } = await askLadder(WRITER.provider, env,
    buildWriterPrompt({ name: identity.name, oneLiner: identity.oneLiner,
      categoryLabel: categoryLabel(category), cohort, panel }),
    (t) => assertSummaryUsable(normalizeSummary(extractJson(t))),
    { preferred: WRITER.model, temperature: 0.8 });

  const logo = (await resolveLogo(site.html, site.finalUrl))?.url ?? null;
  const slug = slugify(identity.name) || slugify(domain);
  console.error(`  done in ${Math.round((Date.now() - t0) / 1000)}s\n`);

  return {
    domain, slug, identity, placement, side, cohort, panel, summary, logo, category,
    stack: byCategory(detected), thin: site.thin,
  };
}

const sqlFor = (r: any) => {
  const lines = [
    `DELETE FROM company WHERE domain = ${q(r.domain)} AND id NOT IN (SELECT company_id FROM ranking);`,
    `INSERT INTO company (domain, name, slug, logo_url, one_liner, division, category, stage, band, side, band_evidence, band_inferred, provisional)
 VALUES (${q(r.domain)}, ${q(r.identity.name)}, ${q(r.slug)}, ${q(r.logo)}, ${q(r.identity.oneLiner)}, 'middleweight', ${q(r.category)}, ${q(r.identity.stage)}, ${q(r.placement.band)}, ${q(r.side)}, ${q(r.placement.bandEvidence)}, ${r.placement.bandInferred ? 1 : 0}, ${r.thin ? 1 : 0});`,
    `INSERT INTO ranking (company_id, total, innovation, difficulty, investability, split_question, split_spread, summary, stack_json)
 VALUES ((SELECT id FROM company WHERE domain = ${q(r.domain)}), ${r.panel.total}, ${r.panel.means.innovation}, ${r.panel.means.difficulty}, ${r.panel.means.investability}, ${q(r.panel.split?.question ?? null)}, ${r.panel.split?.spread ?? 0}, ${q(r.summary)}, ${q(JSON.stringify(r.stack))});`,
  ];
  for (const t of r.panel.takes) {
    lines.push(
      `INSERT INTO panel_take (ranking_id, panelist_id, model_used, innovation, difficulty, investability, ratings_json, adjective)
 VALUES ((SELECT r.id FROM ranking r JOIN company c ON c.id = r.company_id WHERE c.domain = ${q(r.domain)}), ${q(t.panelistId)}, ${q(t.modelUsed)}, ${t.ratings.innovation.score}, ${t.ratings.difficulty.score}, ${t.ratings.investability.score}, ${q(JSON.stringify(t.ratings))}, ${q(t.adjective)});`,
    );
  }
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
const fromArgs = process.argv.slice(2);
const domains = fromArgs.length
  ? fromArgs
  : (await new Response(process.stdin as any).text())
      .split("\n").map((d) => d.trim()).filter((d) => d && !d.startsWith("#"));

let ranked = 0, refused = 0, failed = 0;
for (const d of domains) {
  console.error(`── ${d}`);
  try {
    const r: any = await rank(d);
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
