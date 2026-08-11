// Hand-rolled Sanity CDN URL builder.
//
// `@sanity/image-url` is ~40kB of dependency to do what the fifteen lines below
// do: parse an asset `_ref` and append query params. The ref format is stable
// and public, and the whole surface we use is width/height/fit/quality/format.

const PROJECT_ID = "2b9cfqwh";
const DATASET = "production";
const CDN_BASE = `https://cdn.sanity.io/images/${PROJECT_ID}/${DATASET}`;

/**
 * `image-<assetId>-<width>x<height>-<ext>` — the shape Sanity gives every image
 * asset reference. The dimensions ride along in the id itself, which is why we
 * can emit real width/height attributes without a second round trip.
 */
const REF_PATTERN = /^image-([a-zA-Z0-9]+)-(\d+)x(\d+)-(\w+)$/;

export interface SanityImageAsset {
  _ref?: string;
  _type?: string;
}

export interface SanityImageObject {
  asset?: SanityImageAsset | null;
  alt?: string;
  caption?: string;
  credit?: string;
}

/** Everything a caller might reasonably be holding, including nothing. */
export type SanityImageSource = SanityImageObject | SanityImageAsset | string | null | undefined;

/** Sanity's crop modes. `crop` respects the hotspot; `max` never upscales. */
export type ImageFit = "clip" | "crop" | "fill" | "fillmax" | "max" | "min" | "scale";

export type ImageFormat = "jpg" | "png" | "webp" | "auto";

export interface ImageUrlOptions {
  width?: number;
  height?: number;
  fit?: ImageFit;
  /** 1–100. Sanity defaults to 75. */
  quality?: number;
  format?: ImageFormat;
}

export interface ImageDimensions {
  width: number;
  height: number;
}

/** Pulls the `_ref` out of whichever of the three shapes was passed. */
function refOf(source: SanityImageSource): string | null {
  if (!source) return null;
  if (typeof source === "string") return source;
  if ("asset" in source && source.asset?._ref) return source.asset._ref;
  if ("_ref" in source && source._ref) return source._ref;
  return null;
}

function parseRef(source: SanityImageSource): {filename: string; dimensions: ImageDimensions} | null {
  const ref = refOf(source);
  if (!ref) return null;

  const match = REF_PATTERN.exec(ref);
  if (!match) return null;

  const [, assetId, width, height, extension] = match;
  return {
    // The CDN path re-joins the parts with a dot before the extension.
    filename: `${assetId}-${width}x${height}.${extension}`,
    dimensions: {width: Number(width), height: Number(height)},
  };
}

/**
 * A `cdn.sanity.io` URL for the given image, or `""` when there is no image.
 *
 * The empty string rather than a throw or a null: every call site is inside a
 * template, where `{url && <img src={url} />}` is the natural guard and a
 * try/catch is not.
 */
export function imageUrl(source: SanityImageSource, options: ImageUrlOptions = {}): string {
  const parsed = parseRef(source);
  if (!parsed) return "";

  const params = new URLSearchParams();
  if (options.width) params.set("w", String(options.width));
  if (options.height) params.set("h", String(options.height));
  if (options.fit) params.set("fit", options.fit);
  if (options.quality) params.set("q", String(options.quality));
  if (options.format === "auto") {
    // `auto=format` is a different parameter from `fm` — it lets the CDN pick
    // webp/avif per Accept header instead of pinning one encoding.
    params.set("auto", "format");
  } else if (options.format) {
    params.set("fm", options.format);
  }

  const query = params.toString();
  return query ? `${CDN_BASE}/${parsed.filename}?${query}` : `${CDN_BASE}/${parsed.filename}`;
}

/**
 * The image's intrinsic dimensions, read out of the asset ref.
 *
 * The hero needs real `width`/`height` attributes so the browser can reserve the
 * box before the bytes land — without them the hero is the LCP element *and* the
 * biggest layout shift on the page.
 */
export function imageDimensions(source: SanityImageSource): ImageDimensions | null {
  return parseRef(source)?.dimensions ?? null;
}

/**
 * A 1200×630 social card cropped from the hero, or the site card when a post has
 * no hero yet.
 *
 * jpg rather than auto/webp: several crawlers still fetch OG images without a
 * meaningful Accept header, and a webp they cannot decode renders as no card at
 * all. q=80 keeps a dithered duotone under the 1MB most platforms enforce.
 *
 * The fallback stays site-relative; `Base.astro` resolves it against `Astro.site`,
 * and `new URL()` passes an absolute CDN URL through untouched.
 */
export function ogImageUrl(source: SanityImageSource, fallback = "/og.png"): string {
  return (
    imageUrl(source, {width: 1200, height: 630, fit: "crop", format: "jpg", quality: 80}) || fallback
  );
}
