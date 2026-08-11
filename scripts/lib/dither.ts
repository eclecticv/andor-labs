/**
 * The house dithered-duotone treatment, baked at import time.
 *
 * This is a Node port of the client-side canvas algorithm in
 * `src/components/ds/Photo.astro` — Bayer 4x4 ordered dither to a two-colour
 * duotone. The THRESHOLDING must stay in sync with that file: the luminance
 * weights, the Bayer matrix and the `lum > t` comparison are copied from it
 * deliberately and must not drift.
 *
 * The PREPARATION deliberately does not. Before fitting, this file trims a
 * uniform border and applies auto-levels; Photo.astro does neither, because the
 * canvas API has no cheap equivalent. Both still centre-crop and threshold
 * identically, so a photo looks like itself in either path — the baked one is
 * just better framed. Do not "fix" that divergence by adding a crop strategy
 * here: measured on real sources, saliency cropping picks out signage and
 * lettering, which is exactly what a texture-first hero should avoid.
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
  /**
   * Strip a uniform border before fitting.
   *
   * THIS is the fix for the flat-hero problem, and it was not the one I first
   * assumed. `the-copilot-tax` sourced a 1920x1080 photo — already 16:9, so
   * cover-fit cropped nothing and no crop STRATEGY could have helped. The real
   * shape of it: 88% of the source sat in the darkest luminance octile with a
   * dominant colour of rgb(8,8,8), because the arcade cabinet was a lit object
   * on a near-black studio backdrop occupying 468x991 of the frame. Dithering
   * mapped all that backdrop to one colour.
   *
   * Trimming the backdrop first took it from 96.5% one colour / 81.5% flat
   * cells to 86.1% / 17.8%, and from an unreadable rectangle to a legible
   * photograph.
   */
  trim?: boolean;
  /**
   * How to choose the crop window when the source aspect differs from the
   * output.
   *   "centre"    — default. Matches Photo.astro, and measured better here.
   *   "attention" — libvips saliency. Sounds right, usually isn't: it seeks
   *                 high-contrast detail, which on this material means signage
   *                 and lettering. On the arcade cabinet it framed the marquee,
   *                 putting readable text in a hero that is meant to be texture.
   *   "entropy"   — busiest window; same failure mode, less predictable.
   */
  crop?: "attention" | "entropy" | "centre";
  /**
   * Stretch the source's luminance range to full black-to-white before
   * thresholding.
   *
   * The contrast step below pivots around a fixed 0.5, not the image's own
   * mean, so a source that is dark overall gets pushed darker rather than
   * centred — which is how two of the live heroes ended up as uniformly dark
   * texture rather than a picture. Auto-levels first makes the fixed pivot a
   * reasonable assumption instead of a gamble.
   */
  autoLevels?: boolean;
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
    trim: true,
    crop: "centre",
    autoLevels: true,
  },
  /** Index-list thumbnail. 4:3, 1px cells so it stays legible when small. */
  THUMB: {
    width: 400,
    height: 300,
    pixel: 1,
    shadow: "#0A2EBF",
    highlight: "#EEF1FF",
    contrast: 1.06,
    trim: true,
    crop: "centre",
    autoLevels: true,
  },
} as const satisfies Record<string, DitherPreset>;

/**
 * Reject thresholds for a finished hero, calibrated against real output rather
 * than guessed.
 *
 * Every number here was set by dithering the live queries and LOOKING at the
 * results. Two intuitive gates were tried and thrown away:
 *
 *   entropy >= 0.85   would have rejected the FIXED copilot-tax (0.581), which
 *                     is a perfectly legible photograph.
 *   flatCell <= 0.35  would have rejected you-dont-need-a-b-testing (45.3%),
 *                     also fine — its flat areas are background separation, not
 *                     a void.
 *
 * The only image that is genuinely unreadable measured 0.218 / 81.5% / 96.5%,
 * and it fails all three of these. Everything legible passes all three. Keep it
 * that way: if a future tweak makes these reject something, look at the image
 * before moving the number.
 */
export const QUALITY_GATE = {
  /** Below this the image is close to a single flat colour. */
  minEntropy: 0.45,
  /** Above this a majority of the frame is dead area. */
  maxFlatCellPct: 0.65,
  /** Above this almost nothing survived thresholding. */
  maxShadowPct: 0.93,
} as const;

/** True when a finished duotone is good enough to publish. */
export function passesQualityGate(stats: DuotoneStats): boolean {
  return (
    stats.entropy >= QUALITY_GATE.minEntropy &&
    stats.flatCellPct <= QUALITY_GATE.maxFlatCellPct &&
    stats.shadowPct <= QUALITY_GATE.maxShadowPct
  );
}

/** Why a duotone failed, for the operator log. Empty when it passed. */
export function qualityGateFailures(stats: DuotoneStats): string[] {
  const out: string[] = [];
  if (stats.entropy < QUALITY_GATE.minEntropy)
    out.push(`entropy ${stats.entropy.toFixed(3)} < ${QUALITY_GATE.minEntropy}`);
  if (stats.flatCellPct > QUALITY_GATE.maxFlatCellPct)
    out.push(`flat cells ${(stats.flatCellPct * 100).toFixed(1)}% > ${QUALITY_GATE.maxFlatCellPct * 100}%`);
  if (stats.shadowPct > QUALITY_GATE.maxShadowPct)
    out.push(`shadow ${(stats.shadowPct * 100).toFixed(1)}% > ${QUALITY_GATE.maxShadowPct * 100}%`);
  return out;
}

