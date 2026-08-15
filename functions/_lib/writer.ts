/**
 * The writer.
 *
 * A fourth model, from a fourth lab, reads all nine answers and writes the
 * paragraph that sits at the top of a company's page. It scores nothing. It is
 * disqualified from voting precisely because it has seen everyone else's
 * answers, which is the one thing the three panelists were kept from doing.
 *
 * ── Why a separate model at all ──
 * The obvious cheaper design is to let the highest-scoring panelist write the
 * summary. That fails in a specific way: a juror summarising a panel it sat on
 * writes an argument for its own number, and where the panel split, the split
 * quietly disappears. A model with no score to defend can say "two of them
 * liked it and one really didn't" without it being a concession.
 *
 * ── On the humour ──
 * The brief is clean, absurdist, tongue-in-cheek, and never punching down. That
 * last clause is the load-bearing one and it is not a politeness setting: this
 * board is mostly small companies, and a model handed "be funny about a startup"
 * reaches for the cruelty of scale — small team, no customers, obscure. Those
 * jokes are punching down by definition, and they are also boring, because the
 * target had no choice in any of it. So the prompt names the legitimate targets
 * (the category's conventions, the claims, the language, the sheer number of
 * companies doing this) and names the illegitimate ones explicitly rather than
 * hoping "clean" covers it.
 */

import { QUESTIONS, type PanelResult, type PanelistTake } from "./panel";
import { PANELISTS } from "./panel";

export interface WriterInput {
  name: string;
  oneLiner: string;
  categoryLabel: string;
  cohort: string;
  panel: PanelResult;
}

/**
 * Name the model that ACTUALLY answered, not the one we hoped for.
 *
 * The writer refers to panelists by name in its paragraph, and the first run of
 * this produced "Gemini 3.6 Flash was more watchful" on a ranking where 3.6 had
 * returned 503 twice and gemini-3.5-flash-lite was seated instead. The page
 * discloses that fallback in its own line, which made the prose directly above
 * it wrong — the one kind of error this tool cannot afford, since its entire
 * claim is that you can see who judged you.
 */
function panelistName(take: PanelistTake): string {
  const declared = PANELISTS.find((p) => p.id === take.panelistId);
  if (!declared) return take.panelistId;
  // The ladder seats a model id ("gemini-3.5-flash-lite"), the panel declares a
  // display name ("Gemini 3.6 Flash"). They will never match as strings, so the
  // comparison is against the declared MODEL, which is what the ladder preferred.
  return take.modelUsed === declared.model ? declared.name : `${declared.lab} ${take.modelUsed}`;
}

const renderTake = (take: PanelistTake) =>
  QUESTIONS.map(
    (q) =>
      `  ${q.label} — ${take.ratings[q.key].score}/10 ("${take.ratings[q.key].adjective}")\n` +
      `    ${take.ratings[q.key].summary}`,
  ).join("\n");

export function buildWriterPrompt(input: WriterInput): string {
  const transcript = input.panel.takes
    .map((t) => `── ${panelistName(t)} — overall word: "${t.adjective}"\n${renderTake(t)}`)
    .join("\n\n");

  const splitNote = input.panel.split
    ? `\nTHE PANEL SPLIT on ${QUESTIONS.find((q) => q.key === input.panel.split!.question)!.label} — ` +
      `${input.panel.split.spread} points between the highest and lowest score. That disagreement is the most\n` +
      `interesting thing here and your paragraph should be built around it.`
    : `\nThe panel broadly agreed. Say what they agreed ON — a unanimous panel is a\nstronger claim than a split one, not a duller one.`;

  return `Three models from three different labs judged an adtech company. You are a
fourth, from a fourth lab. You did not vote and you are not going to. Your only
job is to read what they said and write the paragraph that goes at the top of
this company's page.

COMPANY: ${input.name}
WHAT IT DOES: ${input.oneLiner || "unclear from the site"}
CATEGORY: ${input.categoryLabel}
COHORT: ${input.cohort}

THE PANEL SAID:

${transcript}
${splitNote}

═══ WRITE THE PARAGRAPH ═══

70-110 words. One paragraph. No headings, no lists, no preamble.

DO:
  - Lead with the actual finding, not with throat-clearing.
  - Quote or characterise where the panelists differed or agreed. They are named
    characters here; using their names is good.
  - Be funny. Clean, absurdist, tongue-in-cheek — the register of someone who
    likes this industry enough to be rude about its conventions. A well-placed
    piece of nonsense beats a well-placed insult.
  - Leave every door open. This company might read it.

DO NOT:
  - Restate the scores. The numbers are on the page already, directly above you.
  - Punch down. The legitimate targets are the CATEGORY'S CONVENTIONS, the
    CLAIMS being made, the LANGUAGE used, and how many companies are doing this
    same thing. The illegitimate ones are the company being small, being
    unknown, having few customers, having a small team, or being early. None of
    those are funny and none of them were choices.
  - Aim at people. No founders, no employees, no investors, by name or by role.
  - Suggest the company is failing, fraudulent, out of money, or about to die.
  - Use "In a world where", "Look,", "Here's the thing", or an em dash.
  - End on an inspirational note. Just stop.

Return JSON only: {"summary": str}`;
}

const text = (v: unknown, max: number): string => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
};

export function normalizeSummary(raw: unknown): string {
  const o = (raw ?? {}) as Record<string, unknown>;
  return text(o.summary, 900);
}

/**
 * A summary shorter than this is the failure mode we have already shipped once:
 * a model returned "..." and it won the ladder, because the loop broke on
 * truthiness and three dots are truthy. The floor is the fix.
 */
export function assertSummaryUsable(summary: string): string {
  if (summary.length < 120) throw new Error("summary too short");
  return summary;
}
