/**
 * One-shot editorial pass: add structural typesetting to the existing posts —
 * `pullQuote` and `divider` blocks in the body, plus the `keyTakeaways` field.
 *
 * Run with:
 *   npx sanity exec scripts/enrich-bodies.ts --with-user-token              # dry run
 *   npx sanity exec scripts/enrich-bodies.ts --with-user-token -- --apply   # writes
 *
 * (`APPLY=1` in the environment works too, for CLI arg-parsing that swallows
 * unknown flags.)
 *
 * ── THE INVARIANT ──────────────────────────────────────────────────────────
 *
 * VJ approved this pass as "enrich, don't rewrite: zero words changed, zero
 * words added". That is not a guideline here, it is a gate. `blockText()`
 * concatenates the span text of every `_type === "block"` node; before any
 * write, `blockText(enriched)` must equal `blockText(original)` exactly. One
 * character of drift and the post is skipped with a diff.
 *
 * Everything this script adds is therefore either invisible to that measure or
 * verbatim:
 *
 *   - `divider` carries no text at all, so it is invariant-safe by construction.
 *   - `pullQuote` is NOT a block, so its text is outside `blockText()` — and the
 *     sentence it promotes STAYS in the body where it was. That is standard
 *     magazine practice (the quote repeats a line from the article, it does not
 *     relocate it) and it is also what keeps the invariant true.
 *   - `keyTakeaways` are sentences copied verbatim out of the post's own prose.
 *
 * `callout`, `figure`, `codeBlock` and `keyStat` are deliberately NOT used on
 * existing posts: a callout necessarily lifts text out of the reading order,
 * which breaks the invariant. Those blocks exist for new posts authored in
 * Studio.
 *
 * Deliberately NOT importing `toPlainText` from `src/lib/portableText.ts` — that
 * one also descends into pullQuote and callout, which is correct for reading
 * time and word count and exactly wrong as an invariant measure here.
 *
 * ── Other choices that matter ──────────────────────────────────────────────
 *
 * `client.patch(id).set(...)` — never `createOrReplace`. Sibling scripts patch
 * `heroImage` on these same documents, possibly at the same time; a full replace
 * would silently clobber them.
 *
 * Idempotent: a body that already contains a `pullQuote` or `divider` is left
 * alone, and a post that already has `keyTakeaways` keeps them. Re-running never
 * stacks a second set.
 *
 * Verbatim resolution: the strings below are transcribed by hand, so smart
 * quotes and dashes can drift. `resolveVerbatim()` finds the candidate under a
 * punctuation-folding normalisation that is strictly 1:1 on characters, then
 * returns the ORIGINAL slice from the post. What lands in Sanity is always the
 * author's exact bytes, never the transcription.
 */
import fs from "node:fs";
import path from "node:path";
import { getCliClient } from "sanity/cli";

const REVIEW_PATH =
  "/private/tmp/claude-501/-Users-transl8r/aa04465f-d4f0-4c4a-ab2b-c58d894c6a77/scratchpad/enrichment-review.md";

const APPLY = process.argv.includes("--apply") || process.env.APPLY === "1";

const client = getCliClient({ apiVersion: "2026-07-01" });

/* ────────────────────────────── types ────────────────────────────────────── */

interface Span { _type: string; text?: string }
interface Node {
  _type: string;
  _key?: string;
  style?: string;
  listItem?: string;
  children?: Span[];
  [k: string]: unknown;
}
interface PostRow {
  _id: string;
  slug: string;
  title: string;
  body: Node[];
  keyTakeaways: string[] | null;
}

/** A pull quote: a sentence promoted from the prose, parked at `before`. */
interface QuotePlan {
  /** Verbatim sentence from this post's own prose. */
  text: string;
  /** Insert immediately BEFORE this original body index. */
  before: number;
}
interface DividerPlan {
  style: "rule" | "dither" | "asterism";
  before: number;
  /** Why the argument turns here — review copy only, never written to Sanity. */
  why: string;
}
interface Plan {
  quotes?: QuotePlan[];
  dividers?: DividerPlan[];
  takeaways?: string[];
  /** Recorded when a post gets fewer quotes than it could — shown in the review. */
  note?: string;
}

