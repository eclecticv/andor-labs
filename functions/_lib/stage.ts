/**
 * The "too big" detector.
 *
 * The board is for pre-seed through Series A companies using AI as a core
 * driver. Series B and up is out.
 *
 * This is NOT stage classification. Deciding whether a company is pre-seed or
 * seed is genuinely hard and genuinely unimportant here — everything from
 * pre-seed to A is in. Deciding whether it is past Series A is much easier,
 * because companies that far along leave marks earlier ones do not, and they
 * leave them on their own website. A one-sided test over those marks is
 * tractable where a stage classifier would not be.
 *
 * Division of labour, matching the rest of the pipeline: HARD signals refuse in
 * code, deterministically, where no amount of confident marketing copy can
 * argue them away. Everything softer is handed to the model as evidence and it
 * makes the call. Code does the arithmetic; the model does the judgement.
 *
 * ── Why the signal list is SHORT ──
 * With Series A inside the line, most of the obvious maturity markers stop
 * discriminating. A funded Series A company has a SOC 2 badge, an applicant
 * tracking system, twenty open roles and a customer logo wall — and so, now,
 * do plenty of seed companies selling to enterprises. Those signals were on
 * this list when the cut was at Series A and had to come off when it moved.
 * What survives is evidence that only exists past a B: the company naming a
 * later round itself, or being public.
 *
 * A false refusal costs more than a false admission. A rejected company cannot
 * get on the board and probably will not write in; a wrongly admitted one is a
 * row you can remove. The thresholds lean accordingly.
 */

import type { DetectedTool } from "./stack";

export interface StageEvidence {
  /** Combined text of every page fetched. */
  text: string;
  /** Raw markup, for signals living in attributes rather than prose. */
  html: string;
  detected: DetectedTool[];
  /** URLs discovered in the sitemap, if we got one. */
  sitemapUrlCount?: number;
}

export interface StageVerdict {
  tooBig: boolean;
  /** Named reasons from the company's own evidence. Shown to the submitter. */
  hard: string[];
  /** Weaker marks. Two or more together also refuse. */
  soft: string[];
  /**
   * The site gave us essentially nothing to judge by. NOT a refusal — the entry
   * proceeds and is marked provisional, because a stealth pre-seed and an
   * unlisted giant look identical from here.
   */
  noEvidence: boolean;
}

/**
 * Rounds a company announces about itself.
 *
 * Companies are loud about funding — it is a recruiting and credibility asset,
 * so it lands on the homepage, the press page and the footer. Their own copy is
 * the highest-precision source available and it costs nothing to read.
 *
 * Series A is deliberately ABSENT: the line is "Series B and up".
 */
const ROUND_PATTERNS: [RegExp, string][] = [
  [/\bseries\s+b\b/i, "announces a Series B"],
  [/\bseries\s+c\b/i, "announces a Series C"],
  [/\bseries\s+[d-h]\b/i, "announces a late-stage round"],
  [/\b(nasdaq|nyse)\s*:/i, "is publicly listed"],
  [/\binvestor\s+relations\b/i, "has an investor-relations section"],
  [/\bour\s+ipo\b|\bwent\s+public\b/i, "has gone public"],
];

/**
 * A raise this size is past a Series A on any reading.
 *
 * Set at $50M rather than something tighter because Series A rounds now
 * routinely reach $30M+, and the whole band between $20M and $40M is genuinely
 * ambiguous. Below the floor the round name is the better evidence anyway.
 */
const BIG_RAISE = /\$\s?(\d{2,4})\s?(m|mm|million)\b/i;
const BIG_RAISE_FLOOR_MILLIONS = 50;

/**
 * Roles advertised on the careers page.
 *
 * Counted from distinct ATS links rather than parsed prose — a Greenhouse or
 * Lever board renders one link per role, so the count is a reasonable floor
 * even when the board itself is client-rendered and unreadable.
 */
export function countOpenRoles(html: string): number {
  const matches = html.match(
    /(boards\.greenhouse\.io|job-boards\.greenhouse\.io|jobs\.lever\.co|jobs\.ashbyhq\.com|apply\.workable\.com)\/[^"'\s>]+/gi,
  );
  if (!matches) return 0;
  // Distinct paths only; the same board is linked from the nav of every page.
  return new Set(matches.map((m) => m.toLowerCase())).size;
}

export function assessStage(ev: StageEvidence): StageVerdict {
  const text = ev.text.toLowerCase();
  const hard: string[] = [];
  const soft: string[] = [];

  for (const [re, why] of ROUND_PATTERNS) {
    if (re.test(ev.text)) hard.push(why);
  }

  const raise = BIG_RAISE.exec(ev.text);
  if (raise && Number.parseInt(raise[1], 10) >= BIG_RAISE_FLOOR_MILLIONS) {
    hard.push(`announces a raise of $${raise[1]}M`);
  }

  // Headcount signals are soft now. A well-funded Series A can be hiring hard;
  // only genuinely large boards say anything.
  const roles = countOpenRoles(ev.html);
  if (roles >= 35) soft.push(`is advertising ${roles} open roles`);
  else if (roles >= 15) soft.push(`is advertising ${roles} open roles`);

  if ((ev.sitemapUrlCount ?? 0) > 600) soft.push(`publishes ${ev.sitemapUrlCount} pages`);

  // Several cities named together is a scale marker; one address is not.
  const offices = text.match(
    /\b(san francisco|new york|london|berlin|singapore|sydney|toronto|austin|paris|amsterdam|tokyo|bangalore)\b/g,
  );
  if (offices && new Set(offices).size >= 4) soft.push("lists offices in four or more cities");

  const noEvidence =
    hard.length === 0 && soft.length === 0 && ev.text.trim().length < 400 && ev.detected.length === 0;

  return { tooBig: hard.length > 0 || soft.length >= 2, hard, soft, noEvidence };
}

/**
 * The refusal, in the tool's voice, naming the evidence.
 *
 * Saying WHY earns its keep twice: it is better than a generic bounce, and it
 * is self-correcting — a company that reads "you announce a Series B" and
 * disagrees knows exactly which sentence on their own site to go and look at.
 */
export function tooBigMessage(v: StageVerdict, name: string): string {
  const reasons = [...v.hard, ...v.soft].slice(0, 3);
  const list =
    reasons.length === 1
      ? reasons[0]
      : `${reasons.slice(0, -1).join(", ")} and ${reasons[reasons.length - 1]}`;
  return `This board runs from pre-seed to Series A, and ${name} ${list}. Congratulations — you have outgrown us.`;
}
