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
 * The three named categories share a buyer, not a vertical: technically complex
 * products sold to skeptical technical people. That is what makes the operator
 * track record transferable across all three.
 */
export const ICP = "AI, adtech and deeptech";

/** The ICP as a noun phrase, e.g. "We help {ICP_STARTUPS} lead their category". */
export const ICP_STARTUPS = `${ICP} startups`;

/**
 * The one-sentence promise — hero subhead AND meta description.
 *
 * These were two separately-typed sentences making two different claims, so the
 * search snippet promised something the page didn't. Same phrase, one source.
 */
export const PROMISE = `We help ${ICP_STARTUPS} lead their category through clear positioning, organic growth systems, and custom GTM intelligence.`;
