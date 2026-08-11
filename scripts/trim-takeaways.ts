/**
 * Trim every post's `keyTakeaways` to three.
 *
 * The gist box is a summary, not an outline: three lines is the house rule.
 * The schema now caps at three, so documents still carrying five would show a
 * validation error in Studio even though the page only renders the first three.
 * This brings the stored data in line with both.
 *
 * The dropped entries were sentences lifted verbatim from each post's own
 * prose, so nothing original is lost — they are still in the body, and
 * `enrich-bodies.ts` can regenerate a fresh set if the rule ever changes.
 *
 * Idempotent: posts already at three or fewer are skipped.
 *
 * Run with:
 *   npx sanity exec scripts/trim-takeaways.ts --with-user-token
 */
import { getCliClient } from "sanity/cli";

const client = getCliClient({ apiVersion: "2026-07-01" });
const LIMIT = 3;

async function main() {
  const posts: { _id: string; title: string; keyTakeaways?: string[] }[] = await client.fetch(
    `*[_type == "post" && count(keyTakeaways) > $limit]{_id, title, keyTakeaways}`,
    { limit: LIMIT },
  );

  if (posts.length === 0) {
    console.log(`Nothing to do — every post is already at ${LIMIT} takeaways or fewer.`);
    return;
  }

  for (const p of posts) {
    const kept = (p.keyTakeaways ?? []).slice(0, LIMIT);
    await client.patch(p._id).set({ keyTakeaways: kept }).commit();
    console.log(`✓ ${p._id}  ${p.keyTakeaways?.length} → ${kept.length}`);
  }

  console.log(`\nTrimmed ${posts.length} post(s) to ${LIMIT}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