/* ───────────────────────────── the plan ──────────────────────────────────── */

/**
 * Pull quotes are restricted to posts over ~800 words, two at most, and only
 * where a genuinely quotable line exists — the sharp claim, the reversal, the
 * memorable formulation. Definitions, transitions and section-opening sentences
 * are not pull quotes. Where a post had only one line worth screenshotting it
 * gets one, and `note` says so.
 *
 * `attribution` is left empty throughout: it is the author's own text, and
 * "— Vishveshwar Jatain" under a line from Vishveshwar Jatain's own article
 * reads like a misattribution.
 *
 * Dividers only land where the argument actually turns, and only ever between
 * two ordinary paragraphs — never touching a heading, which already IS the
 * break. Doubling the two reads as a rendering bug. In practice that means the
 * headless essays carry them and the h2-scaffolded posts mostly don't, which is
 * the right outcome: those posts already have visible structure.
 */
const PLANS: Record<string, Plan> = {
  /* ── 416 words — under the pull-quote threshold ───────────────────────── */
  "content-engineering-not-content-marketing": {
    takeaways: [
      "Content engineering asks: where are we visible, where aren't we, and what's the highest-leverage thing to change?",
      "You can't engineer what you don't measure.",
      "The new bottleneck is being found and being distinctive in a market where everyone can produce.",
      "AI playbooks let you produce at the scale the new landscape demands — but with humans in the loop on judgment, accuracy, and voice, because that's exactly what the flood of AI slop has made scarce and valuable.",
    ],
    note: "416 words — below the pull-quote threshold, and h2-scaffolded, so no dividers.",
  },

  /* ── 999 words ────────────────────────────────────────────────────────── */
  "death-of-the-mql": {
    quotes: [
      // The droll one-liner in the middle of an otherwise sober framework post.
      { text: "Anyone with a credit card is a potential SQL.", before: 10 },
      // The reversal the whole post argues for — fewer leads, better results —
      // with a named company attached, which is what makes it screenshottable.
      {
        text: "Oracle reduced the amount of leads they sent over to BDR and the sales team while increasing results in terms of opportunities, pipeline acceleration, and conversion rates.",
        before: 23,
      },
    ],
    takeaways: [
      "MQLs are also more often than not the classic definition of a vanity metric.",
      "Depending on the underlying quality, 10 MQLs could outperform 100 MQLs in terms of revenue (potential or materialized).",
      // Deliberately NOT the Oracle sentence: it sits in the same paragraph as
      // the pull quote above, and printing one paragraph twice on one page is
      // the exact tic this pass exists to avoid.
      "Depending on the quality and relevance of the lead, the sales team may then convert the MQL into SQL (Sales Qualified Lead), and eventually the SQL into a deal or opportunity.",
      "By tagging deals or opportunities and customers that are sourced by marketing, marketing teams can track their revenue contribution through the entire lifecycle of the business.",
      "For mature B2B companies, with good product-market fit and marketing-sales alignment, a 25-30% marketing-contributed/influenced pipeline is an often-quoted benchmark.",
    ],
  },

  /* ── 566 words ────────────────────────────────────────────────────────── */
  "distribution-is-the-new-moat": {
    takeaways: [
      "AI overviews and answer engines now resolve most informational queries on the results page itself.",
      "When everyone can produce competent content, competent content stops being a differentiator.",
      "Your buyer can now prototype a workable version of your product in an afternoon with an AI coding tool.",
      "The defensibility you assumed lived in your feature set is thinner than it was eighteen months ago.",
      "Distribution is the new moat because it's the one advantage that compounds and can't be cloned overnight.",
    ],
    note: "566 words — below the pull-quote threshold.",
  },

  /* ── 862 words ────────────────────────────────────────────────────────── */
  "doomsday-prepping-for-the-post-software-era": {
    quotes: [
      // The Andreessen reversal — the line the whole post is built to land.
      { text: "Software ate too much and is now throwing up... software.", before: 9 },
    ],
    takeaways: [
      "The post-software era means a time when the ability to develop functional software is commoditized to an extent that it completely loses its differentiation and market value.",
      "Even if SaaS is screwed, the screwing will not be uniformly distributed.",
      "You can't get an original tune by remixing.",
      "Because SaaS is being downgraded to a lower expected-value bet, institutional capital will flow asymmetrically to the top of the food chain.",
      "Building and positioning software are wildly different disciplines.",
    ],
    note: "One pull quote, not two. The runners-up (\"Even if SaaS is screwed…\", \"You can't get an original tune by remixing.\", \"AI has nothing on good ol' money.\") each sit in a section whose only legal second-half slot puts the quote either shoulder to shoulder with an identical one-sentence paragraph or directly under one of the run-in labels in the closing list — both of which read as a rendering fault rather than as typesetting. The first two are promoted to key takeaways instead.",
  },

  /* ── 998 words ────────────────────────────────────────────────────────── */
  "how-to-get-started-with-claude-code": {
    quotes: [
      // Parked immediately after its own paragraph, not two later: "show up
      // there" only resolves while the terminal is still the subject.
      {
        text: "You can just show up there with your natural language skills and Claude Code will be your translator.",
        before: 20,
      },
    ],
    takeaways: [
      "You'll either need a Claude Pro plan or an API subscription to get started, I chose the Pro plan because it also gives me access to all of Claude's integrations and features.",
      "Don't worry about breaking anything, the worst thing that can happen is a failed installation.",
      "Claude Code is more like a hired hand, you keep the assets even if you decide to cancel.",
      "I had a really hard time getting Claude Code to stick to a standard system of design, which includes things like a colour palette, UI components, animations, spacing, etc.",
      "It's quite easy to hit the weekly usage limits on the Pro plan.",
    ],
    note: "One pull quote, not two. It is a setup walkthrough; the second-best candidate (\"Claude Code is more like a hired hand…\") sits inside the Pros bullet list, where the only legal insertion point splits the list from the Cons label. Promoted to a key takeaway instead.",
  },

  /* ── 573 words, no headings — dividers do the structural work ─────────── */
  "how-to-think-about-effort": {
    dividers: [
      { style: "asterism", before: 5, why: "Setup (checkbox marketing, the confession) hands over to the argument proper." },
      { style: "dither", before: 14, why: "Strongest break: the argument turns philosophical — Sartre's waiter, and the close." },
    ],
    takeaways: [
      "The ability to measure things is a double-edged sword.",
      "I think marketing teams should be on a perpetual search-and-destroy mission to weed out work that either has no expected value or fails short of delivering it.",
      "Effort is not fungible.",
      "The true cost of standing still is that you inch backwards while others get ahead.",
      "In a real-world setting, it is impossible to fully optimize effort because the real world is littered with chaos, constraints, edge cases, and exceptions.",
    ],
    note: "573 words — below the pull-quote threshold.",
  },

  /* ── 463 words ────────────────────────────────────────────────────────── */
  "human-in-the-loop-is-the-moat": {
    takeaways: [
      "When a capability becomes universal, it stops being an advantage.",
      "The hard part of content was never typing — it was knowing which idea earns attention and which is noise.",
      "A model can't be accountable; a person can.",
      "The more you run AI through sharp human judgment, the more that judgment improves, and the wider the gap gets between your output and the average AI slop your competitors are flooding the same feeds with.",
      "Universal AI doesn't flatten the playing field.",
    ],
    note: "463 words — below the pull-quote threshold.",
  },

  /* ── 443 words, no headings ───────────────────────────────────────────── */
  netflixification: {
    dividers: [
      { style: "dither", before: 11, why: "The Netflix and Amazon cases land; the coinage is stated and the essay turns to its conclusion." },
    ],
    takeaways: [
      "Just like enshittification is the inevitable decay of two-sided online platforms caused by misaligned incentives, netflixification is the inevitable decay of aggregators caused by the distribution of self-owned products.",
      "Netflix churns out media to keep its users from getting bored.",
      "Amazon products don't need to be the best, they just need to push volume.",
      "A thousand monkeys hacking away at typewriters will eventually reproduce a Shakespeare—it doesn't make the monkey a playwright.",
      "Great products are built from a desire to build great products.",
    ],
    note: "443 words — below the pull-quote threshold. One divider, not two: at this length a second would be decoration.",
  },

  /* ── 1051 words ───────────────────────────────────────────────────────── */
  "the-copilot-tax": {
    quotes: [
      { text: "The game got better every time I removed something.", before: 9 },
      { text: "The expensive part is asking for the right thing.", before: 29 },
    ],
    takeaways: [
      "The copilot tax is what you pay when speed outpaces judgment.",
      "The bottleneck was never writing code.",
      "The bottleneck was exercising good judgment in what to build, what to cut, and when to stop.",
      "Code that compiles isn't code that works.",
      "It's cheaper to cross something off a planning doc than to rip it out of working code.",
    ],
    note: "\"The copilot tax is what you pay when speed outpaces judgment.\" is the single most quotable line, but it is also the post's definition, so it goes in the gist box; the pull quote takes the next sentence of the same paragraph to avoid printing the same line twice on one page.",
  },

  /* ── 866 words ────────────────────────────────────────────────────────── */
  "what-is-gtm-engineering": {
    dividers: [
      { style: "asterism", before: 11, why: "The fairy tale ends and the author shows up — a genuine change of register, inside a headless lede." },
    ],
    quotes: [
      {
        text: "I have fought vendors, walked off negotiation tables, and broken contractual payment obligations in cases where I felt that my group was being treated as a line item in someone else's balance sheet.",
        before: 13,
      },
      { text: "Most people are content living inside the first box that happens to fit their size.", before: 37 },
    ],
    takeaways: [
      "Clay created the first GTM Engineering team.",
      "A GTM Engineer is someone who identifies a problem, weighs the impact of solving it, and then solves it using the most efficient and elegant way, across the entire lifecycle of the revenue process… from sourcing-to-close-to-retention.",
      "The “Engineering” in GTM Engineer is used loosely, in fact, some are not engineers in the strictest sense.",
      "When looking for one, prioritize the trifecta of driven, curious, and forward-thinking over hard skills.",
      "A startup should hire them to lay down a strong foundation and for the sheer value.",
    ],
  },

  /* ── 627 words, no headings ───────────────────────────────────────────── */
  "what-is-inbound-led-outbound": {
    dividers: [
      { style: "asterism", before: 14, why: "Background on the two motions ends; the piece pivots to the hybrid it is named for." },
      { style: "dither", before: 20, why: "Strongest break: the plays are laid out, and the close weighs whether any of it is worth doing." },
    ],
    takeaways: [
      "Inbound is all about positioning yourself as a magnet for potential buyers by creating engaging content, SEO, SEM, social media, earned media, webinars, etc.",
      "Outbound is all about the push.",
      "Inbound is an infinite game of building and waiting.",
      "The onus is on the buyer to signal their intent by sharing their email, phone, function, company, or other data.",
      "Executed thoughtfully and with attention to detail, inbound-led outbound can be a great way for marketing to have a more immediate and tangible impact on sales efficiency.",
    ],
    note: "627 words — below the pull-quote threshold.",
  },

  /* ── 581 words ────────────────────────────────────────────────────────── */
  "what-is-vibe-coding": {
    takeaways: [
      "A few weeks ago, I landed on Lovable.dev and discovered “vibe coding”—the act of building applications with zero underlying knowledge of the code that powers it.",
      "In my own experiments with vibe coding, I got farther than anyone with my skill set should be able to.",
      "It has never been easier for non-technical people to bring their ideas to life without spending four years on a CS degree or hiring someone who did.",
      "The choice now is whether or not you see these tools for what they are (i.e., efficiency multipliers) and use them to get ahead, or—allow purists and tradition to bog you down.",
      "I think companies that take a tepid or dogmatic view of human vs. AI-assisted building will be slow to innovate and less cost-efficient, losing their edge to others over time.",
    ],
    note: "581 words — below the pull-quote threshold.",
  },

  /* ── 588 words ────────────────────────────────────────────────────────── */
  "writing-is-the-worst-use-of-llms": {
    takeaways: [
      "Average writing fills whitespace, great writing breaks patterns.",
      "LLMs don't have a monopoly over churning out dull, lifeless copy.",
      "The ability to generate text at 100x the speed has no correlation to its latent potential in the real world.",
      "Once the sterile language starts seeping into products and services, they too will acquire the same dullness of character.",
      "The truth is en route: LLMs produce mediocre work at frightening speeds.",
    ],
    note: "588 words — below the pull-quote threshold. \"Average writing fills whitespace, great writing breaks patterns.\" would be the pull quote if it qualified.",
  },

  /* ── 498 words, no headings ───────────────────────────────────────────── */
  "you-dont-need-a-b-testing": {
    dividers: [
      { style: "dither", before: 14, why: "The catalogue of bad reasons ends and the piece turns prescriptive." },
    ],
    takeaways: [
      "Truth is most things don't need to be A/B tested.",
      "Whatever the reason may be, you need to understand the business context and the available scale before proposing to A/B test things.",
      "A/B testing shouldn't be used as a crutch to settle arguments.",
      "In the vast majority of cases, it doesn't actually matter if you pick Serif or Sans-serif, or the colour blue or orange, or the size 14px or 16px.",
      "Marketing leaders should rely on their intuition and good sense to make these calls based on the medium and the established brand identity.",
    ],
    note: "498 words — below the pull-quote threshold.",
  },
};

