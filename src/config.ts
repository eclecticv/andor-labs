// Site-wide constants that are referenced from more than one component.
// Kept here so a change lands in one place — the booking URL in particular
// used to be copy-pasted across six files, two of which declared their own
// rival local constant for it. That is one missed grep away from a stale CTA.

/** Destination for every "Book a call" / "Let's talk" CTA on the site. */
export const BOOKING_URL = "https://cal.com/jatain/book";
