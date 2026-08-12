/**
 * Delete the stub `post` documents AirOps created on 2026-08-12.
 *
 * They look blank in Studio — `title` is undefined, so the preview renders
 * "Untitled" for all 99 — but they are NOT empty: each carries a `targetQuery`
 * holding one or more SEO keywords. That is a content plan, and it was exported
 * to ~/Documents/Inbox/airops-content-plan.{md,csv} before anything here ran.
 * Do not run this without that export in hand.
 *
 * The predicate is deliberately narrow: a post with no body AND no title AND no
 * slug. Note that `count(body) == 0` does NOT select these — `body` is
 * undefined rather than an empty array, so the count is null and the comparison
 * never matches. `!defined(body)` is the one that works.
 *
 * Dry run by default. Prints the full set before writing anything.
 *
 * Run with:
 *   npx sanity exec scripts/cleanup-airops-stubs.ts --with-user-token
 *   npx sanity exec scripts/cleanup-airops-stubs.ts --with-user-token -- --apply
 */
import { getCliClient } from "sanity/cli";

const client = getCliClient({ apiVersion: "2026-07-01" });
const APPLY = process.argv.includes("--apply");

const STUBS = `*[_type == "post" && !defined(body) && !defined(title) && !defined(slug.current)]`;

async function main() {
  const stubs: { _id: string; targetQuery?: string; _createdAt: string }[] = await client.fetch(
    `${STUBS} | order(_createdAt asc) { _id, targetQuery, _createdAt }`,
  );

  if (stubs.length === 0) {
    console.log("Nothing to do — no stub posts found.");
    return;
  }

  // Refuse to run if the guard rails do not hold. A predicate that starts
  // matching real posts would be catastrophic and silent.
  const realPosts: number = await client.fetch(`count(*[_type == "post" && defined(body)])`);
  const referenced: number = await client.fetch(`count(*[references(${STUBS}._id)])`);

  console.log(`${stubs.length} stub posts; ${realPosts} real posts would remain.`);
  if (referenced > 0) {
    console.error(`✖ ${referenced} document(s) reference a stub. Refusing to delete.`);
    process.exit(1);
  }
  if (realPosts !== 11) {
    console.error(`✖ Expected 11 real posts, found ${realPosts}. Refusing to delete — check the predicate.`);
    process.exit(1);
  }

  for (const s of stubs) {
    console.log(`${APPLY ? "✓" : "·"} ${s._id}  ${s.targetQuery ?? "(no targetQuery)"}`);
  }

  if (!APPLY) {
    console.log(`\n${stubs.length} would be deleted. Re-run with -- --apply to write.`);
    return;
  }

  // Batched: 99 individual deletes is 99 round trips and 99 chances to fail
  // halfway. One transaction either lands or does not.
  let tx = client.transaction();
  for (const s of stubs) tx = tx.delete(s._id);
  await tx.commit();

  const left: number = await client.fetch(`count(*[_type == "post"])`);
  console.log(`\nDeleted ${stubs.length}. ${left} post documents remain.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
