/**
 * Logo resolution. The interesting cases are the refusals — an extracted URL
 * the browser will not render is worse than no URL at all, because the board
 * shows a broken image instead of the blank placeholder.
 */
import { describe, expect, it } from "vitest";
import { logoCandidates, isUsable, resolveLogo } from "../functions/_lib/logo";

const BASE = "https://acme.com/";

describe("candidate order", () => {
  it("prefers apple-touch-icon over everything", () => {
    const html = `<link rel="apple-touch-icon" href="/touch.png">
                  <meta property="og:image" content="/card.png">`;
    expect(logoCandidates(html, BASE)[0].source).toBe("apple-touch-icon");
  });

  it("takes the largest declared apple-touch-icon first", () => {
    const html = `<link rel="apple-touch-icon" sizes="76x76" href="/small.png">
                  <link rel="apple-touch-icon" sizes="180x180" href="/big.png">`;
    expect(logoCandidates(html, BASE)[0].url).toBe("https://acme.com/big.png");
  });

  // og:image is usually a social card with a headline baked in. Stretched into
  // a 28px row avatar it looks like a bug, so it ranks below real icons.
  it("ranks og:image below declared icons", () => {
    const html = `<meta property="og:image" content="/card.png">
                  <link rel="icon" href="/icon.png">`;
    const sources = logoCandidates(html, BASE).map((c) => c.source);
    expect(sources.indexOf("link-icon")).toBeLessThan(sources.indexOf("og-image"));
  });

  it("reads a schema.org Organization logo", () => {
    const html = `<script type="application/ld+json">
      {"@type":"Organization","logo":{"@type":"ImageObject","url":"https://acme.com/l.png"}}</script>`;
    expect(logoCandidates(html, BASE).some((c) => c.source === "json-ld")).toBe(true);
  });

  it("always offers /favicon.ico as a last resort", () => {
    expect(logoCandidates("<html></html>", BASE).at(-1)?.url).toBe("https://acme.com/favicon.ico");
  });
});

describe("refusals", () => {
  // This is the pubx.ai case: a real logo, declared correctly, at an http raw
  // IP. Storing it would render a blocked image on the board.
  it("refuses plain http — it would be blocked as mixed content", () => {
    expect(isUsable("http://acme.com/logo.png")).toBe(false);
  });

  it("refuses a raw IP host — a leaked origin that will not survive a deploy", () => {
    expect(isUsable("https://18.205.7.45/app/uploads/company-logo.png")).toBe(false);
  });

  it("accepts an ordinary https url", () => {
    expect(isUsable("https://acme.com/logo.png")).toBe(true);
  });
});

describe("verification", () => {
  const html = `<link rel="apple-touch-icon" href="/dead.png">
                <link rel="icon" href="/live.png">`;

  it("skips a candidate that is not actually there", async () => {
    const found = await resolveLogo(html, BASE, async (url) =>
      url.endsWith("dead.png")
        ? { ok: false, contentType: null }
        : { ok: true, contentType: "image/png" });
    expect(found?.url).toBe("https://acme.com/live.png");
  });

  it("returns null rather than a broken url when everything fails", async () => {
    const found = await resolveLogo(html, BASE, async () => ({ ok: false, contentType: null }));
    expect(found).toBeNull();
  });

  // Some servers answer HEAD with no content-type but serve the image on GET.
  it("accepts a 200 with no content-type", async () => {
    const found = await resolveLogo(html, BASE, async () => ({ ok: true, contentType: null }));
    expect(found).not.toBeNull();
  });

  it("refuses something that is served but is not an image", async () => {
    const found = await resolveLogo(html, BASE, async () => ({ ok: true, contentType: "text/html" }));
    expect(found).toBeNull();
  });
});
