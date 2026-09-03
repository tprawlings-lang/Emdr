// House measures — written here, validated nowhere.
//
// WHY THIS IS A SEPARATE FILE FROM `instruments.ts`, AND MUST STAY ONE.
//
// That file's first line reads "Validated, public-domain screening instruments
// per the executive plan". PHQ-9, GAD-7, PCL-5, PC-PTSD-5 and the ITQ are
// published, studied, normed and cited; their scoring rules follow published
// guidance. Everything in THIS file is none of those things. It was written
// for this product, by this project, and no study anywhere says what its
// numbers mean.
//
// Putting the two in one list would make that difference a comment. Keeping
// them in two files, with two types and two accessors, makes it structural:
// `getInstrument()` cannot return a house measure, so no code path that
// believes it is handling a validated instrument can be handed one by mistake.
//
// WHAT A HOUSE MEASURE MAY AND MAY NOT DO.
//
//   MAY   Be answered by a member, stored, shown back to them and to their
//         clinician as their own answers over time, and drawn on a chart
//         beside validated instruments — on its OWN scale, labelled.
//
//   MAY NOT  Carry a cutoff, a band, a severity label or a norm. Contribute to
//         a safety decision, a gate, an unlock, an eligibility check or a
//         routing rule. Be described as a screen, a test, an assessment or a
//         diagnosis. Appear in any list of validated instruments.
//
// The prohibition on a cutoff is the load-bearing one. A number with a
// threshold beside it is a claim about what the number MEANS, and there is
// nothing behind this one to support such a claim. Without a cutoff it is what
// it honestly is: a person's own answer to four plain questions, tracked over
// time, useful for a conversation and for nothing else.
//
// STATUS: not clinically approved. It carries no sign-off in
// docs/autonomous/01-signoff-ledger.md and must not be presented as though it
// does.

export interface HouseMeasure {
  id: string;
  version: string;
  /** Named in plain words. NOT an acronym: an acronym on a rating scale reads
   *  as a citation, and there is nothing to cite. */
  title: string;
  /** Shown wherever the measure or its score appears. Not optional. */
  disclosure: string;
  intro: string;
  options: { value: number; label: string }[];
  items: string[];
  max: number;
  /** Higher is better here, which is itself a reason to label every axis: it
   *  runs the opposite way to every validated instrument beside it, and a
   *  reader who assumes otherwise reads improvement as decline. */
  higherIsBetter: true;
  /** ALWAYS NULL, and typed so it cannot become a number. There is no evidence
   *  behind a threshold on this measure, and a threshold is what turns a
   *  number into a claim about a person. */
  cutoff: null;
  validated: false;
}

/** The disclosure that travels with the measure everywhere it is shown. */
export const HOUSE_DISCLOSURE =
  "Written by Steady, not a validated instrument. There is no research behind these " +
  "numbers, no normal range and no cutoff. It records how someone answered four " +
  "questions about their own week, and nothing more.";

export const EVERYDAY_FUNCTION: HouseMeasure = {
  id: "steady-everyday-function",
  version: "house-1.0.0-unapproved",
  title: "Everyday function (Steady house measure)",
  disclosure: HOUSE_DISCLOSURE,
  intro:
    "In the past week, how well have you been able to do each of these? There is no right " +
    "answer and nothing here is scored against anyone else.",
  options: [
    { value: 0, label: "Not at all" },
    { value: 1, label: "Rarely" },
    { value: 2, label: "Some of the time" },
    { value: 3, label: "Most of the time" },
    { value: 4, label: "As well as I would like" },
  ],
  // FUNCTION, NOT SYMPTOMS — which is the whole point of it existing beside
  // PHQ-9 rather than duplicating it. None of these asks how someone felt;
  // each asks what they were able to do.
  items: [
    "Get your day started",
    "Keep up with work, study, or things at home",
    "Be around other people",
    "Do something that restores you",
  ],
  max: 16,
  higherIsBetter: true,
  cutoff: null,
  validated: false,
};

export const HOUSE_MEASURES: HouseMeasure[] = [EVERYDAY_FUNCTION];

/** Deliberately NOT called `getInstrument`. A house measure is not one, and the
 *  two accessors are separate so that no caller can reach across by accident. */
export function getHouseMeasure(id: string): HouseMeasure | undefined {
  return HOUSE_MEASURES.find((m) => m.id === id);
}

export function isHouseMeasure(id: string): boolean {
  return HOUSE_MEASURES.some((m) => m.id === id);
}

/** Sum of answered items. No band, no label, no interpretation — the caller
 *  gets a number and the disclosure, and that is the whole contract. */
export function scoreHouseMeasure(m: HouseMeasure, answers: number[]): number {
  return answers
    .slice(0, m.items.length)
    .reduce((total, a) => total + Math.max(0, Math.min(m.options.length - 1, a)), 0);
}
