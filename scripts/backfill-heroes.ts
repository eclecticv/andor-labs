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
 * Only touches posts with no hero. To replace existing art:
 *   npx sanity exec scripts/backfill-heroes.ts --with-user-token -- --force the-copilot-tax
 *   npx sanity exec scripts/backfill-heroes.ts --with-user-token -- --force all
 *
 * Every candidate is dithered and measured before it is accepted; one that
 * fails the quality gate is rejected and the fallback query is tried instead.
 *
 * Idempotent: posts that already have `heroImage` are skipped, so re-running
 * only fills the gaps. Use --force (above) to replace existing art.
 *
 * NOT added, deliberately: a landscape-only filter on the search. It was the
 * obvious guess for the flat-hero bug and the measurements disproved it — the
 * offending source was already 16:9. Trimming the dead border fixed it; an
 * aspect floor would only have thrown away usable portrait sources that trim
 * well. The quality gate is the general safety net, and it is evidence-based.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type {Metadata as SharpMetadata} from "sharp";
import { getCliClient } from "sanity/cli";
import {
  ditherToDuotoneWithStats,
  ditherPreset,
  qualityGateFailures,
  type DuotoneStats,
} from "./lib/dither";
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
      query: "railway viaduct arches",
      alt: "A stone viaduct arch framing an expanse of open sky.",
    },
    {
      query: "electricity pylon lattice tower sky",
      alt: "A steel lattice transmission tower standing against open sky.",
    },
  ],
  "death-of-the-mql": [
    {
      query: "bakelite telephone museum",
      alt: "A Bakelite rotary-dial telephone with its handset resting in the cradle.",
    },
    {
      query: "rotary dial telephone",
      alt: "An obsolete rotary dial telephone.",
    },
  ],
  "distribution-is-the-new-moat": [
    {
      query: "harbour crane silhouette sky",
      alt: "A harbour skyline with a distant crane, seen through the mesh of a net.",
    },
    {
      query: "container port gantry cranes silhouette",
      alt: "A row of container-port gantry cranes silhouetted against the sky.",
    },
  ],
  "doomsday-prepping-for-the-post-software-era": [
    {
      query: "thunderstorm supercell",
      alt: "A bank of storm cloud spread across the sky above a dark, open field.",
    },
    {
      query: "bunker beach sea",
      alt: "A wartime bunker half-buried in a coastal dune under an empty sky.",
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
      query: "lighthouse spiral staircase",
      alt: "Looking down the well of a lighthouse's spiral staircase, treads radiating around the centre.",
    },
    {
      query: "steep stone steps",
      alt: "A steep stone path climbing a bare rocky hillside.",
    },
  ],
  "human-in-the-loop-is-the-moat": [
    {
      query: "lone figure silhouette horizon",
      alt: "A small boat at sea in silhouette, a single figure seated at the helm.",
    },
    {
      query: "silhouette person large window",
      alt: "A single figure silhouetted against a tall, bright window.",
    },
  ],
  netflixification: [
    {
      query: "abandoned cinema",
      alt: "The street frontage of a long-closed cinema standing empty.",
    },
    {
      query: "derelict theatre",
      alt: "A derelict theatre standing empty.",
    },
  ],
  "the-copilot-tax": [
    {
      query: "arcade cabinets",
      alt: "A single upright arcade cabinet standing alone against a plain background.",
    },
    {
      query: "pinball machine",
      alt: "A pinball machine seen from above.",
    },
  ],
  "what-is-gtm-engineering": [
    {
      query: "steam locomotive wheels",
      alt: "A steam locomotive in profile, its driving wheels and coupling rods catching the light.",
    },
    {
      query: "large industrial gears machinery",
      alt: "The interlocking teeth of two large industrial gears.",
    },
  ],
  "what-is-inbound-led-outbound": [
    {
      query: "radio telescope dish sky",
      alt: "A row of radio telescope dishes silhouetted beneath a bright glow in a dark sky.",
    },
    {
      query: "satellite dish antenna silhouette",
      alt: "A satellite dish antenna silhouetted against the sky.",
    },
  ],
  "what-is-vibe-coding": [
    {
      query: "vinyl record grooves",
      alt: "An extreme close-up of a stylus riding in the groove of a vinyl record.",
    },
    {
      query: "bamboo scaffolding building",
      alt: "Scaffolding lashed in a lattice across the face of a building.",
    },
  ],
  "writing-is-the-worst-use-of-llms": [
    {
      query: "typewriter museum object",
      alt: "A portable manual typewriter photographed head-on, keys and carriage in view.",
    },
    {
      query: "Underwood typewriter",
      alt: "An antique Underwood typewriter.",
    },
  ],
  "you-dont-need-a-b-testing": [
    {
      query: "railway track junction switch",
      alt: "A railway point lever standing bright against a dark background beside the track.",
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
): Promise<{ result: OpenverseResult; png: Buffer; stats: DuotoneStats } | null> {
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

  // Dither HERE, not in the caller. The gate below can only drive the fallback
  // query if it runs inside the candidate loop; when this lived in main() the
  // fallback query could never fire, and across fourteen posts it never once
  // did — nothing was capable of rejecting a candidate.
  const { png, stats } = await ditherToDuotoneWithStats(bytes, ditherPreset.HERO);
  const failures = qualityGateFailures(stats);
  if (failures.length > 0) {
    console.log(`    · "${query}" → dithered badly (${failures.join("; ")}) — rejecting`);
    return null;
  }
  console.log(
    `    · "${query}" → ok (entropy ${stats.entropy.toFixed(3)}, flat ${(stats.flatCellPct * 100).toFixed(1)}%, shadow ${(stats.shadowPct * 100).toFixed(1)}%)`,
  );
  return { result, png, stats };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // `--force <slug>` (repeatable, or `--force all`) re-does a post that already
  // has a hero. Without it the only way to replace bad art was to delete the
  // field in Studio first, which is a silly thing to ask of an editor who just
  // wants a different picture.
  const argv = process.argv.slice(2);
  const forced = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--force" && argv[i + 1]) forced.add(argv[++i]);
  }
  const forceAll = forced.has("all");

  const filter = forceAll
    ? "true"
    : forced.size > 0
      ? "!defined(heroImage) || slug.current in $forced"
      : "!defined(heroImage)";

  const posts: PostRow[] = await client.fetch(
    `*[_type == "post" && (${filter})]{ _id, "slug": slug.current, title } | order(slug asc)`,
    { forced: [...forced] },
  );

  if (forced.size > 0) {
    console.log(`Forcing regeneration: ${forceAll ? "ALL posts" : [...forced].join(", ")}`);
  }

  const total: number = await client.fetch(`count(*[_type == "post"])`);
  console.log(`${total} posts total; ${posts.length} to process.\n`);

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

    const { result, png, stats } = picked;

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
      `    ✓ "${used.query}" → entropy ${stats.entropy.toFixed(3)} → ${asset._id}  [${credit}]`,
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