/* ─────────────────────────── the invariant ───────────────────────────────── */

/**
 * The measure the invariant is asserted on: the span text of every `block`
 * node, in order, joined by newlines. Non-block nodes contribute nothing, which
 * is exactly why `pullQuote` and `divider` can be inserted freely.
 */
function blockText(body: Node[]): string {
  return body
    .filter((n) => n._type === "block")
    .map((n) => (n.children ?? []).filter((c) => c._type === "span").map((c) => c.text ?? "").join(""))
    .join("\n");
}

function firstDivergence(a: string, b: string): string {
  const len = Math.min(a.length, b.length);
  let i = 0;
  while (i < len && a[i] === b[i]) i += 1;
  const ctx = (s: string) => JSON.stringify(s.slice(Math.max(0, i - 60), i + 60));
  return [
    `first divergence at character ${i}`,
    `  original: ${ctx(a)}`,
    `  enriched: ${ctx(b)}`,
  ].join("\n");
}

/* ────────────────────── verbatim resolution ──────────────────────────────── */

/**
 * Strictly 1:1 character folding — same length in, same length out — so an index
 * found in the normalised string is valid in the original. Folds the smart
 * punctuation that hand-transcription reliably gets wrong.
 */
const FOLD: Record<string, string> = {
  "‘": "'", "’": "'", "‛": "'", "′": "'",
  "“": '"', "”": '"', "„": '"', "″": '"',
  "–": "-", "—": "-", "‒": "-", "‐": "-", "‑": "-", "−": "-",
  " ": " ", " ": " ", " ": " ", " ": " ",
};
const fold = (s: string) => s.replace(/[‘’‛′“”„″–—‒‐‑−    ]/g, (c) => FOLD[c]);

