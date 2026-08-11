/**
 * Backfill dithered hero images onto every `post` that lacks one.
 *
 * Openverse search -> download -> Bayer-dither to the house duotone ->
 * upload to Sanity -> PATCH `heroImage` (never createOrReplace: other
 * migrations write sibling fields on these same documents).
 *
 * Run with:
 *   npx sanity exec scripts/backfill-heroes.ts --with-user-token
 *
 * Idempotent: posts that already have `heroImage` are skipped, so re-running
 * only fills the gaps. Delete a hero in Studio and re-run to re-source it.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type {Metadata as SharpMetadata} from "sharp";
import { getCliClient } from "sanity/cli";
import { ditherToDuotone, ditherPreset } from "./lib/dither";
import {
  searchImage,
  attributionLine,
  fetchImageBytes,
  type OpenverseResult,
} from "./lib/openverse";

const client = getCliClient({ apiVersion: "2026-07-01" });

const OUT_DIR =
  "/private/tmp/claude-501/-Users-transl8r/aa04465f-d4f0-4c4a-ab2b-c58d894c6a77/scratchpad";

/**
 * Minimum *decoded* source width. Openverse sometimes advertises dimensions
 * larger than the bytes it actually serves; a 1600px hero upscaled from an
 * 800px source dithers to mush, so we measure the real pixels and move on to
 * the next candidate rather than accept it.
 */
const MIN_DECODED_WIDTH = 1200;

/** Politeness delay between Openverse requests. */
const DELAY_MS = 1200;

interface HeroCandidate {
  /** Chosen for what survives a hard 2-colour threshold: silhouette,
   *  geometry, tonal separation, negative space. */
  query: string;
  /** Screen-reader description of the *photograph*, not the article. Paired
   *  with the query so the alt text stays true whichever candidate wins. */
  alt: string;
}

/**
 * Queries are hand-picked per slug, never derived from titles: "Death of the
 * MQL" and "Netflixification" are not photographable, so each abstract post
 * gets a concrete stand-in instead. Two candidates each — the second is only
 * reached when the first returns nothing usable.
 */
const PLANS: Record<string, [HeroCandidate, HeroCandidate]> = {
  "content-engineering-not-content-marketing": [
    {
      query: "electricity pylon lattice tower sky",
      alt: "A steel lattice transmission tower standing against open sky.",
    },
    {
      query: "railway viaduct arches",
      alt: "The repeating arches of a stone railway viaduct.",
    },
  ],
  "death-of-the-mql": [
    {
      query: "rotary dial telephone",
      alt: "An obsolete rotary dial telephone.",
    },
    {
      query: "abandoned telephone booth",
      alt: "A derelict telephone booth standing alone.",
    },
  ],
  "distribution-is-the-new-moat": [
    {
      query: "container port gantry cranes silhouette",
      alt: "A row of container-port gantry cranes silhouetted against the sky.",
    },
    {
      query: "harbour crane silhouette sky",
      alt: "A harbour crane silhouetted against a bright sky.",
    },
  ],
  "doomsday-prepping-for-the-post-software-era": [
    {
      query: "concrete bunker entrance",
      alt: "A concrete bunker entrance set into bare ground.",
    },
    {
      query: "storm clouds over empty field",
      alt: "Heavy storm clouds massing over an empty field.",
    },
  ],
  "how-to-get-started-with-claude-code": [
    {
      query: "industrial robot arm",
      alt: "An articulated industrial robot arm.",
    },
    {
      query: "assembly line robots",
      alt: "Robots working along an automated assembly line.",
    },
  ],
  "how-to-think-about-effort": [
    {
      query: "steep stone steps",
      alt: "A steep stone path climbing a bare rocky hillside.",
    },
    {
      query: "mountain trail switchbacks",
      alt: "A mountain trail switchbacking up a hillside.",
    },
  ],
  "human-in-the-loop-is-the-moat": [
    {
      query: "silhouette person large window",
      alt: "A single figure silhouetted against a tall, bright window.",
    },
    {
      query: "lone figure silhouette horizon",
      alt: "A lone figure silhouetted against an open horizon.",
    },
  ],
  netflixification: [
    {
      query: "abandoned cinema",
      alt: "The empty, decaying interior of an abandoned cinema.",
    },
    {
      query: "derelict theatre",
      alt: "A derelict theatre standing empty.",
    },
  ],
  "the-copilot-tax": [
    {
      query: "airplane wing above clouds",
      alt: "An aircraft wing above an unbroken bank of cloud.",
    },
    {
      query: "aircraft wing sky clouds",
      alt: "An aircraft wing against a cloudy sky.",
    },
  ],
  "what-is-gtm-engineering": [
    {
      query: "large industrial gears machinery",
      alt: "The interlocking teeth of two large industrial gears.",
    },
    {
      query: "cast iron gear wheel mechanism",
      alt: "A cast-iron gear wheel in an old mechanism.",
    },
  ],
  "what-is-inbound-led-outbound": [
    {
      query: "radio telescope dish sky",
      alt: "A radio telescope dish tilted toward an open sky.",
    },
    {
      query: "satellite dish antenna silhouette",
      alt: "A satellite dish antenna silhouetted against the sky.",
    },
  ],
  "what-is-vibe-coding": [
    {
      query: "bamboo scaffolding building",
      alt: "Scaffolding lashed in a lattice across the face of a building.",
    },
    {
      query: "construction scaffolding silhouette sky",
      alt: "Construction scaffolding silhouetted against the sky.",
    },
  ],
  "writing-is-the-worst-use-of-llms": [
    {
      query: "typewriter",
      alt: "A manual typewriter, carriage and typebars in view.",
    },
    {
      query: "quill pen inkwell",
      alt: "A quill pen resting beside an inkwell.",
    },
  ],
  "you-dont-need-a-b-testing": [
    {
      query: "railway track junction switch",
      alt: "A railway junction where a single track splits into two.",
    },
    {
      query: "fork in the road two paths",
      alt: "A path forking into two diverging routes.",
    },
  ],
};

