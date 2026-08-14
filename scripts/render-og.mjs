/**
 * Renders an OG card from a /lab/ route to a PNG in public/.
 *
 * The cards are authored as real pages (src/pages/lab/og-*.astro) so they use the
 * site's own tokens and webfonts rather than a lookalike. This script is the only
 * thing that turns one into a file.
 *
 * Captured at deviceScaleFactor 2. Cards are authored at 1200x600 (a true 2:1, so
 * X does not centre-crop them) and land as 2400x1200 files.
 *
 *   node scripts/render-og.mjs                       # all known cards
 *   node scripts/render-og.mjs subreddit-scout       # just one
 *
 * Requires the dev server on :4321 (npm run dev).
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = process.env.OG_ORIGIN ?? "http://127.0.0.1:4321";

/**
 * slug → { route, out }. Add a line per card.
 *
 * `out` is explicit because the DEFAULT card has to land on public/og.png — the
 * filename Base.astro falls back to for every page that does not set its own —
 * rather than on og-site.png.
 */
const CARDS = {
  site: { route: "/lab/og-site", out: "og.png" },
  "subreddit-scout": { route: "/lab/og-subreddit-scout", out: "og-subreddit-scout.png" },
  "rank-my-adtech": { route: "/lab/og-rank-my-adtech", out: "og-rank-my-adtech.png" },
};

const wanted = process.argv.slice(2);
const todo = wanted.length ? wanted : Object.keys(CARDS);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 600 },
    deviceScaleFactor: 2,
  });

  await mkdir(join(ROOT, "public"), { recursive: true });

  for (const slug of todo) {
    const card = CARDS[slug];
    if (!card) {
      console.error(`unknown card "${slug}" — known: ${Object.keys(CARDS).join(", ")}`);
      process.exitCode = 1;
      continue;
    }

    const res = await page.goto(ORIGIN + card.route, { waitUntil: "networkidle" });
    if (!res || !res.ok()) {
      throw new Error(`${card.route} returned ${res ? res.status() : "no response"} — is the dev server up?`);
    }
    // Webfonts decide the line breaks, so a capture before they land is a
    // different picture than the one that was designed.
    await page.evaluate(() => document.fonts.ready);

    const out = join(ROOT, "public", card.out);
    // Clip rather than fullPage: the card is a fixed 1200x630 canvas and any
    // stray body margin would otherwise pad the image.
    await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1200, height: 600 } });
    console.log(`wrote public/${card.out}`);
  }
} finally {
  await browser.close();
}