/**
 * Return the EXACT slice of `haystack` corresponding to `candidate`, matching
 * under punctuation folding. Throws if the sentence is not in the post — which
 * is the assertion that no new words can enter through a pull quote or a
 * takeaway.
 */
function resolveVerbatim(haystack: string, candidate: string, label: string): string {
  if (haystack.includes(candidate)) return candidate;
  const i = fold(haystack).indexOf(fold(candidate));
  if (i === -1) {
    throw new Error(
      `${label}: not found verbatim in the post's own prose.\n  wanted: ${JSON.stringify(candidate)}`,
    );
  }
  return haystack.slice(i, i + candidate.length);
}

/* ───────────────────────── placement guards ──────────────────────────────── */

const HEADINGS = new Set(["h2", "h3", "h4"]);
const isHeading = (n: Node | undefined) => !!n && n._type === "block" && HEADINGS.has(n.style ?? "");

/** Body-block bounds of the section containing `idx`, delimited by headings. */
function sectionOf(body: Node[], idx: number): { firstBody: number; endExclusive: number } {
  let start = idx;
  while (start > 0 && !isHeading(body[start - 1])) start -= 1;
  let end = idx + 1;
  while (end < body.length && !isHeading(body[end])) end += 1;
  return { firstBody: start, endExclusive: end };
}

