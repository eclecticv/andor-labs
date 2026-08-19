/**
 * Re-look-up one company's third-party facts and emit the UPDATE, nothing else.
 *
 * ── Why this is not `rank-local.mts` ──
 * On 2026-08-19 confiant.com was published carrying another company's facts —
 * "Confiant Solutions", an Indian IT-training consultancy — because the Exa
 * query led with the company NAME and nothing checked the answer against the
 * domain that had been crawled. The datasheet was wrong; the panel was not. All
 * three jurors reasoned about the real Confiant, citing eGobbler, SourTrade and
 * a decade of named campaigns, and never once repeated the wrong facts back.
 *
 * A full re-rank would therefore fix a datasheet by regenerating a verdict that
 * was not broken — and measurably would not improve it. Three panels run on one
 * corpus that day (`.scratch/facts-experiment/`) scored the same company 21, 22
 * and 20 while varying only the facts, with two of those runs given BYTE
 * IDENTICAL input. Individual seat scores moved three points between them. A
 * re-rank draws one more sample from that distribution and rewrites a verdict
 * written at temperature 0.8 to do it.
 *
 * So: re-run `lookupCompany` alone, and touch only the four columns it owns.
 * `ranking` and `panel_take` are not referenced by this script at all.
 *
 * ── Usage ──
 *   set -a; . ./.dev.vars; set +a
 *   npx tsx scripts/refresh-facts.mts confiant.com "Confiant" > /tmp/facts.sql
 *   # read the stderr summary against the real company, THEN:
 *   npx wrangler d1 execute andor-rankings -c d1.wrangler.jsonc --remote \
 *     --file /tmp/facts.sql -y
 *
 * Exits 1 and emits NO SQL when the lookup is refused, which is the whole point:
 * the failure being fixed is a wrong row, so the script must never be able to
 * write a second one.
 */
import { lookupCompany, divisionFor } from "../functions/_lib/facts";

const q = (v: unknown) =>
  v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`;

const [domain, name] = process.argv.slice(2);
if (!domain || !name) {
  console.error("usage: refresh-facts.mts <domain> <company name>");
  process.exit(2);
}

const facts = await lookupCompany({ EXA_API_KEY: process.env.EXA_API_KEY }, domain, name);

if (!facts) {
  console.error(
    `\n  REFUSED — no usable facts for ${domain}.\n` +
    `  The lookup either failed or was rejected by the grounding / domain gate;\n` +
    `  the reason is on the [facts] warning above. No SQL emitted, by design.\n`,
  );
  process.exit(1);
}

const division = divisionFor(facts.headcountRange);
const cites = [...new Set(
  Object.values(facts.sources).flat().filter((u): u is string => !!u).map((u) => {
    try { return new URL(u).host; } catch { return u; }
  }),
)];

console.error(`
── ${domain}
  official   ${facts.officialWebsite || "(not returned)"}
  does       ${facts.whatTheyDo}
  serves     ${facts.serves.join(", ") || "—"}
  founded    ${facts.foundedYear || "NOT ESTABLISHED"}
  size       ${facts.headcountRange || "?"} → ${division ?? "unclassed"}
  based      ${[facts.hqCity, facts.hqCountry].filter(Boolean).join(", ") || "—"}
  funding    ${facts.totalFundingUsd ? `$${(facts.totalFundingUsd / 1e6).toFixed(1)}M` : "—"} ${facts.lastFunding}
  grounded   ${Object.keys(facts.sources).length} fields — ${cites.join(", ")}
  cost       $${facts.costUsd}

  Read the above against the company you MEANT before applying.
`);

console.log(`-- ${domain} — facts re-looked-up under the domain-anchored query.
-- lookupCompany only. ranking and panel_take are untouched by design.
UPDATE company
   SET facts_json   = ${q(JSON.stringify(facts))},
       founded_year = ${facts.foundedYear || "NULL"},
       division     = ${q(division)},
       headcount    = ${q(facts.headcountRange || null)}
 WHERE domain = ${q(domain)};`);
