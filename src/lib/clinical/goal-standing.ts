// Where one goal stands, in four facts (17 September handoff, P4).
//
//   "Goals — show patient wording, observable milestone, last observation, and
//   next review. Empty state supports goal creation without implying failure."
//
// The screen had the patient's wording at the top and everything else scattered
// down a long panel: the ladder listed all five rungs with the current one
// highlighted and never named the next one, the last observation was the first
// row of an evidence list a reader had to find and date-read for themselves,
// and the next review was not on the screen at all — `target_review_date` has
// been a column since the goals shipped and nothing has ever rendered it.
//
// SO THIS IS THE FOUR AS ONE BLOCK, and each of them is a different kind of
// fact:
//
//   THE MILESTONE IS THE NEXT RUNG, described in the words that were written
//   when the ladder was set. Not "progress", not a percentage — the observable
//   thing that would count, so a clinician can ask about it and a reader can
//   tell whether it happened.
//
//   THE LAST OBSERVATION IS THE LAST ACCEPTED ONE. A proposal is a question,
//   not evidence; counting a model candidate here would make "last observed"
//   mean "last suggested", which is the distinction the whole evidence-class
//   machinery exists to hold.
//
//   THE NEXT REVIEW IS A DATE OR AN ABSENCE, and an absence is not a lapse. A
//   goal with no review date is a goal nobody has set one on; saying "overdue"
//   about it would invent a commitment that was never made.
//
// Pure, and takes `asOf` rather than reading a clock, so ages move with the
// reading frame and a test can pass a literal.

import {
  LEVEL_LABEL, EVIDENCE_LABEL, GOAL_LEVELS,
  type GoalLevel, type GoalLadderRung, type EvidenceClass,
} from "./return-to-life-vocabulary";

export interface StandingObservation {
  observedLevel: GoalLevel | null;
  evidenceClass: EvidenceClass;
  occurredAt: string;
  status: string;
  note?: string | null;
}

export interface Milestone {
  level: GoalLevel;
  description: string;
  /** The observable thing, said in one line. */
  said: string;
}

export type ReviewState = "unset" | "scheduled" | "today" | "overdue";

export interface ReviewStanding {
  date: string | null;
  /** Negative when the date has passed. Null when there is no date. */
  daysUntil: number | null;
  state: ReviewState;
  said: string;
}

export interface GoalStanding {
  milestone: Milestone | null;
  milestoneSaid: string;
  last: StandingObservation | null;
  lastSaid: string;
  review: ReviewStanding;
}

const DAY = 86400000;

function dayDiff(from: string, to: string): number | null {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / DAY);
}

function days(n: number): string {
  return `${n} ${n === 1 ? "day" : "days"}`;
}

/**
 * The next rung above where the evidence has reached.
 *
 * Null at the top of the ladder, which is a real state and not an error: there
 * is nothing above "well beyond that", and printing a milestone there would
 * invent one.
 */
export function nextMilestone(
  currentLevel: GoalLevel | null, rungs: ReadonlyArray<GoalLadderRung>
): Milestone | null {
  const above = GOAL_LEVELS.filter((l) => currentLevel === null || l > currentLevel);
  for (const level of above) {
    const rung = rungs.find((r) => r.level === level);
    if (!rung) continue;
    return {
      level,
      description: rung.description,
      said: `${LEVEL_LABEL[level]} — ${rung.description}`,
    };
  }
  return null;
}

/**
 * The most recent ACCEPTED observation.
 *
 * Proposals are excluded on purpose: a model candidate is a question waiting on
 * a clinician, and letting one answer "when was this last observed" would
 * report a suggestion as an observation.
 */
export function lastAccepted(
  observations: ReadonlyArray<StandingObservation>
): StandingObservation | null {
  const accepted = observations
    .filter((o) => o.status === "accepted")
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  return accepted[0] ?? null;
}

export function observationLine(o: StandingObservation | null, asOf: string): string {
  if (!o) {
    // NOT "no progress". Nobody has recorded anything against this goal, which
    // is a statement about the record.
    return "Nothing has been recorded against this goal yet.";
  }
  const level = o.observedLevel !== null ? LEVEL_LABEL[o.observedLevel] : "No level recorded";
  const gap = dayDiff(o.occurredAt, asOf);
  const when =
    gap === null ? o.occurredAt.slice(0, 10)
    : gap <= 0 ? "today"
    : gap === 1 ? "yesterday"
    : `${days(gap)} ago`;
  return `${level}, ${when} (${o.occurredAt.slice(0, 10)}) · ${EVIDENCE_LABEL[o.evidenceClass]}`;
}

export function reviewStanding(date: string | null, asOf: string): ReviewStanding {
  if (!date) {
    return {
      date: null, daysUntil: null, state: "unset",
      // An absence, not a lapse. Nobody agreed a date, so nothing is late.
      said: "No review date has been set for this goal.",
    };
  }
  const daysUntil = dayDiff(asOf, date);
  if (daysUntil === null) {
    return { date, daysUntil: null, state: "scheduled", said: `Next review ${date.slice(0, 10)}.` };
  }
  if (daysUntil === 0) {
    return { date, daysUntil, state: "today", said: `Due for review today (${date.slice(0, 10)}).` };
  }
  if (daysUntil < 0) {
    return {
      date, daysUntil, state: "overdue",
      said: `Review was due ${days(-daysUntil)} ago, on ${date.slice(0, 10)}.`,
    };
  }
  return {
    date, daysUntil, state: "scheduled",
    said: `Next review in ${days(daysUntil)}, on ${date.slice(0, 10)}.`,
  };
}

export function goalStanding(
  goal: { currentLevel: GoalLevel | null; targetReviewDate: string | null },
  rungs: ReadonlyArray<GoalLadderRung>,
  observations: ReadonlyArray<StandingObservation>,
  asOf: string
): GoalStanding {
  const milestone = nextMilestone(goal.currentLevel, rungs);
  const last = lastAccepted(observations);
  // A GOAL WITH NO ACCEPTED OBSERVATION IS NOT "next step: where you are now",
  // which is what the rung labels produce read literally and which contradicts
  // itself on the screen. The next thing to do on such a goal is to record the
  // baseline, and saying that is both accurate and an instruction.
  const milestoneSaid =
    !milestone ? "The top of the ladder is recorded, so there is no step above this one."
    : goal.currentLevel === null
      ? `Nothing is recorded yet, so the first step is to record where they are: ${milestone.description}`
      : milestone.said;
  return {
    milestone,
    milestoneSaid,
    last,
    lastSaid: observationLine(last, asOf),
    review: reviewStanding(goal.targetReviewDate, asOf),
  };
}