/**
 * A pull quote belongs in a paragraph gap in the SECOND HALF of the section its
 * sentence came from — never directly under the heading, where it would fight
 * the heading for the reader's eye.
 */
function assertQuotePlacement(body: Node[], q: QuotePlan, sourceIdx: number, label: string) {
  const { firstBody, endExclusive } = sectionOf(body, sourceIdx);
  const n = endExclusive - firstBody;
  const midpoint = firstBody + Math.ceil(n / 2);
  if (q.before <= firstBody) throw new Error(`${label}: sits directly under a heading.`);
  if (q.before > endExclusive) throw new Error(`${label}: placed outside its own section.`);
  if (q.before < midpoint) {
    throw new Error(`${label}: in the first half of its section (index ${q.before}, midpoint ${midpoint}).`);
  }
  if (isHeading(body[q.before - 1])) throw new Error(`${label}: directly under a heading.`);
}

/** A divider must never touch a heading — the heading already IS the break. */
function assertDividerPlacement(body: Node[], d: DividerPlan, label: string) {
  if (d.before <= 0 || d.before >= body.length) throw new Error(`${label}: out of range.`);
  if (isHeading(body[d.before - 1])) throw new Error(`${label}: immediately after a heading.`);
  if (isHeading(body[d.before])) throw new Error(`${label}: immediately before a heading.`);
}

