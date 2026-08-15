/**
 * How often does the band detector actually fire?
 *
 * Crawl-only — no model calls, so this is free and fast. The question it
 * answers is whether the three-band board is viable at all: if structural
 * funding evidence appears on only a handful of sites, then almost every
 * company defaults to the middle band, two of the three tabs stay permanently
 * empty, and the tabs are advertising a structure the data cannot support.
 *
 *   set -a; . ./.dev.vars; set +a
 *   npx tsx scripts/probe-bands.mts < domains.txt
 */
import { readSite } from "../functions/_lib/crawl";
import { placeFromMarkup } from "../functions/_lib/classify";

const domains = (await new Response(process.stdin as any).text())
  .split("\n").map((d) => d.trim()).filter((d) => d && !d.startsWith("#"));

const rows: { domain: string; band: string; why: string; chars: number }[] = [];

// Crawled in small batches: these are independent hosts, but firing thirty
// concurrent crawls is how you get rate-limited by a CDN that fronts several
// of them.
const BATCH = 6;
for (let i = 0; i < domains.length; i += BATCH) {
  const batch = domains.slice(i, i + BATCH);
  const results = await Promise.all(
    batch.map(async (domain) => {
      try {
        const site = await readSite(domain);
        if (!site.html) return { domain, band: "UNREACHABLE", why: "", chars: 0 };
        const found = placeFromMarkup(site.html, site.pages);
        return {
          domain,
          band: found.isPublic ? "PUBLIC" : (found.band ?? "—"),
          why: found.isPublic ?? found.evidence ?? "",
          chars: site.pages.length,
        };
      } catch (e) {
        return { domain, band: "ERROR", why: String(e).slice(0, 60), chars: 0 };
      }
    }),
  );
  rows.push(...results);
  for (const r of results) {
    console.log(`${r.band.padEnd(10)} ${r.domain.padEnd(28)} ${String(r.chars).padStart(6)}  ${r.why}`);
  }
}

const count = (b: string) => rows.filter((r) => r.band === b).length;
console.log(`\n─── ${rows.length} sites ───`);
for (const b of ["emerging", "growth", "mature", "PUBLIC", "—", "UNREACHABLE", "ERROR"]) {
  const n = count(b);
  if (n) console.log(`${b.padEnd(12)} ${n}  ${"█".repeat(n)}`);
}
const detected = count("emerging") + count("growth") + count("mature");
console.log(`\nband detected on ${detected}/${rows.length} (${Math.round((detected / rows.length) * 100)}%)`);
