/**
 * Post-migration tidy-up. Run once, after `migrate-categories-and-authors.ts`.
 *
 * Sets `kind: "person"` on any author document that has none. `initialValue`
 * only applies to documents created after a field exists, so the human author
 * — which predates `kind` — reads back null. The templates already default a
 * null kind to person, so nothing is broken; this makes the stored data say
 * what the site is already assuming, which is worth doing before someone
 * writes a query that trusts the field.
 *
 * Idempotent. Reports and changes nothing when there is nothing to do.
 *
 * Run with:
 *   npx sanity exec scripts/finalise-schema.ts --with-user-token
 */
import { getCliClient } from "sanity/cli";

const client = getCliClient({ apiVersion: "2026-07-01" });

async function main() {
  const authors: { _id: string; name: string }[] = await client.fetch(
    `*[_type == "author" && !defined(kind)]{_id, name} | order(name asc)`,
  );

  if (authors.length === 0) {
    console.log("Nothing to do — every author already declares a kind.");
  } else {
    for (const a of authors) {
      await client.patch(a._id).set({ kind: "person" }).commit();
      console.log(`✓ ${a._id}  kind = person  (${a.name})`);
    }
  }

  // Report the state the schema's `required()` rules now depend on, so a
  // failure here is visible before an editor meets it in Studio.
  const audit = await client.fetch<{
    posts: number;
    noCategory: number;
    noAuthors: number;
    noKind: number;
  }>(`{
    "posts": count(*[_type == "post"]),
    "noCategory": count(*[_type == "post" && !defined(category)]),
    "noAuthors": count(*[_type == "post" && count(authors) == 0]),
    "noKind": count(*[_type == "author" && !defined(kind)])
  }`);

  console.log(
    `\n${audit.posts} posts · ${audit.noCategory} without a category · ${audit.noAuthors} without authors · ${audit.noKind} authors without a kind`,
  );
  if (audit.noCategory || audit.noAuthors) {
    console.log("⚠️  Do NOT mark those fields required until this reads zero.");
    process.exitCode = 1;
  } else {
    console.log("Safe to mark category and authors required.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
