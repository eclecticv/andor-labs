/**
 * One-time migration: import the 3 remaining blog posts that never made it into
 * the first seed, because they sit in a *different* archived repo under a
 * different frontmatter shape.
 *
 * Source (READ-ONLY, never modified):
 *   /Users/transl8r/Developer/_archive/andor-labs-site/src/content/blog/*.md
 *
 * Run with:
 *   npx sanity exec scripts/import-remaining-posts.ts --with-user-token
 *
 * Idempotent: deterministic `_id: post-<slug>` + createOrReplace, same as
 * seed-blog.ts, so re-running updates rather than duplicating.
 *
 * Frontmatter differences from the seeded set, and how they map:
 *   description → standfirst (verbatim, in full) AND excerpt (truncated to 160)
 *   pubDate     → publishedAt (ISO)
 *   draft       → posts with draft: true are skipped and reported
 */
import fs from "node:fs";
import path from "node:path";
import { getCliClient } from "sanity/cli";
import matter from "gray-matter";
import { marked } from "marked";
import { JSDOM } from "jsdom";
import { htmlToBlocks } from "@sanity/block-tools";
import { Schema } from "@sanity/schema";
import { schemaTypes } from "../sanity/schemaTypes";

const ARCHIVE_BLOG_DIR =
  "/Users/transl8r/Developer/_archive/andor-labs-site/src/content/blog";

const AUTHOR_ID = "author-vishveshwar-jatain";

const client = getCliClient({ apiVersion: "2026-07-01" });

// Compile the project schema so block-tools knows the shape of `post.body`.
const compiledSchema = Schema.compile({ name: "default", types: schemaTypes });
const postType = compiledSchema.get("post");
const bodyField = postType.fields.find((f: { name: string }) => f.name === "body");
const blockContentType = bodyField.type;

function truncateExcerpt(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length <= 160) return trimmed;
  // Truncate to 157 chars + ellipsis on a WORD boundary, without splitting a
  // surrogate pair (Array.from splits on whole Unicode code points, so a
  // multibyte character is never cut in half).
  const chars = Array.from(trimmed);
  const cut = chars.slice(0, 157).join("");
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.\s]+$/, "") + "…";
}

async function main() {
  const files = fs
    .readdirSync(ARCHIVE_BLOG_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();

  console.log(`Found ${files.length} un-migrated posts in ${ARCHIVE_BLOG_DIR}`);

  const droppedImages: { slug: string; src: string }[] = [];
  const skippedDrafts: string[] = [];
  let imported = 0;

  for (const file of files) {
    const slug = file.replace(/\.md$/, "");
    const fullPath = path.join(ARCHIVE_BLOG_DIR, file);
    const raw = fs.readFileSync(fullPath, "utf-8");
    const { data: frontmatter, content: markdownBody } = matter(raw);

    if (frontmatter.draft === true) {
      skippedDrafts.push(slug);
      console.log(`· ${slug} — skipped (draft: true)`);
      continue;
    }

    const html = await marked.parse(markdownBody);

    const blocks = htmlToBlocks(html, blockContentType, {
      parseHtml: (htmlString: string) => new JSDOM(htmlString).window.document,
    });

    // `post.body` no longer accepts a bare `image` type — `figure` replaced it
    // so that required alt text cannot be skipped by picking the wrong block.
    // Anything block-tools emits as an image is therefore invalid here: drop it
    // and record what went, so the report can list every affected path.
    const cleanBlocks = blocks.filter((block: { _type: string; asset?: { _ref?: string } }) => {
      if (block._type === "image") {
        droppedImages.push({ slug, src: block.asset?._ref ?? "(unknown asset ref)" });
        return false;
      }
      return true;
    });

    const description = String(frontmatter.description ?? "").trim();
    const publishedAt = new Date(frontmatter.pubDate).toISOString();

    const doc = {
      _id: `post-${slug}`,
      _type: "post",
      title: frontmatter.title,
      slug: { _type: "slug", current: slug },
      author: { _type: "reference", _ref: AUTHOR_ID },
      // standfirst is the on-page deck and gets the description in full;
      // excerpt is the SERP meta description and is capped at 160.
      standfirst: description,
      excerpt: truncateExcerpt(description),
      publishedAt,
      tags: frontmatter.tags ?? [],
      body: cleanBlocks,
    };

    await client.createOrReplace(doc);
    imported += 1;
    console.log(`✓ ${doc._id}  (${doc.title})`);
  }

  if (droppedImages.length > 0) {
    console.log("\nDropped image nodes (`image` is no longer a valid body block — use `figure`):");
    for (const { slug, src } of droppedImages) {
      console.log(`  - ${slug}: ${src}`);
    }
  } else {
    console.log("\nNo image nodes encountered — nothing dropped.");
  }

  if (skippedDrafts.length > 0) {
    console.log("\nSkipped drafts:");
    for (const slug of skippedDrafts) console.log(`  - ${slug}`);
  } else {
    console.log("No drafts encountered — nothing skipped.");
  }

  console.log(`\nDone. Imported ${imported} posts.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
