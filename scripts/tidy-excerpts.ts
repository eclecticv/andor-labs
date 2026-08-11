/**
 * Re-truncate excerpts that were cut mid-word, using the original text.
 *
 * The legacy import applied a hard 157-character cut plus an ellipsis, which
 * lands wherever it lands: "…the merit of that pa…", "…what still ma…". That
 * string is the card blurb AND the meta description, so the broken word is
 * what shows in a search result.
 *
 * It cannot be repaired by pattern-matching the stored string. A first attempt
 * stripped the trailing token whenever the excerpt ended in an ellipsis, and it
 * threw away perfectly good words: "…page after page of experts saying the
 * same..." became "…saying the…". Three dots there are the AUTHOR trailing off,
 * not a machine cut, and nothing in the stored value distinguishes the two.
 *
 * So it reads the source markdown instead and re-truncates on a word boundary.
 * The archive is READ-ONLY and never modified. Posts whose excerpt is not a
 * prefix of the original are left untouched — those have been edited by hand
 * since import, and this script has no business overwriting an edit.
 *
 * Idempotent: a second run finds nothing to do.
 *
 * Run with:
 *   npx sanity exec scripts/tidy-excerpts.ts --with-user-token           (dry run)
 *   npx sanity exec scripts/tidy-excerpts.ts --with-user-token -- --apply
 */
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { getCliClient } from "sanity/cli";

const client = getCliClient({ apiVersion: "2026-07-01" });
const APPLY = process.argv.includes("--apply");

const ARCHIVES = [
  "/Users/transl8r/Developer/_archive/andorlabs-site-old/src/content/blog",
  "/Users/transl8r/Developer/_archive/andor-labs-site/src/content/blog",
];

const MAX = 160;

/** Load every source excerpt/description, keyed by slug. */
function loadSources(): Map<string, string> {
  const out = new Map<string, string>();
  for (const dir of ARCHIVES) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".md"))) {
      const { data } = matter(fs.readFileSync(path.join(dir, file), "utf8"));
      const text = (data.excerpt ?? data.description ?? "").toString().trim();
      if (text) out.set(file.replace(/\.md$/, ""), text);
    }
  }
  return out;
}

/**
 * Truncate to MAX characters on a word boundary.
 *
 * The original's own trailing "..." is preserved when it fits: that is the
 * author's punctuation, not a cut.
 */
function truncateOnWord(source: string): string {
  const s = source.trim();
  if (s.length <= MAX) return s;

  const slice = s.slice(0, MAX - 1);
  // Only walk back when the cut lands INSIDE a word. Checking the character on
  // each side of the boundary is the whole trick: cutting back unconditionally
  // throws away a word that ended cleanly, which is how a first version turned
  // "…some words that they wrote…" into "…some words that they…".
  const midWord = /\w/.test(s[MAX - 2] ?? "") && /\w/.test(s[MAX - 1] ?? "");
  const body = midWord ? slice.slice(0, slice.lastIndexOf(" ")) : slice;

  // A cut that would eat most of the sentence means the source has no spaces
  // where we expected them; keep the plain slice rather than mangle it.
  const safe = body.length > 40 ? body : slice;
  // Strip trailing punctuation INCLUDING periods before appending the
  // ellipsis, or a source that already trails off yields "wrote..…".
  return `${safe.replace(/[\s.,;:!?—–-]+$/u, "")}…`;
}

/** Compare ignoring the ellipsis and trailing space, to detect a hand edit. */
const stem = (s: string) => s.replace(/(…|\.\.\.)\s*$/, "").trim();

async function main() {
  const sources = loadSources();
  const posts: { _id: string; slug: string; excerpt?: string; standfirst?: string }[] =
    await client.fetch(
      `*[_type == "post" && defined(excerpt)]{_id, "slug": slug.current, excerpt, standfirst} | order(slug asc)`,
    );

  let changed = 0;
  const skipped: string[] = [];

  for (const p of posts) {
    const source = sources.get(p.slug);
    if (!source) {
      skipped.push(`${p.slug} (no source in archive)`);
      continue;
    }
    const stored = (p.excerpt ?? "").trim();
    // Only touch a value that is still a machine truncation of the original.
    if (!stem(source).startsWith(stem(stored)) || stored.length === 0) {
      skipped.push(`${p.slug} (edited since import — left alone)`);
      continue;
    }

    const next = truncateOnWord(source);
    const patch: Record<string, string> = {};
    if (next !== stored) patch.excerpt = next;
    // standfirst was backfilled FROM excerpt, so it carries the same bad tail.
    if (p.standfirst && stem(source).startsWith(stem(p.standfirst)) && p.standfirst.trim() !== next) {
      patch.standfirst = next;
    }
    if (Object.keys(patch).length === 0) continue;

    changed++;
    console.log(`${APPLY ? "✓" : "·"} ${p.slug}`);
    if (patch.excerpt) console.log(`    …${stored.slice(-40)}\n    …${next.slice(-40)}`);
    if (APPLY) await client.patch(p._id).set(patch).commit();
  }

  for (const s of skipped) console.log(`  – skipped ${s}`);
  console.log(
    changed === 0
      ? "\nNothing to do — every excerpt already ends on a whole word."
      : `\n${APPLY ? `Tidied ${changed} post(s).` : `${changed} post(s) would change. Re-run with -- --apply to write.`}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