interface PostRow {
  _id: string;
  slug: string;
  title: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch a candidate and confirm the bytes are actually big enough to dither.
 * Returns null (rather than throwing) so the caller can try the next query.
 */
async function tryCandidate(
  query: string,
): Promise<{ result: OpenverseResult; bytes: Buffer; decodedWidth: number } | null> {
  const result = await searchImage(query);
  if (!result) {
    console.log(`    · "${query}" → no usable result`);
    return null;
  }
  let bytes: Buffer;
  try {
    bytes = await fetchImageBytes(result.url);
  } catch (err) {
    console.log(`    · "${query}" → download failed: ${(err as Error).message}`);
    return null;
  }
  let meta: SharpMetadata;
  try {
    meta = await sharp(bytes, { failOn: "none" }).metadata();
  } catch (err) {
    console.log(`    · "${query}" → undecodable: ${(err as Error).message}`);
    return null;
  }
  const decodedWidth = meta.width ?? 0;
  if (decodedWidth < MIN_DECODED_WIDTH) {
    console.log(
      `    · "${query}" → decoded ${decodedWidth}px wide (advertised ${result.width ?? "?"}), below ${MIN_DECODED_WIDTH} — rejecting`,
    );
    return null;
  }
  return { result, bytes, decodedWidth };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const posts: PostRow[] = await client.fetch(
    `*[_type == "post" && !defined(heroImage)]{ _id, "slug": slug.current, title } | order(slug asc)`,
  );

  const total: number = await client.fetch(`count(*[_type == "post"])`);
  console.log(`${total} posts total; ${posts.length} without a hero image.\n`);

  const done: { slug: string; query: string; credit: string; license: string; landing: string }[] = [];
  const skipped: { slug: string; reason: string }[] = [];

  for (const post of posts) {
    const candidates = PLANS[post.slug];
    console.log(`→ ${post.slug}  (${post.title})`);
    if (!candidates) {
      console.log(`    ! no curated query for this slug — skipping`);
      skipped.push({ slug: post.slug, reason: "no curated query in PLANS" });
      continue;
    }

    // Serial, with a pause between searches — this is an anonymous, unkeyed API.
    let picked: Awaited<ReturnType<typeof tryCandidate>> = null;
    let used: HeroCandidate = candidates[0];
    for (const candidate of candidates) {
      if (picked) break;
      if (candidate !== candidates[0]) await sleep(DELAY_MS);
      used = candidate;
      picked = await tryCandidate(candidate.query);
    }

    if (!picked) {
      console.log(`    ! both queries exhausted — no hero for this post`);
      skipped.push({
        slug: post.slug,
        reason: `no usable image for ${candidates.map((c) => `"${c.query}"`).join(" / ")}`,
      });
      await sleep(DELAY_MS);
      continue;
    }

    const { result, bytes, decodedWidth } = picked;
    const png = await ditherToDuotone(bytes, ditherPreset.HERO);

    const filename = `${post.slug}-hero.png`;
    fs.writeFileSync(path.join(OUT_DIR, filename), png);

    const asset = await client.assets.upload("image", png, {
      filename,
      contentType: "image/png",
    });

    const credit = attributionLine(result);
    await client
      .patch(post._id)
      .set({
        heroImage: {
          _type: "image",
          asset: { _type: "reference", _ref: asset._id },
          alt: used.alt,
          // Caption intentionally left empty: a caption that restates the
          // headline is noise. VJ can write real ones in Studio.
          credit,
        },
      })
      .commit();

    console.log(
      `    ✓ "${used.query}" → ${decodedWidth}px src → ${asset._id}  [${credit}]`,
    );
    done.push({
      slug: post.slug,
      query: used.query,
      credit,
      license: result.license,
      landing: result.foreignLandingUrl,
    });
    await sleep(DELAY_MS);
  }

  // Merge with any previous run's report so a second pass over the leftovers
  // doesn't erase the record of what the first pass sourced.
  const reportPath = path.join(OUT_DIR, "hero-backfill-report.json");
  let previous: { done: typeof done } = { done: [] };
  if (fs.existsSync(reportPath)) {
    try {
      previous = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
    } catch {
      /* corrupt or older shape — start fresh */
    }
  }
  const merged = [...(previous.done ?? []).filter((p) => !done.some((d) => d.slug === p.slug)), ...done];
  merged.sort((a, b) => a.slug.localeCompare(b.slug));
  fs.writeFileSync(reportPath, JSON.stringify({ done: merged, skipped }, null, 2));

  const withHero: number = await client.fetch(
    `count(*[_type == "post" && defined(heroImage)])`,
  );
  console.log(`\nPatched ${done.length}, skipped ${skipped.length}.`);
  console.log(`${withHero}/${total} posts now have defined(heroImage).`);
  console.log(`PNGs + report in ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
