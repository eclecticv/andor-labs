// Site-wide constants that are referenced from more than one component.
// Kept here so a change lands in one place — the booking URL in particular
// used to be copy-pasted across six files, two of which declared their own
// rival local constant for it. That is one missed grep away from a stale CTA.

/** Destination for every "Book a call" / "Let's talk" CTA on the site. */
export const BOOKING_URL = "https://cal.com/jatain/book";

/**
 * Who the site says it's for.
 *
 * This drifted into THREE live phrasings before it was centralised — "adtech",
 * then "AI, tech & media" in the hero, then "early-stage B2B" everywhere else —
 * because the same idea was retyped in nine files across two broadening passes.
 * The first screen ended up giving three different answers to "is this for me?".
 * Change it here; every surface follows.
 *
 * Narrowed back to adtech on 2026-08-21, deliberately. The hero promise now
 * names advertising technology and nothing else, and an ICP left broad would
 * have reopened the exact split this constant exists to close: a subhead
 * selling to one category with three sections under it selling to three.
 */
export const ICP = "adtech";

/** The ICP as a noun phrase, e.g. "We help {ICP_STARTUPS} lead their category". */
export const ICP_STARTUPS = `${ICP} startups`;

/**
 * The one-sentence promise — hero subhead AND meta description.
 *
 * These were two separately-typed sentences making two different claims, so the
 * search snippet promised something the page didn't. Same phrase, one source.
 *
 * Spelled out as "advertising technology" rather than interpolating ICP: this is
 * the first sentence a stranger reads and "adtech" is house shorthand. It is the
 * one surface that does not derive from ICP, so the two must be moved together.
 */
export const PROMISE = "We're a boutique consultancy helping advertising technology startups find product-market fit, accelerate revenue growth, and win their category.";
