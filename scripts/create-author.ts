/**
 * One-time migration: create the single `author` document that every post's
 * byline, author card and Person JSON-LD resolve from.
 *
 * Run with:
 *   npx sanity exec scripts/create-author.ts --with-user-token
 *
 * Idempotent: fixed `_id` + createOrReplace, so re-running refreshes the
 * document rather than minting a second identity. The photo upload is safe to
 * repeat too — Sanity dedupes assets by content hash and hands back the
 * existing one when the bytes are unchanged.
 *
 * EVERY claim below is lifted from something the live site already says. No
 * years of experience, no client names, no metrics were invented here. The
 * source of each line, for the next person who has to audit this:
 *
 *   role         src/components/sections/FounderNote.astro:34
 *                  "Founder, And/or Labs"
 *   bio ¶1       src/components/sections/FounderNote.astro:34
 *   bio ¶1       src/components/sections/FounderNote.astro:40
 *                  "After leading product marketing and operations for
 *                   startups that sold for >$100M, I now help {ICP} teams
 *                   set themselves up to win."
 *   bio ¶1       src/config.ts:22,33  ICP + PROMISE
 *                  "AI, adtech, and deeptech" / "clear positioning, deep
 *                   market intelligence, and autonomous growth systems"
 *   credential 1 src/components/sections/FAQ.astro:10
 *                  "...ran product marketing and sales operations through
 *                   two exits above $100M."
 *   credential 2 src/components/sections/FAQ.astro:10
 *                  "The founder, directly. No account layers and no handoff
 *                   once the pitch is over."
 *   credential 3 src/components/sections/SiteFooter.astro:21
 *                  "Full-stack GTM for visionary builders & operators"
 *   sameAs[0]    src/layouts/Base.astro:75  twitter:creator @eclecticV
 *   sameAs[1]    src/components/sections/SiteFooter.astro:11
 *
 * Note on what is deliberately ABSENT: src/components/sections/Hero.astro:83
 * carries "former Head of Marketing at Blockthrough & AdPushup", but that line
 * is commented out and therefore does not appear on the live site, so it is not
 * repeated here.
 */
import fs from "node:fs";
import path from "node:path";
import { getCliClient } from "sanity/cli";
import { ICP } from "../src/config";

const AUTHOR_ID = "author-vishveshwar-jatain";
const PHOTO_PATH = path.join(process.cwd(), "public/founder.png");

const client = getCliClient({ apiVersion: "2026-07-01" });

/** Minimal Portable Text paragraph — the bio renders inside a card, not a page. */
function block(text: string, key: string) {
  return {
    _type: "block",
    _key: key,
    style: "normal",
    markDefs: [],
    children: [{ _type: "span", _key: `${key}-s0`, text, marks: [] }],
  };
}

async function main() {
  if (!fs.existsSync(PHOTO_PATH)) {
    throw new Error(`Founder photo not found at ${PHOTO_PATH}`);
  }

  console.log(`Uploading ${PHOTO_PATH} …`);
  const asset = await client.assets.upload("image", fs.createReadStream(PHOTO_PATH), {
    filename: "founder.png",
  });
  console.log(`✓ asset ${asset._id}  (${asset.originalFilename})`);

  const doc = {
    _id: AUTHOR_ID,
    _type: "author",
    name: "Vishveshwar Jatain",
    slug: { _type: "slug", current: "vishveshwar-jatain" },
    role: "Founder, And/or Labs",
    photo: {
      _type: "image",
      asset: { _type: "reference", _ref: asset._id },
      alt: "Vishveshwar Jatain",
    },
    bio: [
      block(
        `Vishveshwar Jatain is the founder of And/or Labs. After leading product marketing and operations for startups that sold for more than $100M, he now helps ${ICP} teams set themselves up to win.`,
        "bio-0",
      ),
      block(
        "The work is clear positioning, deep market intelligence, and autonomous growth systems.",
        "bio-1",
      ),
    ],
    credentials: [
      "Ran product marketing and sales operations through two exits above $100M",
      "Works with clients directly — no account layers, no handoff once the pitch is over",
      "Full-stack GTM for visionary builders and operators",
    ],
    // Feeds Person.sameAs. Both URLs already exist in the repo; nothing is
    // guessed or reconstructed from a name.
    sameAs: [
      "https://x.com/eclecticV",
      "https://www.linkedin.com/in/vishveshwar-jatain",
    ],
  };

  await client.createOrReplace(doc);
  console.log(`✓ ${doc._id}  (${doc.name} — ${doc.role})`);
  console.log("\nDone. Author document is live.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
