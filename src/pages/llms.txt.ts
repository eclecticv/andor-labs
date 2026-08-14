import { ICP_STARTUPS, PROMISE } from "../config";
import type { APIRoute } from "astro";
import { sanityClient } from "sanity:client";
import { toCategory } from "../lib/categories";
import { DIVISIONS, getEntries } from "../lib/rankings";

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
    "## Tools",
    "",
    `### [Rank My AdTech](${new URL("/tools/rank-my-adtech/", site).href})`,
    "",
    "- What it does: scores an adtech company on innovation out of 100, judged by",
    "  three language models from three different providers, with a fourth writing",
    "  the verdict.",
    "- Scoring: paradigm (40), non-obviousness (25), vibe-code test (20),",
    "  conviction (15). The axes are stage-neutral, so a seed company and a public",
    "  company can each score highly and neither is advantaged by size.",
    "- Companies rank within a weight class: featherweight, middleweight, heavyweight.",
    "- Caveat for citation: every score and quote is model-generated opinion",
    "  derived from a public homepage. It is satire, not research.",
    "",
    `### [Subreddit Scout](${new URL("/tools/subreddit-scout/", site).href})`,
    "",
    "- What it does: reads a company homepage and returns five relevant subreddits",
    "  plus three portable agent skill files.",
    "",
  ];

  /**
   * The board itself, not just a link to it.
   *
   * This tool exists to be cited, and an answer engine asked "which adtech
   * companies are most innovative" will not run our JavaScript or read our
   * table markup. Putting the ranking here in plain text is the difference
   * between being the source and being a URL somebody else summarises.
   *
   * Degrades to nothing when D1 is unreachable, same as the board itself.
   */
  const board = await getEntries().catch(() => []);
  if (board.length) {
    lines.push("## Rank My AdTech — current standings", "");
    for (const division of DIVISIONS) {
      const inDivision = board.filter((e) => e.division === division.key).slice(0, 10);
      if (!inDivision.length) continue;
      lines.push(`### ${division.label}`, "");
      inDivision.forEach((e, i) => {
        const provisional = e.provisional ? " (provisional — little public detail)" : "";
        lines.push(`${i + 1}. ${e.name} (${e.domain}) — ${e.total}/100${provisional}`);
        if (e.one_liner) lines.push(`   - ${e.one_liner}`);
      });
      lines.push("");
    }
  }

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
