/**
 * The crawler's text reduction.
 *
 * This is the layer that produces the SNAPSHOT — the bytes that get hashed,
 * stored, quoted on a company page and shown to a reader as that company's own
 * words. A transformation that silently drops characters here is not a
 * formatting choice, it is a corruption of the evidence every score cites.
 */
import { describe, expect, it } from "vitest";
import { toText } from "../functions/_lib/crawl";

describe("entity decoding", () => {
  it("decodes a numeric apostrophe instead of blanking it", () => {
    // The regression. `&#\d+;` used to be replaced with a space, so a CMS that
    // writes apostrophes as &#8217; produced "We re stepping up". A model then
    // quoted the sentence correctly, with the apostrophe the site really shows,
    // and the citation check failed against our own mangled copy — the first
    // casualty of the quote gate was this bug, not a hallucination.
    expect(toText("<p>We&#8217;re stepping up</p>")).toBe("We’re stepping up");
  });

  it("decodes hex entities too", () => {
    expect(toText("<p>a &#x2019; b</p>")).toBe("a ’ b");
  });

  it("decodes accented letters rather than eating them", () => {
    // A blanking rule silently anglicises every non-ASCII company name on a
    // board that is full of European adtech.
    expect(toText("<p>caf&#233; cr&#232;me</p>")).toBe("café crème");
  });

  it("decodes &amp; last, so an escaped entity stays literal", () => {
    expect(toText("<p>Tom &amp; Jerry</p>")).toBe("Tom & Jerry");
    expect(toText("<p>&amp;#39; stays literal</p>")).toBe("&#39; stays literal");
  });

  it("leaves a malformed entity alone rather than throwing", () => {
    // One bad entity on one page must not cost the whole crawl.
    expect(toText("<p>&#99999999999; ok</p>")).toBe("&#99999999999; ok");
  });

  it("still strips script, style and markup", () => {
    expect(toText("<script>alert(1)</script><style>b{}</style><p>hi</p>")).toBe("hi");
  });

  it("collapses whitespace and honours the limit", () => {
    expect(toText("<p>a   \n  b</p>")).toBe("a b");
    expect(toText("<p>abcdef</p>", 3)).toBe("abc");
  });
});
