/**
 * One-time migration: import the 11 legacy blog posts from the archived
 * And/or Labs site into Sanity as published `post` documents.
 *
 * Source (READ-ONLY, never modified):
 *   /Users/transl8r/Developer/_archive/andorlabs-site-old/src/content/blog/*.md
 *
 * Run with:
 *   npx sanity exec scripts/seed-blog.ts --with-user-token
 *
 * Idempotent: uses deterministic `_id: post-<slug>` + createOrReplace, so
 * re-running updates existing documents instead of duplicating them.
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
  "/Users/transl8r/Developer/_archive/andorlabs-site-old/src/content/blog";

const client = getCliClient({ apiVersion: "2026-07-01" });

// Compile the project schema so block-tools knows the shape of `post.body`.
const compiledSchema = Schema.compile({ name: "default", types: schemaTypes });
const postType = compiledSchema.get("post");
const bodyField = postType.fields.find((f: { name: string }) => f.name === "body");
const blockContentType = bodyField.type;

function truncateExcerpt(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length <= 160) return trimmed;
  // Truncate to 157 chars + ellipsis, without splitting a surrogate pair
  // (multibyte emoji etc. are 2 UTF-16 code units — Array.from splits on
  // whole Unicode code points so we never cut one in half).
  const chars = Array.from(trimmed);
  return chars.slice(0, 157).join("") + "…";
}

async function main() {
  const files = fs
    .readdirSync(ARCHIVE_BLOG_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();

  console.log(`Found ${files.length} legacy posts in ${ARCHIVE_BLOG_DIR}`);

  const droppedImages: { slug: string; src: string }[] = [];

  for (const file of files) {
    const slug = file.replace(/\.md$/, "");
    const fullPath = path.join(ARCHIVE_BLOG_DIR, file);
    const raw = fs.readFileSync(fullPath, "utf-8");
    const { data: frontmatter, content: markdownBody } = matter(raw);

    const html = await marked.parse(markdownBody);

    const blocks = htmlToBlocks(html, blockContentType, {
      parseHtml: (htmlString: string) => new JSDOM(htmlString).window.document,
    });

    // Drop any image nodes — asset migration happens separately. Record
    // what we dropped so the report can list every affected path.
    const cleanBlocks = blocks.filter((block: { _type: string; asset?: { _ref?: string } }) => {
      if (block._type === "image") {
        droppedImages.push({ slug, src: block.asset?._ref ?? "(unknown asset ref)" });
        return false;
      }
      return true;
    });

    const publishedAt = new Date(frontmatter.publishedAt).toISOString();
    const excerpt = truncateExcerpt(frontmatter.excerpt ?? "");

    const doc = {
      _id: `post-${slug}`,
      _type: "post",
      title: frontmatter.title,
      slug: { _type: "slug", current: slug },
      excerpt,
      publishedAt,
      tags: frontmatter.tags ?? [],
      body: cleanBlocks,
    };

    await client.createOrReplace(doc);
    console.log(`✓ ${doc._id}  (${doc.title})`);
  }

  if (droppedImages.length > 0) {
    console.log("\nDropped image nodes (asset migration pending):");
    for (const { slug, src } of droppedImages) {
      console.log(`  - ${slug}: ${src}`);
    }
  } else {
    console.log("\nNo image nodes encountered — nothing dropped.");
  }

  console.log(`\nDone. Seeded ${files.length} posts.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
