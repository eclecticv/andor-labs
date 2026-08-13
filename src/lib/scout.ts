/**
 * Wire shape of the Subreddit Scout brief.
 *
 * Types only. These are erased at build, so they cannot drift from the runtime
 * shape — the authority is `functions/api/subreddit-scout.ts`, which declares
 * the same interfaces. They are duplicated rather than imported because Pages
 * Functions are bundled separately from the Astro build and whether an import
 * across that boundary resolves is not something to find out at deploy time
 * (see the note in `functions/api/subscribe.ts`).
 *
 * If you change a field here, change it there.
 */

export interface Subreddit {
  /** Always "r/"-prefixed; the API forces it. */
  name: string;
  /** Approximate, e.g. "~40k members". Never a precise count — nothing verifies it. */
  size: string;
  fit: string;
  rewards: string;
  rules: string;
  firstPost: string;
}

export interface Play {
  /** kebab-case, becomes the SKILL.md filename. */
  skillName: string;
  title: string;
  description: string;
  goal: string;
  inputs: string[];
  steps: string[];
  guardrails: string[];
  output: string;
  cadence: string;
  measure: string;
}

export interface Report {
  businessSummary: string;
  audience: string;
  category: string;
  subreddits: Subreddit[];
  plays: Play[];
}

/** A rendered SKILL.md, ready to drop into a Blob. */
export interface SkillFile {
  filename: string;
  body: string;
}

export type ScoutResponse =
  | {
      ok: true;
      report: Report;
      url: string;
      /** True when the site blocked our reader and the brief was inferred from the domain. */
      partial: boolean;
      skillFiles: SkillFile[];
    }
  | { ok?: false; error: string };
