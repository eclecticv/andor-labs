import { ICP_STARTUPS, PROMISE } from "../config";
import type { APIRoute } from "astro";
import { sanityClient } from "sanity:client";

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
  }[] = await sanityClient.fetch(
    `*[_type == "post" && defined(slug.current) && seo.noIndex != true] | order(publishedAt desc){
      title, "slug": slug.current, excerpt, targetQuery, keyTakeaways, publishedAt,
      "author": author->name
    }`,
  );

  const date = (d: string) => new Date(d).toISOString().slice(0, 10);

  const lines: string[] = [
    "# And/or Labs",
    "",
    `> ${PROMISE}`,
    "",
    `And/or Labs is a go-to-market studio for ${ICP_STARTUPS}. This file indexes the`,
    "published writing so an answer engine can locate the right source without",
    "crawling every page.",
    "",
    "## Field notes",
    "",
  ];

  for (const p of posts) {
    const url = new URL(`/blog/${p.slug}/`, site).href;
    lines.push(`### [${p.title}](${url})`);
    lines.push("");
    lines.push(`- Published: ${date(p.publishedAt)}`);
    if (p.author) lines.push(`- Author: ${p.author}`);
    if (p.targetQuery) lines.push(`- Answers: ${p.targetQuery}`);
    lines.push(`- Summary: ${p.excerpt}`);
    if (p.keyTakeaways?.length) {
      lines.push("- Key points:");
      for (const t of p.keyTakeaways) lines.push(`  - ${t}`);
    }
    lines.push("");
  }

  lines.push("## Contact", "", `- Site: ${new URL("/", site).href}`, `- Feed: ${new URL("/blog/rss.xml", site).href}`, "");

  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