/* ──────────────────────────── enrichment ─────────────────────────────────── */

interface Inserted { at: number; node: Node; kind: "pullQuote" | "divider"; text: string }

/**
 * Body enrichment. MUST only ever be handed a pristine body — every `before`
 * index in the plan, and every section boundary the placement guards derive,
 * is stated against the original node numbering. Run this against an
 * already-enriched body and the inserted nodes shift the section arithmetic
 * under it, so the caller checks for existing pullQuote/divider nodes first and
 * skips straight past this. (Nothing was ever mis-written when that check lived
 * downstream — the write was already gated — but the guards reported nonsense
 * on a second run, which is its own kind of bug.)
 */
function enrichBody(post: PostRow, plan: Plan) {
  const body = post.body;
  const plain = blockText(body);
  const inserts: Inserted[] = [];

  (plan.dividers ?? []).forEach((d, i) => {
    const label = `${post.slug} divider #${i + 1}`;
    assertDividerPlacement(body, d, label);
    inserts.push({
      at: d.before,
      kind: "divider",
      text: d.style,
      node: { _type: "divider", _key: `enrich-div-${i + 1}`, style: d.style },
    });
  });

  (plan.quotes ?? []).forEach((q, i) => {
    const label = `${post.slug} pull quote #${i + 1}`;
    const verbatim = resolveVerbatim(plain, q.text, label);

    // Which block does the sentence live in? That block's section is the only
    // place the quote may be parked.
    const sourceIdx = body.findIndex(
      (n) =>
        n._type === "block" &&
        fold((n.children ?? []).map((c) => c.text ?? "").join("")).includes(fold(verbatim)),
    );
    if (sourceIdx === -1) throw new Error(`${label}: sentence spans blocks — cannot place it.`);
    assertQuotePlacement(body, q, sourceIdx, label);

    inserts.push({
      at: q.before,
      kind: "pullQuote",
      text: verbatim,
      // attribution deliberately omitted — it is the author's own prose.
      node: { _type: "pullQuote", _key: `enrich-pq-${i + 1}`, text: verbatim },
    });
  });

  // Two pull quotes must not end up shoulder to shoulder.
  const quoteAts = inserts.filter((x) => x.kind === "pullQuote").map((x) => x.at).sort((a, b) => a - b);
  for (let i = 1; i < quoteAts.length; i += 1) {
    if (quoteAts[i] - quoteAts[i - 1] < 2) {
      throw new Error(`${post.slug}: two pull quotes are adjacent (${quoteAts[i - 1]}, ${quoteAts[i]}).`);
    }
  }

  // Build the new body. Descending order keeps the original indices valid.
  const next = body.slice();
  for (const ins of [...inserts].sort((a, b) => b.at - a.at)) next.splice(ins.at, 0, ins.node);

  // ── THE GATE ────────────────────────────────────────────────────────────
  const after = blockText(next);
  if (after !== plain) {
    throw new Error(`${post.slug}: INVARIANT VIOLATED — body text changed.\n${firstDivergence(plain, after)}`);
  }

  return { body: next, inserts };
}

