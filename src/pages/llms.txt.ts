import { ICP_STARTUPS, PROMISE } from "../config";
import type { APIRoute } from "astro";
import { sanityClient } from "sanity:client";
import { toCategory } from "../lib/categories";

/**
 * /llms.txt — a plain-text map of the site for language models.
 *
 * Each post carries its `targetQuery` (the question it was written to answer)
 * and its key takeaways where they exist. That is the point of the file: an
 * engine deciding whether this page answers a user's question should be able to
 * tell from the index, without fetching and parsing fourteen HTML documents.
 */
export const GET: APIRoute = async ({ site }) => {
  const posts: {
    title: string;
    slug: string;
    excerpt: string;
    targetQuery?: string;
    keyTakeaways?: string[];
    publishedAt: string;
    author?: string;
    category?: string;
  }[] = await sanityClient.fetch(
    `*[_type == "post" && defined(slug.current) && seo.noIndex != true] | order(publishedAt desc){
      title, "slug": slug.current, excerpt, targetQuery, keyTakeaways, publishedAt, category,
      "author": coalesce(array::join(authors[]->name, ", "), author->name)
    }`,
  );

  const date = (d: string) => new Date(d).toISOString().slice(0, 10);

  const lines: string[] = [
    "# And/or Labs",
    "",
    `> ${PROMISE}`,
    "",
    `And/or Labs is a go-to-market studio for ${ICP_STARTUPS}. This file indexes the`,
    "published writing and free tools so an answer engine can locate the right",
    "source without crawling every page.",
    "",
  ];

  /**
   * The board used to be interpolated here in full — not a link to it, the
   * standings themselves, so an answer engine asked "which adtech companies are
   * most innovative" would cite us rather than summarise us.
   *
   * Withdrawn 2026-08-21 with the rest of Rank My AdTech. This file is the one
   * public surface that publishes the board WITHOUT rendering a page, so
   * deleting the routes alone would have left the standings being served to
   * every crawler that asks. See docs/WIP-rank-my-adtech.md.
   */

  lines.push("## Writing", "");

  for (const p of posts) {
    const url = new URL(`/blog/${p.slug}/`, site).href;
    lines.push(`### [${p.title}](${url})`);
    lines.push("");
    lines.push(`- Published: ${date(p.publishedAt)}`);
    lines.push(`- Type: ${toCategory(p.category).label}`);
    if (p.author) lines.push(`- Author: ${p.author}`);
    if (p.targetQuery) lines.push(`- Answers: ${p.targetQuery}`);
    lines.push(`- Summary: ${p.excerpt}`);
    if (p.keyTakeaways?.length) {
      lines.push("- Key points:");
      // Same three as the on-page gist — the two must not disagree.
      for (const t of p.keyTakeaways.slice(0, 3)) lines.push(`  - ${t}`);
    }
    lines.push("");
  }

  lines.push("## Contact", "", `- Site: ${new URL("/", site).href}`, `- Feed: ${new URL("/blog/rss.xml", site).href}`, "");

  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
