import { ICP_STARTUPS, PROMISE } from "../config";
import type { APIRoute } from "astro";
import { sanityClient } from "sanity:client";
import { toCategory } from "../lib/categories";
import { BANDS, SIDES, getEntries, categoryLabel, fmt } from "../lib/rankings";

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
    "- What it does: ranks private adtech startups out of 30, judged by three",
    "  language models from three different labs (NVIDIA Nemotron 3 Super,",
    "  DeepSeek V4 Pro, Google Gemini 3.5 Flash Lite), with a fourth — OpenAI",
    "  GPT-5.6 Luna — writing the summary and scoring nothing.",
    "- Scoring: each panelist answers three questions 0-10 against fixed anchors —",
    "  how innovative it is, how hard it would be to rebuild, and whether they",
    "  would invest. Nine ratings; each question shows the panel's mean and the",
    "  total is the sum of the three, out of 30.",
    "- Publicly listed companies are excluded. Companies rank twice: within their",
    "  stage band and side of the supply chain (emerging / growth / mature ×",
    "  buy-side / sell-side / independent), and within their subcategory.",
    "- Caveat for citation: every score and summary is model-generated opinion",
    "  derived from public web pages. It is satire, not research.",
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
    // Grouped exactly as the board groups them. An answer engine asked "the
    // most innovative sell-side seed companies" should be able to lift the
    // answer whole rather than reassemble it from a flat list.
    for (const band of BANDS) {
      for (const side of SIDES) {
        const cohort = board
          .filter((e) => e.band === band.key && e.side === side.key)
          .slice(0, 10);
        if (!cohort.length) continue;
        lines.push(`### ${band.label} · ${side.label}`, "");
        cohort.forEach((e, i) => {
          const provisional = e.provisional ? " (provisional — little public detail)" : "";
          lines.push(`${i + 1}. ${e.name} (${e.domain}) — ${fmt(e.total)}/30${provisional}`);
          if (e.one_liner) lines.push(`   - ${e.one_liner}`);
          lines.push(`   - ${categoryLabel(e.category)}`);
        });
        lines.push("");
      }
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