/** What a finished duotone looks like, numerically. */
export interface DuotoneStats {
  /** Share of pixels that resolved to the shadow colour, 0-1. */
  shadowPct: number;
  /**
   * Share of 10x10 dither cells that are entirely one colour, 0-1. This is the
   * "reads as a flat void" metric — it catches a blank region that a global
   * light/dark ratio would average away.
   */
  flatCellPct: number;
  /**
   * sharp/libvips greyscale Shannon entropy of the finished PNG, 0-1.
   *
   * The most reliable single signal, though not by the margin first assumed:
   * the unreadable image scored 0.218 while legible ones run 0.58-1.00. The
   * gap is real but the floor sits near 0.5, not 0.9 — see QUALITY_GATE.
   */
  entropy: number;
}

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
  return (await ditherToDuotoneWithStats(input, opts)).png;
}

/**
 * As `ditherToDuotone`, but also returns the quality measurements.
 *
 * The shadow and flat-cell counts are computed inside the thresholding loop,
 * where they are free. Entropy needs the encoded PNG, so it costs one extra
 * decode — worth it, because it is the metric that actually separates a good
 * hero from a blue rectangle.
 */
export async function ditherToDuotoneWithStats(
  input: Buffer,
  opts: DitherOptions = {},
): Promise<{ png: Buffer; stats: DuotoneStats }> {
  const {
    width = ditherPreset.HERO.width,
    height = ditherPreset.HERO.height,
    pixel = ditherPreset.HERO.pixel,
    shadow = ditherPreset.HERO.shadow,
    highlight = ditherPreset.HERO.highlight,
    contrast = ditherPreset.HERO.contrast,
    trim = ditherPreset.HERO.trim,
    crop = ditherPreset.HERO.crop,
    autoLevels = ditherPreset.HERO.autoLevels,
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

  // Cover-fit, then choose WHERE to trim the overflow. `attention` scores the
  // discarded edge bands by luminance frequency and saturation and keeps the
  // busiest window, so a tall subject in a wide frame survives instead of
  // becoming a sliver between two flat margins.
  const position =
    crop === "attention"
      ? sharp.strategy.attention
      : crop === "entropy"
        ? sharp.strategy.entropy
        : "centre";

  let source = input;
  if (trim) {
    // Separate pass: trim() needs to run and be measured before the resize, and
    // it can legitimately fail (a photo with no uniform border, or one that is
    // ENTIRELY uniform, which throws). Falling back to the untrimmed source is
    // correct — the quality gate downstream is what catches a bad result.
    try {
      const t = await sharp(input, { failOn: "none" }).rotate().trim({ threshold: 12 }).toBuffer();
      if (t.length > 0) source = t;
    } catch {
      /* no trimmable border, or the whole frame is one colour; keep the original */
    }
  }

  let pipeline = sharp(source, { failOn: "none" }).rotate(); // EXIF before measuring
  // Before the resize, so levels are computed from the whole photograph rather
  // than from whichever corner the crop happened to keep.
  if (autoLevels) pipeline = pipeline.normalise();

  const { data, info } = await pipeline
    .resize(cw, ch, { fit: "cover", position })
    .raw()
    .ensureAlpha()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const channels = info.channels; // 4 after ensureAlpha

  // isShadow, one bit per grid cell, kept so flat-region detection below does
  // not have to re-read the RGB buffer.
  const shadowMask = new Uint8Array(w * h);
  let shadowCount = 0;

  for (let y = 0; y < h; y++) {
    const row = BAYER[y & 3];
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * channels;
      let lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
      lum = Math.min(1, Math.max(0, (lum - 0.5) * c + 0.5));
      const t = (row[x & 3] + 0.5) / 16;
      const isHighlight = lum > t;
      const col = isHighlight ? hRGB : sRGB;
      data[i] = col[0];
      data[i + 1] = col[1];
      data[i + 2] = col[2];
      data[i + 3] = 255;
      if (!isHighlight) {
        shadowMask[y * w + x] = 1;
        shadowCount++;
      }
    }
  }

  const png = await sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .resize(width, height, { kernel: "nearest" })
    .png({ palette: true, colours: 2, effort: 10 })
    .toBuffer();

  return {
    png,
    stats: {
      shadowPct: shadowCount / (w * h),
      flatCellPct: flatCellFraction(shadowMask, w, h),
      // libvips computes this on the greyscale histogram; a two-colour image
      // that is nearly all one colour scores near zero.
      entropy: (await sharp(png).stats()).entropy,
    },
  };
}

/**
 * Fraction of 10x10 cells that contain only one colour.
 *
 * A global light/dark ratio hides a blank REGION — an image can be a healthy
 * 50/50 overall and still have a dead quarter. This is the metric that matches
 * "half of it is a flat field" as a reader would perceive it.
 */
function flatCellFraction(mask: Uint8Array, w: number, h: number, cell = 10): number {
  const cols = Math.floor(w / cell);
  const rows = Math.floor(h / cell);
  if (cols === 0 || rows === 0) return 0;

  let flat = 0;
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const first = mask[cy * cell * w + cx * cell];
      let uniform = true;
      for (let y = 0; y < cell && uniform; y++) {
        const base = (cy * cell + y) * w + cx * cell;
        for (let x = 0; x < cell; x++) {
          if (mask[base + x] !== first) {
            uniform = false;
            break;
          }
        }
      }
      if (uniform) flat++;
    }
  }
  return flat / (cols * rows);
}
