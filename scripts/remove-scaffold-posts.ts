/**
 * Remove the three scaffold posts that were imported by mistake.
 *
 * WHY THIS EXISTS
 * ---------------
 * `import-remaining-posts.ts` pulled three posts out of
 * `_archive/andor-labs-site`, on the reading that "import all the posts from
 * the previous website" covered every archive that had a blog directory.
 *
 * It did not. That repo was never the live site, and its blog was a scaffold:
 * its own creating commit (30c4857) describes the contents as
 *
 *     "1 live flagship post (from approved homepage thesis) + 2 drafts pending
 *      CEO/VJ topic sign-off on ANDAA-12"
 *
 * — machine-written starter content, two pieces of it explicitly waiting on
 * VJ's approval. A later commit flipped `draft: false`, which is why the
 * importer's draft guard did not catch them: it tested the frontmatter flag
 * instead of asking whether the words were ever VJ's.
 *
 * The eleven posts from `_archive/andorlabs-site-old` are the real previous
 * website and are untouched by this script.
 *
 * REVERSIBLE
 * ----------
 * The source markdown is still in `_archive/andor-labs-site`, unmodified. To
 * put these back, run `import-remaining-posts.ts` again.
 *
 * Run with:
 *   npx sanity exec scripts/remove-scaffold-posts.ts --with-user-token
 */
import { getCliClient } from "sanity/cli";

const client = getCliClient({ apiVersion: "2026-07-01" });

const SCAFFOLD_SLUGS = [
  "content-engineering-not-content-marketing",
  "distribution-is-the-new-moat",
  "human-in-the-loop-is-the-moat",
];

async function main() {
  const ids = SCAFFOLD_SLUGS.map((s) => `post-${s}`);

  // A document that something else references cannot be deleted, and the error
  // Sanity returns names the id rather than the title — so check first and say
  // which post is holding the reference.
  const referrers: { _id: string; title: string; refs: string[] }[] = await client.fetch(
    `*[_type == "post" && !(_id in $ids) && count(relatedPosts[._ref in $ids]) > 0]{
      _id, title, "refs": relatedPosts[._ref in $ids]._ref
    }`,
    { ids },
  );

  if (referrers.length > 0) {
    console.log("Blocked — these posts still reference the scaffold posts:");
    for (const r of referrers) console.log(`  - ${r.title} (${r._id}) → ${r.refs.join(", ")}`);
    console.log("\nClear those relatedPosts entries first. Nothing was deleted.");
    process.exit(1);
  }

  const existing: { _id: string; title: string }[] = await client.fetch(
    `*[_id in $ids]{_id, title}`,
    { ids },
  );

  if (existing.length === 0) {
    console.log("Nothing to remove — none of the scaffold posts are present.");
    return;
  }

  for (const doc of existing) {
    await client.delete(doc._id);
    console.log(`✓ deleted ${doc._id}  (${doc.title})`);
  }

  const remaining = await client.fetch<number>(`count(*[_type == "post"])`);
  console.log(`\nRemoved ${existing.length}. ${remaining} posts remain.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
