/**
 * One-time migration: give every existing post a `category`, and copy the legacy
 * singular `author` reference into the new `authors` array.
 *
 * Run with:
 *   npx sanity exec scripts/migrate-categories-and-authors.ts --with-user-token
 *
 * Idempotent, on the same model as migrate-add-standfirst.ts: it QUERIES for the
 * posts missing each field rather than working from a hardcoded list, so a
 * second run finds nothing and a post added tomorrow is still handled correctly.
 *
 * Four deliberate choices, all of which matter:
 *
 * 1. `client.patch(id).set(…)` — NOT createOrReplace. enrich-bodies.ts and
 *    backfill-heroes.ts patch *different* fields on these same documents; a full
 *    replace would silently clobber whichever ran first. Patch only touches the
 *    keys named here.
 *
 * 2. `author` (singular) is never written, never unset, never read for anything
 *    but its `_ref`. It stays on every document as the rollback path: revert the
 *    template code and the old byline still resolves. Removing it is a separate,
 *    later, deliberate act.
 *
 * 3. Missing category becomes `field-notes`, not a guess at what each post is.
 *    All 11 existing posts are VJ's handwritten archive, which is exactly what
 *    that category means. Some of them are arguably explainers; re-filing those
 *    is an editorial judgement made in Studio by the person who wrote them, not
 *    a heuristic in a migration script.
 *
 * 4. The array `_key` is DERIVED FROM THE REF ID, not randomUUID(). A random key
 *    would make a second run produce a different array for the same input, which
 *    turns "idempotent" into "silently rewrites history". A *missing* key is
 *    worse still: Studio throws "Missing keys" and drag-reorder breaks.
 *
 * A post with no category and no author reference to copy is reported and left
 * alone — same posture as the `noExcerpt` branch in migrate-add-standfirst.ts.
 * Inventing a byline is the one thing this script must never do.
 */
import { getCliClient } from "sanity/cli";

const DEFAULT_CATEGORY = "field-notes";

const client = getCliClient({ apiVersion: "2026-07-01" });

interface PostRow {
  _id: string;
  slug: string | null;
  hasCategory: boolean;
  hasAuthors: boolean;
  authorRef: string | null;
}

const QUERY = `*[_type == "post" && (!defined(category) || !defined(authors))]{
  _id,
  "slug": slug.current,
  "hasCategory": defined(category),
  "hasAuthors": defined(authors),
  "authorRef": author._ref
} | order(slug asc)`;

/**
 * Deterministic array key for a reference: the ref id with everything that is
 * not alphanumeric stripped out. Stable across runs, unique within the array
 * because a document cannot be referenced twice by the same id and mean two
 * different bylines.
 */
function keyForRef(ref: string): string {
  return ref.replace(/[^a-zA-Z0-9]/g, "");
}

async function main() {
  const posts: PostRow[] = await client.fetch(QUERY);

  console.log(`${posts.length} posts missing category and/or authors.`);
  if (posts.length === 0) {
    console.log("Nothing to do — every post already carries both fields.");
    return;
  }

  const noAuthorRef: string[] = [];
  let categoriesSet = 0;
  let authorsSet = 0;

  for (const post of posts) {
    const fields: Record<string, unknown> = {};

    if (!post.hasCategory) {
      fields.category = DEFAULT_CATEGORY;
      categoriesSet += 1;
    }

    if (!post.hasAuthors) {
      if (!post.authorRef) {
        // Nothing to copy from, and inventing a byline is exactly what this
        // migration must not do. Report it and leave it for a human.
        noAuthorRef.push(post.slug ?? post._id);
      } else {
        fields.authors = [
          {
            _key: keyForRef(post.authorRef),
            _type: "reference",
            _ref: post.authorRef,
          },
        ];
        authorsSet += 1;
      }
    }

    if (Object.keys(fields).length === 0) continue;

    await client.patch(post._id).set(fields).commit();
    console.log(`✓ ${post._id}  (${Object.keys(fields).join(", ")})`);
  }

  if (noAuthorRef.length > 0) {
    console.log("\nNo author reference to copy — authors left unset, needs a human:");
    for (const slug of noAuthorRef) console.log(`  - ${slug}`);
  }

  console.log(`\nDone. Set category on ${categoriesSet}, authors on ${authorsSet}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
