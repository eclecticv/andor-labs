/**
 * One-time migration: backfill `author` and `standfirst` on the posts that
 * predate both fields. Both are now required by the schema, so without this
 * every legacy post fails validation the moment it is opened in Studio.
 *
 * Run with:
 *   npx sanity exec scripts/migrate-add-standfirst.ts --with-user-token
 *
 * Idempotent: it QUERIES for posts missing each field rather than working from
 * a hardcoded list, so re-running is a no-op once the gap is closed and it
 * stays correct as posts are added.
 *
 * Two deliberate choices, both of which matter:
 *
 * 1. `client.patch(id).set(…)` — NOT createOrReplace. Other scripts in this
 *    migration (enrich-bodies, backfill-heroes) patch *different* fields on
 *    these same documents; a full replace would silently clobber whichever ran
 *    first. Patch only touches the keys named here.
 *
 * 2. `standfirst` is set to the post's EXISTING `excerpt`, verbatim. VJ's rule
 *    for this migration is "enrich, don't rewrite — zero words added". The old
 *    template rendered `excerpt` directly under the H1, so copying it across
 *    reproduces exactly the text the live page already shows. Writing fresh
 *    standfirst prose here would put words on the site that nobody approved,
 *    inside a script whose job is a schema migration. Do not paraphrase,
 *    expand, or "improve" it. If a standfirst deserves better copy, that is an
 *    editorial pass in Studio, not a line of code in here.
 */
import { getCliClient } from "sanity/cli";

const AUTHOR_ID = "author-vishveshwar-jatain";

const client = getCliClient({ apiVersion: "2026-07-01" });

interface PostRow {
  _id: string;
  slug: string | null;
  excerpt: string | null;
  hasAuthor: boolean;
  hasStandfirst: boolean;
}

const QUERY = `*[_type == "post" && (!defined(author) || !defined(standfirst))]{
  _id,
  "slug": slug.current,
  excerpt,
  "hasAuthor": defined(author),
  "hasStandfirst": defined(standfirst)
} | order(slug asc)`;

async function main() {
  const posts: PostRow[] = await client.fetch(QUERY);

  console.log(`${posts.length} posts missing author and/or standfirst.`);
  if (posts.length === 0) {
    console.log("Nothing to do — every post already carries both fields.");
    return;
  }

  const noExcerpt: string[] = [];
  let authorsSet = 0;
  let standfirstsSet = 0;

  for (const post of posts) {
    const fields: Record<string, unknown> = {};

    if (!post.hasAuthor) {
      fields.author = { _type: "reference", _ref: AUTHOR_ID };
      authorsSet += 1;
    }

    if (!post.hasStandfirst) {
      const excerpt = post.excerpt?.trim();
      if (!excerpt) {
        // Nothing to copy from, and inventing prose is exactly what this
        // migration must not do. Report it and leave it for a human.
        noExcerpt.push(post.slug ?? post._id);
      } else {
        fields.standfirst = excerpt;
        standfirstsSet += 1;
      }
    }

    if (Object.keys(fields).length === 0) continue;

    await client.patch(post._id).set(fields).commit();
    console.log(`✓ ${post._id}  (${Object.keys(fields).join(", ")})`);
  }

  if (noExcerpt.length > 0) {
    console.log("\nNo excerpt to copy — standfirst left unset, needs a human:");
    for (const slug of noExcerpt) console.log(`  - ${slug}`);
  }

  console.log(`\nDone. Set author on ${authorsSet}, standfirst on ${standfirstsSet}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
