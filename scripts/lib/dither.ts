/**
 * The house dithered-duotone treatment, baked at import time.
 *
 * This is a Node port of the client-side canvas algorithm in
 * `src/components/ds/Photo.astro` — Bayer 4x4 ordered dither to a two-colour
 * duotone. Keep the two in sync: the numbers below (luminance weights, the
 * contrast pivot, the Bayer matrix, the `lum > t` comparison) are copied from
 * that file deliberately and must not drift.
 *
 * Why bake it: the post hero is the LCP element. Dithering in the browser
 * leaves it blank until JS runs and needs CORS headers on cdn.sanity.io for
 * `getImageData()`. A baked PNG is a plain `<img>`.
 *
 * `sharp` is a devDependency and is only ever imported by scripts/ — nothing
 * here is bundled for the browser.
 */
import sharp from "sharp";

/** Ordered-dither threshold matrix — identical to Photo.astro. */
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

export interface DitherOptions {
  /** Final output width in px. */
  width?: number;
  /** Final output height in px. */
  height?: number;
  /** Size of one dither cell in output px. Higher = chunkier. */
  pixel?: number;
  /** Colour for pixels below the threshold. */
  shadow?: string;
  /** Colour for pixels above the threshold. */
  highlight?: string;
  /** Contrast applied around a 0.5 pivot before thresholding. */
  contrast?: number;
}

export type DitherPreset = Required<DitherOptions>;

/** House presets, so callers never retype the brand hexes. */
export const ditherPreset = {
  /** Post hero / OG source. 16:9, chunky 2px cells. */
  HERO: {
    width: 1600,
    height: 900,
    pixel: 2,
    shadow: "#0A2EBF",
    highlight: "#EEF1FF",
    contrast: 1.06,
  },
  /** Index-list thumbnail. 4:3, 1px cells so it stays legible when small. */
  THUMB: {
    width: 400,
    height: 300,
    pixel: 1,
    shadow: "#0A2EBF",
    highlight: "#EEF1FF",
    contrast: 1.06,
  },
} as const satisfies Record<string, DitherPreset>;

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(m)) {
    throw new Error(`ditherToDuotone: expected a #rrggbb colour, got "${hex}"`);
  }
  return [
    parseInt(m.slice(0, 2), 16),
    parseInt(m.slice(2, 4), 16),
    parseInt(m.slice(4, 6), 16),
  ];
}

/**
 * Bayer-dither `input` (any format sharp can decode) to the two-colour house
 * duotone and return PNG bytes.
 *
 * Pipeline:
 *   1. cover-fit the source into a `width/pixel` x `height/pixel` grid, centred
 *   2. per pixel: luminance -> contrast around 0.5 -> Bayer threshold -> 2 colours
 *   3. nearest-neighbour upscale back to `width` x `height` (a smooth resize
 *      would blur the cells and destroy the chunky look)
 *   4. encode as a 2-colour palette PNG — a few KB, which matters for LCP
 */
export async function ditherToDuotone(
  input: Buffer,
  opts: DitherOptions = {},
): Promise<Buffer> {
  const {
    width = ditherPreset.HERO.width,
    height = ditherPreset.HERO.height,
    pixel = ditherPreset.HERO.pixel,
    shadow = ditherPreset.HERO.shadow,
    highlight = ditherPreset.HERO.highlight,
    contrast = ditherPreset.HERO.contrast,
  } = opts;

  if (!(width > 0) || !(height > 0)) {
    throw new Error(`ditherToDuotone: width/height must be positive`);
  }
  if (!(pixel > 0)) {
    throw new Error(`ditherToDuotone: pixel must be positive, got ${pixel}`);
  }

  const sRGB = hexToRgb(shadow);
  const hRGB = hexToRgb(highlight);
  const c = Math.max(0, contrast);

  // The small grid we actually dither. Mirrors Photo.astro's canvas size.
  const cw = Math.max(1, Math.round(width / pixel));
  const ch = Math.max(1, Math.round(height / pixel));

  // Cover-fit + centre-crop, i.e. scale = max(cw/naturalW, ch/naturalH) with the
  // overflow trimmed evenly — exactly what the canvas drawImage() call does.
  const { data, info } = await sharp(input, { failOn: "none" })
    .rotate() // honour EXIF orientation before we measure anything
    .resize(cw, ch, { fit: "cover", position: "centre" })
    .raw()
    .ensureAlpha()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const channels = info.channels; // 4 after ensureAlpha

  for (let y = 0; y < h; y++) {
    const row = BAYER[y & 3];
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * channels;
      let lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
      lum = Math.min(1, Math.max(0, (lum - 0.5) * c + 0.5));
      const t = (row[x & 3] + 0.5) / 16;
      const col = lum > t ? hRGB : sRGB;
      data[i] = col[0];
      data[i + 1] = col[1];
      data[i + 2] = col[2];
      data[i + 3] = 255;
    }
  }

  return sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .resize(width, height, { kernel: "nearest" })
    .png({ palette: true, colours: 2, effort: 10 })
    .toBuffer();
}
