/**
 * How repeatable is the grader?
 *
 * A leaderboard that cannot answer this is not measuring anything. Two checks,
 * both self-contained — neither needs a hand-scored ground truth, so both can
 * run today and on every rubric change afterwards.
 *
 *   test-retest    Grade the SAME snapshot N times. Temperature is 0, so the
 *                  only variance is the model's own non-determinism. Anything
 *                  above zero here is noise being published as a score.
 *
 *   perturbation   Grade a REWORDED copy of the same snapshot. The company has
 *                  not changed, so the grade should not either. This catches a
 *                  rubric that is reading prose style rather than evidence —
 *                  which is exactly what the removed `case_against` block was
 *                  doing when it moved both test companies by 0.6.
 *
 * Reads snapshots straight from D1, so it grades the EXACT bytes the live rows
 * were graded from rather than re-crawling into a moving target.
 *
 *   set -a; . ./.dev.vars; set +a
 *   npx tsx scripts/grader-reliability.mts              # every stored snapshot
 *   npx tsx scripts/grader-reliability.mts nexx360.io --runs=5
 *
 * Exits non-zero when a threshold is breached, so this is CI-shaped.
 */
import {
  runGrader, gradeOf, DIMENSION_KEYS, rubricVersion, type Grade,
} from "../functions/_lib/grader";
import { CATEGORIES, CATEGORY_NOT } from "../functions/_lib/classify";

const env = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  NVIDIA_API_KEY: process.env.NVIDIA_API_KEY,
  OPENCODE_API_KEY: process.env.OPENCODE_API_KEY,
};

/**
 * What counts as acceptable.
 *
 * Deliberately strict, and deliberately stated as numbers rather than left to a
 * reader's judgement of the output. A threshold nobody wrote down is a
 * threshold that moves.
 */
const MAX_RETEST_SPREAD = 0.4;   // grade points across identical runs
const MAX_PERTURB_DELTA = 0.4;   // grade points against a reworded input

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID ?? "63956fb1f50aec70801897b5de548e8d";
const DATABASE = process.env.CLOUDFLARE_D1_DATABASE ?? "662a14cc-7ed7-47d0-9dbb-a0e10d95ff43";

async function d1<T>(sql: string): Promise<T[]> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DATABASE}/query`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.CLOUDFLARE_D1_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ sql }),
    },
  );
  const body = await res.json() as any;
  if (!body.success) throw new Error(`D1: ${JSON.stringify(body.errors)}`);
  return body.result[0].results as T[];
}

/**
 * Reword without changing a single fact.
 *
 * Mechanical on purpose. An LLM paraphrase would introduce its own reading of
 * the page, and then a moved grade could not be blamed on the rubric. These
 * substitutions alter surface form only: contractions, filler, and the
 * marketing intensifiers a scorer should be immune to by design.
 */
function perturb(text: string): string {
  const swaps: [RegExp, string][] = [
    [/\bcutting-edge\b/gi, "modern"],
    [/\bstate-of-the-art\b/gi, "current"],
    [/\bseamless(ly)?\b/gi, "direct"],
    [/\bpowerful\b/gi, "capable"],
    [/\bindustry-leading\b/gi, "established"],
    [/\bbest-in-class\b/gi, "competent"],
    [/\brobust\b/gi, "stable"],
    [/\binnovative\b/gi, "new"],
    [/\bunlock\b/gi, "obtain"],
    [/\beffortless(ly)?\b/gi, "easily"],
    [/\bworld-class\b/gi, "experienced"],
  ];
  let out = text;
  for (const [re, to] of swaps) out = out.replace(re, to);
  return out;
}

const vec = (g: Grade) => DIMENSION_KEYS.map((k) => g.scores[k].score);
const meanOf = (g: Grade) =>
  gradeOf(Object.fromEntries(DIMENSION_KEYS.map((k) => [k, g.scores[k].score])) as any);

async function grade(domain: string, pages: string): Promise<Grade> {
  return runGrader(env as any, {
    domain, pages, thin: false,
    categories: CATEGORIES, categoryNotes: CATEGORY_NOT,
  });
}

// ── Run ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const runs = Number(args.find((a) => a.startsWith("--runs="))?.split("=")[1] ?? 3);
const only = args.filter((a) => !a.startsWith("--"));

const rows = await d1<{ domain: string; pages: string; hash: string }>(
  `SELECT s.domain, s.pages, s.hash FROM snapshot s
   ${only.length ? `WHERE s.domain IN (${only.map((d) => `'${d.replace(/'/g, "''")}'`).join(",")})` : ""}
   GROUP BY s.domain`,
);

if (!rows.length) {
  console.error("No snapshots stored. Rank something first.");
  process.exit(1);
}

console.log(`rubric ${rubricVersion()} · ${rows.length} snapshot(s) · ${runs} runs each\n`);

let failures = 0;

for (const row of rows) {
  console.log(`${"═".repeat(62)}\n${row.domain}  (${row.hash.slice(0, 12)}…)`);

  // ── test-retest ──
  const repeats: Grade[] = [];
  for (let i = 0; i < runs; i++) {
    try {
      repeats.push(await grade(row.domain, row.pages));
    } catch (err) {
      console.log(`  run ${i + 1}: FAILED — ${err instanceof Error ? err.message.slice(0, 90) : err}`);
    }
  }
  if (repeats.length < 2) {
    console.log("  not enough successful runs to measure repeatability\n");
    failures++;
    continue;
  }

  const means = repeats.map(meanOf);
  const spread = Math.max(...means) - Math.min(...means);
  const publishRate = `${repeats.length}/${runs}`;
  console.log(`  test-retest   ${means.map((m) => m.toFixed(1)).join("  ")}   spread ${spread.toFixed(1)}`);
  for (const [i, g] of repeats.entries()) console.log(`    run ${i + 1}  ${vec(g).join(" ")}`);
  console.log(`    published ${publishRate}`);
  if (spread > MAX_RETEST_SPREAD) {
    console.log(`    ✗ spread ${spread.toFixed(1)} exceeds ${MAX_RETEST_SPREAD}`);
    failures++;
  } else {
    console.log(`    ✓ within ${MAX_RETEST_SPREAD}`);
  }

  // ── perturbation ──
  const reworded = perturb(row.pages);
  if (reworded === row.pages) {
    console.log("  perturbation  skipped — no marketing filler to swap\n");
    continue;
  }
  try {
    const after = meanOf(await grade(row.domain, reworded));
    const base = means.reduce((a, b) => a + b, 0) / means.length;
    const delta = Math.abs(after - base);
    console.log(`  perturbation  ${base.toFixed(1)} → ${after.toFixed(1)}   delta ${delta.toFixed(1)}`);
    if (delta > MAX_PERTURB_DELTA) {
      console.log(`    ✗ reworded copy moved the grade ${delta.toFixed(1)} — the rubric is reading style`);
      failures++;
    } else {
      console.log(`    ✓ within ${MAX_PERTURB_DELTA}`);
    }
  } catch (err) {
    console.log(`  perturbation  FAILED — ${err instanceof Error ? err.message.slice(0, 90) : err}`);
    failures++;
  }
  console.log();
}

console.log(`${"═".repeat(62)}\n${failures ? `${failures} threshold breach(es)` : "all thresholds met"}`);
process.exit(failures ? 1 : 0);
