// Derived facts about a post body: plain text, word count, reading time, TOC.
//
// Everything here is computed at build from `post.body`. Nothing is stored back
// in Sanity — a stored word count silently goes stale the moment anyone edits a
// paragraph in Studio, and the staleness is invisible because the number still
// looks plausible.

import type {PortableTextBlock, PortableTextSpan, TypedObject} from "@portabletext/types";

/**
 * A node in a `body` array. Sanity mixes real text blocks with custom objects
 * (`pullQuote`, `figure`, `callout`, …) in the same array, and the only thing
 * they are guaranteed to share is `_type`. Narrow with the guards below before
 * touching anything else.
 */
export type BodyNode = TypedObject;

/** The `body` field as it arrives from GROQ — possibly absent on a draft. */
export type PortableTextBody = readonly BodyNode[] | null | undefined;

/** `callout` renders a nested block array, so its prose belongs in the plain text. */
interface CalloutNode extends TypedObject {
  _type: "callout";
  body?: readonly BodyNode[];
}

/** `pullQuote` promotes an existing sentence; its text is real prose, not chrome. */
interface PullQuoteNode extends TypedObject {
  _type: "pullQuote";
  text?: string;
}

export interface Heading {
  /** Slug of the heading text, deduplicated — see `extractHeadings`. */
  id: string;
  text: string;
  /** 2 or 3. h4 exists in the schema but is too deep to be useful in a TOC. */
  level: 2 | 3;
}

function isTextBlock(node: BodyNode): node is PortableTextBlock {
  return node._type === "block" && Array.isArray((node as PortableTextBlock).children);
}

function isSpan(child: TypedObject): child is PortableTextSpan {
  return child._type === "span" && typeof (child as PortableTextSpan).text === "string";
}

function isCallout(node: BodyNode): node is CalloutNode {
  return node._type === "callout";
}

function isPullQuote(node: BodyNode): node is PullQuoteNode {
  return node._type === "pullQuote";
}

/** Concatenated text of every span in a block. Marks are structural, not textual. */
function blockText(block: PortableTextBlock): string {
  return block.children
    .filter(isSpan)
    .map((span) => span.text)
    .join("");
}

/**
 * Flattens a body to plain prose, one paragraph per entry, blocks separated by a
 * blank line.
 *
 * Image, figure and codeBlock nodes are skipped: a code listing would inflate the
 * word count and the reading time with tokens nobody reads at prose speed, and an
 * image contributes no words at all.
 */
export function toPlainText(blocks: PortableTextBody): string {
  if (!blocks?.length) return "";

  const segments: string[] = [];

  for (const node of blocks) {
    if (isTextBlock(node)) {
      const text = blockText(node);
      if (text) segments.push(text);
    } else if (isCallout(node)) {
      // A callout's body is a body array of its own, so recurse rather than
      // duplicating the span-walking here.
      const inner = toPlainText(node.body);
      if (inner) segments.push(inner);
    } else if (isPullQuote(node) && node.text) {
      segments.push(node.text);
    }
  }

  return segments.join("\n\n");
}

export function wordCount(blocks: PortableTextBody): number {
  const text = toPlainText(blocks).trim();
  if (!text) return 0;
  return text.split(/\s+/).length;
}

/**
 * Reading time in whole minutes.
 *
 * 220 wpm is the usual figure for considered non-fiction — slower than the ~250
 * often quoted for light reading, because these posts are read to be argued with.
 * Floored at 1 so a two-paragraph note never claims "0 min read".
 */
export function readingTime(blocks: PortableTextBody): number {
  return Math.max(1, Math.round(wordCount(blocks) / 220));
}

/**
 * Turns heading text into an anchor id.
 *
 * Exported because the article template must stamp the *same* id onto the `<h2>`
 * itself — if the TOC and the heading each slugify independently with different
 * rules, every anchor in the post silently points at nothing.
 */
export function slugifyHeading(text: string): string {
  return (
    text
      // Decompose accents so the combining marks can be dropped: "Résumé" should
      // become "resume", not "r-sum-".
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "")
  );
}

/**
 * The h2/h3 headings of a post, in document order, for the sticky TOC rail.
 *
 * Ids are deduplicated with a `-2`, `-3` suffix. Repeated headings are ordinary
 * in a long post, and duplicate DOM ids make every anchor after the first
 * resolve to the wrong section — the browser jumps to the first match, so the
 * TOC looks broken rather than merely imprecise.
 */
export function extractHeadings(blocks: PortableTextBody): Heading[] {
  if (!blocks?.length) return [];

  const seen = new Map<string, number>();
  const headings: Heading[] = [];

  for (const node of blocks) {
    if (!isTextBlock(node)) continue;
    if (node.style !== "h2" && node.style !== "h3") continue;

    const text = blockText(node).trim();
    if (!text) continue;

    // An unslugifiable heading (pure punctuation, CJK) still needs a stable id.
    const base = slugifyHeading(text) || "section";
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);

    headings.push({
      id: count === 1 ? base : `${base}-${count}`,
      text,
      level: node.style === "h2" ? 2 : 3,
    });
  }

  return headings;
}
