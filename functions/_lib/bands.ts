/**
 * What the panel's total is called.
 *
 * Four bands, out of thirty. This exists as its own module because the same
 * four thresholds were previously written out in four places — `scoreBand` in
 * src/lib/rankings.ts, the OG card's `BAND`, the leaderboard's legend, and the
 * share line's own parallel ladder in [slug].astro — and three of them carried
 * different words for the same score.
 *
 * Every band is a POSITION, not a state of mind. "The panel is thinking" was
 * the 12-18 label and it described the panel rather than the company: a reader
 * seeing 14.7/30 learns nothing from being told the jury is still deliberating,
 * because the jury is not, it has finished and this is the answer. A band has
 * to be a verdict someone could disagree with.
 */
export interface ScoreBand {
  /** Inclusive lower bound of the band, out of 30. */
  min: number;
  /** The verdict, as it prints on the page and on the share card. */
  label: string;
  /** Pixel icon name — see PixelIcon. */
  icon: string;
  /** True only for the top band: the one place the accent is spent. */
  solid: boolean;
  /** The line above the share buttons, at peak reaction. */
  brag: string;
}

export const BANDS: ScoreBand[] = [
  {
    min: 24,
    label: "Rare air",
    icon: "fire-solid",
    solid: true,
    brag: "Three labs, no reservations. Go and gloat.",
  },
  {
    min: 19,
    label: "Worth a meeting",
    icon: "star",
    solid: false,
    brag: "Good number. Post it before we change our mind.",
  },
  {
    min: 12,
    label: "Not convinced",
    icon: "face-thinking",
    solid: false,
    brag: "The panel wanted more. Post it anyway.",
  },
  {
    min: 0,
    label: "Brutal",
    icon: "hockey-mask",
    solid: false,
    brag: "Brutal. Posting it anyway is the power move.",
  },
];

/** The band a total falls in. Never null — the last band has no lower bound. */
export const bandFor = (total: number): ScoreBand =>
  BANDS.find((b) => total >= b.min) ?? BANDS[BANDS.length - 1];

/**
 * The legend, built from the scale rather than typed beside it.
 *
 * "On fire 24+ · Interesting 19+ · Thinking 12+ · Brutal <12" was hand-written
 * on the leaderboard and had already drifted from the labels it was explaining.
 */
export const bandLegend = (): string =>
  BANDS.map((b, i) =>
    i === BANDS.length - 1
      ? `${b.label} <${BANDS[i - 1].min}`
      : `${b.label} ${b.min}+`,
  ).join(" · ");
