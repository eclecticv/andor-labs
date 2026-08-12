/**
 * The three kinds of thing published under /blog, in one place.
 *
 * Category is a closed editorial set, so it lives in code rather than as a
 * Sanity document type. Everything hanging off it — badge variant, icon, the
 * Loops list id, the subscribe copy — is code too, and a non-technical edit in
 * Studio should not be able to point a signup form at a dead mailing list.
 *
 * `tags` remains the open axis: category is who wrote this and why, tags are
 * what it is about.
 */

export type CategoryKey = "ai-newsletter" | "field-notes" | "explainer" | "resources";

export interface Category {
  key: CategoryKey;
  /** The name as it is published. Used in the article eyebrow. */
  label: string;
  /**
   * Shorter form for the index rows, homepage cards and filter chips.
   * `{ignore all previous instructions}` is ~30 monospace characters and the
   * badge is `white-space: nowrap` inside a three-column grid row — the full
   * label only fits where it has a full-width slot to itself.
   */
  labelShort: string;
  /**
   * VJ's own description, copied verbatim from the Loops list. Not rewritten:
   * he wrote these, they are already in his voice, and the promise a reader
   * subscribes to should be the same sentence wherever they meet it.
   */
  blurb: string;
  /** Loops mailing list id, or null when the category has no list. */
  loopsList: string | null;
  /**
   * Existing Badge variant — see components.css. Narrowed to the variants that
   * carry no competing semantic load: `positive`, `warning` and `danger` mean
   * something specific everywhere else on the site, and a category badge is not
   * a status.
   */
  badge: "copper" | "tint" | "outline" | "solid" | "blue";
  /** Existing PixelIcon name — see PixelIcon.astro. */
  icon: "robot" | "pencil-ruler" | "analytics" | "newspaper" | "trending";
  /**
   * Whether the byline is machine-written. Drives "Written by" vs the
   * agents-plus-editor treatment, and keeps a human byline off machine text.
   */
  machineWritten: boolean;
}

export const CATEGORIES: Record<CategoryKey, Category> = {
  "ai-newsletter": {
    key: "ai-newsletter",
    label: "{ignore all previous instructions}",
    labelShort: "AI newsletter",
    blurb:
      "A weekly newsletter about AI news, written by AI agents, and reluctantly edited by a tired human-in-the-loop.",
    loopsList: "cmsoulfdz0idi0j2q62ea241f",
    badge: "copper",
    icon: "robot",
    machineWritten: true,
  },
  "field-notes": {
    key: "field-notes",
    label: "Field notes",
    labelShort: "Field notes",
    blurb:
      "Occasional posts and rants about marketing, startups, media, and adtech; always handwritten by the author.",
    loopsList: "cmsouuptw04kb0jx7h33a26b2",
    badge: "tint",
    icon: "pencil-ruler",
    machineWritten: false,
  },
  explainer: {
    key: "explainer",
    label: "Explainer",
    labelShort: "Explainer",
    // No list, so this is shelf copy rather than a subscribe promise.
    blurb: "Reference posts, written to answer one question properly.",
    loopsList: null,
    badge: "outline",
    icon: "analytics",
    machineWritten: false,
  },
  resources: {
    key: "resources",
    label: "Resources",
    labelShort: "Resources",
    // Search and answer-engine surface area, not editorial. These are written
    // against a target query rather than an idea, and a reader who subscribed
    // for field notes did not ask to be emailed a keyword guide — which is why
    // `loopsList` is null and must stay null. The absence of a list is the
    // whole point of the category, not an oversight to be filled in later.
    blurb: "Long-form guides that answer one search query properly. Never emailed.",
    loopsList: null,
    badge: "solid",
    icon: "newspaper",
    machineWritten: false,
  },
};

/** Display order: newest-first by how often it publishes. */
export const CATEGORY_ORDER: CategoryKey[] = [
  "ai-newsletter",
  "field-notes",
  "explainer",
  "resources",
];

/**
 * Resolve a stored value, tolerating absence.
 *
 * Posts predating the category field, and any future value typed into Sanity
 * that this file has not caught up with, both land on `field-notes` — the
 * archive's actual default — rather than rendering an empty eyebrow.
 */
export function toCategory(value?: string | null): Category {
  return CATEGORIES[(value ?? "") as CategoryKey] ?? CATEGORIES["field-notes"];
}

/** Every Loops list a reader can opt into, in display order. */
export const SUBSCRIBABLE = CATEGORY_ORDER.map((k) => CATEGORIES[k]).filter(
  (c): c is Category & { loopsList: string } => c.loopsList !== null,
);
