import { ICP_STARTUPS, PROMISE } from "../config";
import type { APIRoute } from "astro";
import { sanityClient } from "sanity:client";
import { toCategory } from "../lib/categories";
import {
  COHORTS, cohortKeyOf, GRADER, DIMENSIONS, getEntries, categoryLabel, fmt,
  letterFor,
} from "../lib/rankings";

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
    // Roster and cohorts are interpolated, never typed. Typed copies of both
    // went stale here while the site itself had moved on — and an answer engine
    // quoting a stale roster is a citation nobody can check.
    // Roster and rubric are interpolated, never typed. Typed copies went stale
    // here while the site itself had moved on — and an answer engine quoting a
    // stale rubric is a citation nobody can check.
    "- What it does: grades private adtech startups 1-5 on five dimensions, from",
    "  the company's own website and nothing else.",
    `- Graded by a single model: ${GRADER.lab} ${GRADER.name} (${GRADER.model}), at`,
    "  temperature 0 against published anchors. The model is PINNED — a grader",
    "  that cannot answer fails the ranking rather than being substituted,",
    "  because a board whose rows were graded by different models is not",
    "  comparable to itself.",
    `- The five dimensions: ${DIMENSIONS.map((d) => d.label.toLowerCase()).join(", ")}.`,
    "  Each is an integer 1-5 against fixed anchors; the headline grade is their",
    "  mean to one decimal, and letter bands sit on top (A from 4.5, B from 3.5,",
    "  C from 2.5, D from 1.5).",
    "- Before scoring anything the grader writes the case AGAINST the company —",
    "  three specific weaknesses, each pointing at something on the pages. It is",
    "  published on the company page, and it is why a grade is auditable rather",
    "  than a vibe.",
    "- Durability replaced an earlier investability question, which systematically",
    "  punished acquired companies: it asked the model to imagine a transaction, so",
    "  anything making that transaction impossible read as a defect in the company.",
    "  Acquisition is treated as an outcome, not a verdict.",
    "- Publicly listed companies are excluded. Companies rank twice: within their",
    `  ${COHORTS.map((c) => c.label.toLowerCase()).join(" / ")} cohort, and within`,
    "  their subcategory.",
    "- Caveat for citation: every score and summary is model-generated opinion",
    "  derived from public web pages. It is satire, not research.",
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
    // Grouped exactly as the board groups them — via COHORTS and cohortKeyOf,
    // the same pair the leaderboard renders from, so the two cannot disagree.
    //
    // This used to nest BANDS inside SIDES, which was the board's shape until
    // stage bands stopped being the spine (see BOARD_AXIS). It kept emitting
    // "Emerging · Sell-side" headings for a structure the site no longer had,
    // and since almost no adtech site states its stage, most rows carried an
    // inferred band and were filed under a heading nothing had established.
    for (const cohort of COHORTS) {
      const rows = board.filter((e) => cohortKeyOf(e) === cohort.key).slice(0, 10);
      if (!rows.length) continue;
      lines.push(`### ${cohort.label}`, "");
      rows.forEach((e, i) => {
        const provisional = e.provisional ? " (provisional — little public detail)" : "";
        lines.push(`${i + 1}. ${e.name} (${e.domain}) — ${fmt(e.grade)}/5 (${letterFor(e.grade)})${provisional}`);
        if (e.one_liner) lines.push(`   - ${e.one_liner}`);
        lines.push(`   - ${categoryLabel(e.category)}`);
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