/**
 * Takeaways are independent of body enrichment — they only need the prose — so
 * they resolve the same way whether or not the body has already been typeset.
 */
function resolveTakeaways(post: PostRow, plan: Plan): string[] {
  const plain = blockText(post.body);
  return (plan.takeaways ?? []).map((t, i) =>
    resolveVerbatim(plain, t, `${post.slug} takeaway #${i + 1}`),
  );
}

/* ──────────────────────────────── run ────────────────────────────────────── */

const QUERY = `*[_type == "post"]{
  _id, "slug": slug.current, title, body, keyTakeaways
} | order(slug asc)`;

async function main() {
  const posts: PostRow[] = await client.fetch(QUERY);
  console.log(`${posts.length} posts fetched. Mode: ${APPLY ? "APPLY (writes to Sanity)" : "DRY RUN (writes nothing)"}\n`);

  const review: string[] = [
    "# Blog enrichment — review",
    "",
    `Generated ${new Date().toISOString()} · ${APPLY ? "apply" : "dry run"} · dataset \`production\``,
    "",
    "Every pull quote and every key takeaway below is a sentence copied **verbatim** from",
    "that post's own prose, and every promoted sentence stays where it is in the body.",
    "The script asserts `blockText(enriched) === blockText(original)` per post before it",
    "writes anything; a single character of drift aborts that post.",
    "",
  ];

  let invariantPassed = 0;
  let bodiesTouched = 0;
  let takeawaysSet = 0;
  const skippedBody: string[] = [];
  const skippedTakeaways: string[] = [];

  for (const post of posts) {
    const plan = PLANS[post.slug];
    const words = blockText(post.body).split(/\s+/).filter(Boolean).length;

    review.push(`## ${post.title}`, "", `\`${post.slug}\` · ${words} words · \`${post._id}\``, "");

    if (!plan) {
      console.log(`- ${post.slug}: no plan, skipped.`);
      review.push("_No plan for this post — left untouched._", "");
      continue;
    }

    const alreadyEnriched = post.body.some((n) => n._type === "pullQuote" || n._type === "divider");
    const hasTakeaways = Array.isArray(post.keyTakeaways) && post.keyTakeaways.length > 0;

    // Idempotency, checked BEFORE any enrichment: a body that already carries
    // typesetting is read, reported and left exactly as it is. Re-running can
    // never stack a second set of pull quotes.
    let enriched: { body: Node[]; inserts: Inserted[] } | null = null;
    let takeaways: string[] = [];
    try {
      if (!alreadyEnriched) enriched = enrichBody(post, plan);
      takeaways = resolveTakeaways(post, plan);
    } catch (err) {
      console.error(`✗ ${post.slug}: ${(err as Error).message}\n`);
      review.push("**ABORTED** — nothing written for this post.", "", "```", (err as Error).message, "```", "");
      continue;
    }
    if (!alreadyEnriched) invariantPassed += 1;

    // Report — from the freshly planned inserts, or from what is already live.
    const live = post.body
      .map((n, at) => ({ n, at }))
      .filter(({ n }) => n._type === "pullQuote" || n._type === "divider")
      .map(({ n, at }) => ({
        at,
        kind: n._type as "pullQuote" | "divider",
        text: (n._type === "pullQuote" ? (n.text as string) : (n.style as string)) ?? "",
      }));
    const inserts = enriched ? enriched.inserts : live;

    const quotes = inserts.filter((x) => x.kind === "pullQuote");
    const dividers = inserts.filter((x) => x.kind === "divider").sort((a, b) => a.at - b.at);

    review.push(`**Pull quotes** (${quotes.length})`, "");
    if (quotes.length === 0) review.push("_None._", "");
    for (const q of quotes) {
      const prev = post.body[q.at - 1];
      const prevText = ((prev?.children ?? []).map((c) => c.text ?? "").join("")).slice(0, 70);
      review.push(`> ${q.text}`, "", `– before body block ${q.at}, i.e. after: "…${prevText}…"`, "");
    }

    review.push(`**Dividers** (${dividers.length})`, "");
    if (dividers.length === 0) review.push("_None._", "");
    for (const d of dividers) {
      const why = (plan.dividers ?? []).find((x) => x.before === d.at)?.why;
      review.push(`- \`${d.text}\` before body block ${d.at}${why ? ` — ${why}` : ""}`);
    }
    if (dividers.length) review.push("");

    review.push(`**Key takeaways** (${takeaways.length})`, "");
    if (takeaways.length === 0) review.push("_None._", "");
    for (const t of takeaways) review.push(`- ${t}`);
    review.push("");

    if (plan.note) review.push(`**Note.** ${plan.note}`, "");

    const status: string[] = [];
    if (alreadyEnriched) { skippedBody.push(post.slug); status.push("body already contains pullQuote/divider — body left alone"); }
    if (hasTakeaways) { skippedTakeaways.push(post.slug); status.push("keyTakeaways already set — left alone"); }
    if (status.length) review.push(`**Idempotency.** ${status.join("; ")}.`, "");

    review.push(
      enriched
        ? "Invariant: **passed** — enriched body text is byte-identical to the original."
        : "Invariant: n/a this run — body already typeset and left untouched.",
      "",
      "---",
      "",
    );

    // Write.
    const fields: Record<string, unknown> = {};
    if (enriched && enriched.inserts.length > 0) fields.body = enriched.body;
    if (!hasTakeaways && takeaways.length > 0) fields.keyTakeaways = takeaways;

    const summary = `${quotes.length} quote(s), ${dividers.length} divider(s), ${takeaways.length} takeaway(s)`;

    if (Object.keys(fields).length === 0) {
      console.log(`· ${post.slug}: nothing to write (${summary}).`);
      continue;
    }

    if (!APPLY) {
      console.log(`~ ${post.slug}: would set ${Object.keys(fields).join(", ")} — ${summary}`);
      continue;
    }

    // patch().set() — never createOrReplace: a sibling script is patching
    // heroImage on these same documents.
    await client.patch(post._id).set(fields).commit();
    if (fields.body) bodiesTouched += 1;
    if (fields.keyTakeaways) takeawaysSet += 1;
    console.log(`✓ ${post.slug}: set ${Object.keys(fields).join(", ")} — ${summary}`);
  }

  review.push(
    "## Summary",
    "",
    `- Posts whose invariant assertion ran and passed this run: **${invariantPassed}**`,
    `- Posts skipped for body enrichment (already had pullQuote/divider): ${skippedBody.length ? skippedBody.join(", ") : "none"}`,
    `- Posts skipped for keyTakeaways (already set): ${skippedTakeaways.length ? skippedTakeaways.join(", ") : "none"}`,
    "",
  );

  fs.mkdirSync(path.dirname(REVIEW_PATH), { recursive: true });
  fs.writeFileSync(REVIEW_PATH, review.join("\n"), "utf-8");

  console.log(`\nInvariant asserted and passed on ${invariantPassed} post(s) this run; ${skippedBody.length} already typeset and skipped.`);
  if (APPLY) console.log(`Wrote body on ${bodiesTouched}, keyTakeaways on ${takeawaysSet}.`);
  else console.log("Dry run — nothing written to Sanity. Re-run with --apply to commit.");
  console.log(`Review: ${REVIEW_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
