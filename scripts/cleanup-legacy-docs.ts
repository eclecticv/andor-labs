/**
 * Delete the orphaned March-2026 documents from the previous site build.
 *
 * These predate the current `post` schema and nothing in the site reads them:
 * 12 `blogPost`, 6 page singletons (home/about/build/enable/portfolio/transform)
 * and 6 `testimonial`. All were exported to
 * ~/Documents/Inbox/sanity-legacy-2026-03/ first — markdown per post plus a
 * lossless `_raw-all-documents.json`.
 *
 * CUT-OFF IS LOAD-BEARING. `blogPost` is not purely legacy: AirOps created
 * three more on 2026-08-12, each a complete 1,833-word article, and deleting a
 * finished article as though it were 2026 cruft is not a mistake worth risking.
 * Anything created on or after the cut-off is excluded and reported, not
 * deleted.
 *
 * Dry run by default.
 *
 * Run with:
 *   npx sanity exec scripts/cleanup-legacy-docs.ts --with-user-token
 *   npx sanity exec scripts/cleanup-legacy-docs.ts --with-user-token -- --apply
 */
import { getCliClient } from "sanity/cli";

const client = getCliClient({ apiVersion: "2026-07-01" });
const APPLY = process.argv.includes("--apply");

/** Everything created before this is the old site. Everything after is current. */
const CUTOFF = "2026-04-01T00:00:00Z";

const LEGACY_TYPES = [
  "blogPost",
  "homePage",
  "aboutPage",
  "buildPage",
  "enablePage",
  "portfolioPage",
  "transformPage",
  "testimonial",
];

async function main() {
  const params = { types: LEGACY_TYPES, cutoff: CUTOFF };

  const doomed: { _id: string; _type: string; _createdAt: string; title?: string }[] =
    await client.fetch(
      `*[_type in $types && _createdAt < $cutoff] | order(_type asc, _createdAt asc){
        _id, _type, _createdAt, "title": coalesce(title, name, "(untitled)")
      }`,
      params,
    );

  const spared: { _id: string; _type: string; _createdAt: string; title?: string }[] =
    await client.fetch(
      `*[_type in $types && _createdAt >= $cutoff]{
        _id, _type, _createdAt, "title": coalesce(title, name, "(untitled)")
      }`,
      params,
    );

  const referenced: number = await client.fetch(
    `count(*[references(*[_type in $types && _createdAt < $cutoff]._id)])`,
    params,
  );
  if (referenced > 0) {
    console.error(`✖ ${referenced} document(s) reference something in this set. Refusing to delete.`);
    process.exit(1);
  }

  const byType = doomed.reduce<Record<string, number>>((acc, d) => {
    acc[d._type] = (acc[d._type] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`${doomed.length} legacy documents (created before ${CUTOFF.slice(0, 10)}):`);
  for (const [t, n] of Object.entries(byType)) console.log(`   ${t.padEnd(16)} ${n}`);

  if (spared.length > 0) {
    console.log(`\n${spared.length} document(s) of these types are NEWER than the cut-off and are NOT touched:`);
    for (const s of spared) console.log(`   ${s._type}  ${s._createdAt.slice(0, 19)}  ${s.title}`);
  }

  if (!APPLY) {
    console.log(`\nDry run. Re-run with -- --apply to delete the ${doomed.length}.`);
    return;
  }

  let tx = client.transaction();
  for (const d of doomed) tx = tx.delete(d._id);
  await tx.commit();

  const remaining: Record<string, number> = await client.fetch(
    `{"post": count(*[_type=="post"]), "author": count(*[_type=="author"]),
      "blogPost": count(*[_type=="blogPost"]), "assets": count(*[_type=="sanity.imageAsset"])}`,
  );
  console.log(`\nDeleted ${doomed.length}. Remaining: ${JSON.stringify(remaining)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
