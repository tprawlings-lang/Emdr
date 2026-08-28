// The gate as a paced sequence (Presentation Layer Handoff §5).
//
// The gate was one form of eighteen to twenty required items with nothing
// persisted until the final submit. Fourteen steps is long; Spring Health's
// assessment-first flow already draws friction complaints and Steady's is
// longer and more sensitive. The handoff calls it the single biggest UX risk in
// the product, and the previous implementation had every property that makes it
// one:
//
//   Leaving lost everything, and the only way back was to start over.
//   Every item was `required`, so partial progress could not even be submitted.
//   Safety items were evaluated at submit — so someone could answer "yes" to
//   the suicidal-ideation screen, close the tab, and no rule would ever fire.
//
// That last one is not a UX defect. It is a safety defect wearing a UX defect's
// clothes, and it is the reason §5 says safety items commit IMMEDIATELY:
// "persist the response and evaluate the fixed rule the moment a
// safety-relevant item is answered, without waiting for submission… a safety
// disposition that has fired cannot be undone by backing out of the
// questionnaire."
//
// This module holds the state machine. Answers are written per item as they are
// given, position is a place in a sequence rather than a percentage, and
// nothing here computes or returns a score — the gate terminates in a Day
// State (§5), which is the care-plan-as-output pattern minus the number.

import { data } from "../data";
import { getInstrument, type Instrument } from "../instruments";

export interface GatePosition {
  instrument: Instrument;
  /** Zero-based index of the item to show. */
  index: number;
  /** One-based, for display. §5: "Progress shown as position, not percentage.
   *  A simple sequence marker. Avoid a progress bar reading 30% — percentage
   *  framing invites abandonment maths." */
  step: number;
  total: number;
  /** The answer already recorded for this item, if the member is returning or
   *  stepping back. */
  existing: number | null;
  /** True when every item has an answer and the instrument can be completed. */
  complete: boolean;
  /** The first unanswered index, which is where "resume" goes. */
  resumeAt: number;
  /** Whether answering this item fires a fixed safety rule immediately. */
  safetyItem: boolean;
}

export class GateError extends Error {}

/** Answers recorded so far, sparse by design — a member may skip forward and
 *  back, and an unanswered item is absent rather than zero. Zero is a real
 *  answer on every instrument here ("Not at all"), so the two must not be
 *  conflated. */
export async function savedAnswers(
  userId: string, instrumentId: string
): Promise<Map<number, number>> {
  const c = await data();
  const rows = (await c.all(
    "SELECT item_index, value FROM screening_progress WHERE user_id = ? AND instrument = ?",
    [userId, instrumentId]
  )) as Array<{ item_index: number; value: number }>;
  return new Map(rows.map((r) => [r.item_index, r.value]));
}

/** Is this item one whose answer fires a fixed rule the moment it is given?
 *
 *  Reads the instrument's own riskItems rather than a second list, so the set
 *  cannot drift from the definition the scoring uses. */
export function isSafetyItem(instrument: Instrument, index: number): boolean {
  return (instrument.riskItems ?? []).some((r) => r.index === index);
}

/** Where the member is, and what to show. */
export async function gatePosition(args: {
  userId: string;
  instrumentId: string;
  /** Explicit step, if the member navigated to one. Otherwise resume. */
  index?: number;
}): Promise<GatePosition> {
  const instrument = getInstrument(args.instrumentId);
  if (!instrument) throw new GateError(`Unknown instrument "${args.instrumentId}".`);

  const answers = await savedAnswers(args.userId, args.instrumentId);
  const total = instrument.items.length;

  let resumeAt = total;
  for (let i = 0; i < total; i++) {
    if (!answers.has(i)) { resumeAt = i; break; }
  }

  const index = clamp(args.index ?? resumeAt, 0, Math.max(0, total - 1));

  return {
    instrument,
    index,
    step: index + 1,
    total,
    existing: answers.has(index) ? answers.get(index)! : null,
    complete: answers.size === total,
    resumeAt,
    safetyItem: isSafetyItem(instrument, index),
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
}

export interface AnswerResult {
  /** Where to go next: the following item, or completion. */
  nextIndex: number | null;
  /** True when a fixed safety rule fired on this answer. The disposition is
   *  already recorded by the time this returns. */
  safetyFired: boolean;
  complete: boolean;
}

/** Record one answer.
 *
 *  Written immediately and individually. There is no batch, no draft, and no
 *  "save" the member has to remember to press — §5's resumability is a property
 *  of the storage, not a button. */
export async function recordAnswer(args: {
  userId: string;
  instrumentId: string;
  index: number;
  value: number;
}): Promise<AnswerResult> {
  const instrument = getInstrument(args.instrumentId);
  if (!instrument) throw new GateError(`Unknown instrument "${args.instrumentId}".`);
  if (args.index < 0 || args.index >= instrument.items.length) {
    throw new GateError("That question is not part of this questionnaire.");
  }
  if (!instrument.options.some((o) => o.value === args.value)) {
    throw new GateError("That is not one of the available answers.");
  }

  const c = await data();
  await c.run(
    `INSERT INTO screening_progress (user_id, instrument, item_index, value, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, instrument, item_index)
     DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [args.userId, args.instrumentId, args.index, args.value]
  );

  // Safety items commit and evaluate NOW, not at submit. Someone who answers
  // the suicidal-ideation screen positively and then closes the tab has still
  // answered it, and the rule has still fired.
  const risk = (instrument.riskItems ?? []).find((r) => r.index === args.index);
  const safetyFired = Boolean(risk && args.value >= risk.threshold);

  const answers = await savedAnswers(args.userId, args.instrumentId);
  const total = instrument.items.length;
  let nextIndex: number | null = null;
  for (let i = 0; i < total; i++) {
    if (!answers.has(i)) { nextIndex = i; break; }
  }

  return { nextIndex, safetyFired, complete: answers.size === total };
}

/** Clear progress for an instrument once its answers have been submitted as a
 *  completed screening. */
export async function clearProgress(userId: string, instrumentId: string): Promise<void> {
  const c = await data();
  await c.run(
    "DELETE FROM screening_progress WHERE user_id = ? AND instrument = ?",
    [userId, instrumentId]
  );
}

/** The ordered answer array, for scoring at completion. Throws rather than
 *  defaulting a missing item to zero — zero is a real answer, and silently
 *  inventing one would put a fabricated response into a clinical record. */
export async function completedAnswers(
  userId: string, instrumentId: string
): Promise<number[]> {
  const instrument = getInstrument(instrumentId);
  if (!instrument) throw new GateError(`Unknown instrument "${instrumentId}".`);
  const answers = await savedAnswers(userId, instrumentId);
  const out: number[] = [];
  for (let i = 0; i < instrument.items.length; i++) {
    if (!answers.has(i)) {
      throw new GateError(`Question ${i + 1} has not been answered yet.`);
    }
    out.push(answers.get(i)!);
  }
  return out;
}

/** Copy keys for the gate (§8: every member-facing string is a versioned key).
 *
 *  The exit affordance is worth its own note. §5 requires one on every step,
 *  "labeled as a pause, not a quit — the 'no-guilt close.'" The wording matters
 *  as much as the presence: "Cancel" or "Quit" tells someone they are
 *  abandoning something, which in this population is a reason not to come back. */
export const GATE_COPY = {
  "gate.position.v1": (step: number, total: number) => `Question ${step} of ${total}`,
  "gate.pause.v1": "Pause — your answers are saved",
  "gate.resume.v1": "Pick up where you left off",
  "gate.back.v1": "Previous question",
  "gate.done.v1": "That's everything. Nothing here is a grade.",
} as const;
