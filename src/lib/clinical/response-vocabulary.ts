// The response vocabulary — dimensions, windows, evidence classes, and the two
// pure judgements built on them (expansion handoff 02 §5, §6).
//
// Split from the store so a client component can render a response without
// pulling better-sqlite3 into the browser bundle, the same split as
// intervention-vocabulary.
//
// `isMixed` and `missingWindowsFor` live HERE rather than beside the adapters,
// and that placement is the point: they are the two things §6 asks a surface to
// keep visible, they are pure functions of evidence, and putting them in the
// module every renderer imports means no screen can display a response without
// having the means to say "mixed" and "not followed up" in front of it.

import type { InstanceSourceType } from "./intervention-vocabulary";
import type { InterventionInstance } from "./interventions";

// ---------------------------------------------------------------------------
// Vocabulary (§5)
// ---------------------------------------------------------------------------

/** §5's response dimensions, unchanged. Each has its own interpretation rule,
 *  which is why they are separate types rather than one "outcome". */
export const OUTCOME_TYPES = [
  "within_encounter",
  "recovery_burden",
  "sleep_after",
  "function_after",
  "patient_helpfulness",
  "engagement_reuse",
  "adverse_or_hard_stop",
] as const;
export type OutcomeType = (typeof OUTCOME_TYPES)[number];

/** §4's window vocabulary. The column that keeps §6's mixed-response rule
 *  honest — see the header. */
export const WINDOW_TYPES = [
  "immediate", "post_session", "same_day", "next_day", "multi_day", "functional",
] as const;
export type WindowType = (typeof WINDOW_TYPES)[number];

/** Cross-feature invariant: "patient report, clinician observation, system
 *  measurement, formal note, Companion interaction, and model inference remain
 *  distinguishable." */
export const RESPONSE_EVIDENCE_CLASSES = [
  "measured",
  "patient_report",
  "clinician_observation",
  "system_event",
  "companion_interaction",
  "model_candidate",
] as const;
export type ResponseEvidenceClass = (typeof RESPONSE_EVIDENCE_CLASSES)[number];

export type Direction = "decrease" | "increase" | "unchanged";

/**
 * Which way the number moves when a person is more settled on that dimension.
 *
 * SEPARATE FROM THE OBSERVATION ON PURPOSE. The row says distress went from 7
 * to 3; this table says falling distress is relief. Keeping them apart means a
 * reader can always recover the raw fact, and means the interpretation is one
 * greppable table rather than a sign convention scattered across adapters.
 *
 * It is not a claim that the intervention caused the movement. Nothing here
 * knows what caused anything.
 */
export const SETTLING_DIRECTION: Record<OutcomeType, Direction> = {
  within_encounter: "decrease",
  recovery_burden: "decrease",
  // Sleep QUALITY, so higher is more settled — the one dimension whose sign is
  // the other way round, and the reason this table exists at all.
  sleep_after: "increase",
  // A goal level rising is a person doing more of their life.
  function_after: "increase",
  patient_helpfulness: "increase",
  engagement_reuse: "increase",
  // An adverse observation is recorded when it is PRESENT; more of it is worse.
  adverse_or_hard_stop: "decrease",
};

export const OUTCOME_LABEL: Record<OutcomeType, string> = {
  within_encounter: "During it",
  recovery_burden: "Afterwards",
  sleep_after: "Sleep",
  function_after: "In their life",
  patient_helpfulness: "What they said about it",
  engagement_reuse: "Whether they came back to it",
  adverse_or_hard_stop: "Difficulty",
};

export const WINDOW_LABEL: Record<WindowType, string> = {
  immediate: "during the encounter",
  post_session: "in the hours after",
  same_day: "the same day",
  next_day: "the next day",
  multi_day: "over the following days",
  functional: "in their life",
};

export const EVIDENCE_LABEL: Record<ResponseEvidenceClass, string> = {
  measured: "Measured",
  patient_report: "They said so",
  clinician_observation: "You observed it",
  system_event: "Recorded by Steady",
  companion_interaction: "From a Companion conversation",
  model_candidate: "Suggested, not confirmed",
};

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

export interface ResponseObservation {
  id: string;
  personId: string;
  instanceId: string;
  outcomeType: OutcomeType;
  windowType: WindowType;
  valueNum: number | null;
  valueText: string | null;
  unit: string | null;
  direction: Direction | null;
  evidenceClass: ResponseEvidenceClass;
  sourceType: string;
  sourceId: string;
  occurredAt: string;
  createdAt: string;
}

/** The stored row shape. Exported so the store maps rows through the one
 *  hydrator every reader shares. */
export interface ObsRow {
  id: string; person_id: string; intervention_instance_id: string;
  outcome_type: string; window_type: string; value_num: number | null;
  value_text: string | null; unit: string | null; direction: string | null;
  evidence_class: string; source_type: string; source_id: string;
  occurred_at: string; created_at: string;
}

export function toObservation(r: ObsRow): ResponseObservation {
  return {
    id: r.id,
    personId: r.person_id,
    instanceId: r.intervention_instance_id,
    outcomeType: r.outcome_type as OutcomeType,
    windowType: r.window_type as WindowType,
    valueNum: r.value_num,
    valueText: r.value_text,
    unit: r.unit,
    direction: (r.direction as Direction | null) ?? null,
    evidenceClass: r.evidence_class as ResponseEvidenceClass,
    sourceType: r.source_type,
    sourceId: r.source_id,
    occurredAt: r.occurred_at,
    createdAt: r.created_at,
  };
}

export class ResponseObservationError extends Error {}

/** What the number did between two readings. A fact about the number. */
export function directionOf(from: number, to: number): Direction {
  return to < from ? "decrease" : to > from ? "increase" : "unchanged";
}

/** True when a movement on this dimension is toward the person being more
 *  settled. Reads SETTLING_DIRECTION so no adapter or component has to carry a
 *  sign convention of its own. */
export function isSettling(outcomeType: OutcomeType, direction: Direction | null): boolean | null {
  if (direction === null || direction === "unchanged") return null;
  return direction === SETTLING_DIRECTION[outcomeType];
}

/**
 * The windows a source type is EXPECTED to produce.
 *
 * This table is what turns "no row" into a finding. Without it, a session with
 * no post-session check and a session that recovered cleanly are the same
 * absence, and §6's "do not classify missing delayed follow-up as recovered"
 * becomes a rule with nothing behind it.
 *
 * A clinician entry expects nothing: the clinician records what they chose to
 * record, and calling their note incomplete because Steady wanted another
 * window would be Steady auditing a person's clinical judgement.
 */
export const EXPECTED_WINDOWS: Partial<Record<InstanceSourceType, WindowType[]>> = {
  therapy_session: ["immediate", "post_session", "next_day"],
  // §10: "practice instances; delayed response needs other evidence before any
  // benefit pattern." The next day is where that other evidence would be.
  practice_completion: ["next_day"],
};

/** Which expected windows this exposure has no observation in. */
export function missingWindowsFor(
  instance: InterventionInstance, observations: ResponseObservation[]
): WindowType[] {
  const expected = EXPECTED_WINDOWS[instance.sourceType] ?? [];
  const present = new Set(
    observations.filter((o) => o.instanceId === instance.id).map((o) => o.windowType)
  );
  return expected.filter((w) => !present.has(w));
}

/**
 * Does this exposure show movement in opposite directions across windows?
 *
 * §6's exact case: an immediate decrease plus next-day worsening. The answer is
 * MIXED and it is never netted — this returns a boolean about the shape of the
 * evidence, and there is deliberately no function anywhere that turns the two
 * numbers into one.
 *
 * Compared through `isSettling` rather than raw direction, because "decrease"
 * means relief on distress and the opposite on sleep quality, and a comparison
 * on the raw sign would call a settled night after a settled session mixed.
 */
export function isMixed(observations: ResponseObservation[]): boolean {
  const settling = observations
    .map((o) => isSettling(o.outcomeType, o.direction))
    .filter((v): v is boolean => v !== null);
  return settling.includes(true) && settling.includes(false);
}

// ---------------------------------------------------------------------------
// Rendering one observation (§9)
// ---------------------------------------------------------------------------

/**
 * One observation as a short phrase a clinician can read in a list.
 *
 * IT DESCRIBES; IT DOES NOT CONCLUDE. "Distress 7 to 3 during it" is what was
 * measured. "Grounding worked" is a claim about cause, and §6 bars it without
 * an independent clinician-authored judgement — so nothing this function can
 * return contains a verb about the intervention at all. The subject of every
 * sentence it builds is the person's reading, never the thing that was done.
 *
 * The raw readings lead. A delta alone ("−4") hides whether someone went from
 * 9 to 5 or from 5 to 1, and those are different clinical situations wearing
 * the same number.
 */
export function describeObservation(o: ResponseObservation): string {
  const where = WINDOW_LABEL[o.windowType];
  if (o.outcomeType === "adverse_or_hard_stop") {
    return `${o.valueText ?? "difficulty"} — ${where}`;
  }
  if (o.unit === "recovery_confirmed") {
    return `${o.valueText ?? "recovery not recorded"} — ${where}`;
  }
  if (o.outcomeType === "function_after") {
    return `a life-goal step was observed ${where}`;
  }
  const reading = o.valueText ?? (o.valueNum === null ? "recorded" : String(o.valueNum));
  const dimension =
    o.unit === "suds_points" ? "distress"
    : o.unit === "activation" ? "activation"
    : o.unit === "sleep_quality" ? "sleep quality"
    : o.unit === "distress" ? "distress"
    : o.unit === "delayed_risk" ? "expected a hard night, scored"
    : OUTCOME_LABEL[o.outcomeType].toLowerCase();
  return `${dimension} ${reading} — ${where}`;
}

/** How a missing window is named on screen. Each says what was not recorded,
 *  never what the absence means (§6: missing delayed follow-up is reported, and
 *  is not recovery). */
export const MISSING_WINDOW_LABEL: Record<WindowType, string> = {
  immediate: "no close reading",
  post_session: "no post-session check",
  same_day: "nothing recorded that day",
  next_day: "no check-in the next day",
  multi_day: "nothing recorded over the following days",
  functional: "no life-goal observation in the window",
};

/** The order the windows are read in: what happened during it, then the hours
 *  after, then the days, then their life. Chronological rather than
 *  most-recent-first, because a response is a sequence and reading it backwards
 *  makes an immediate drop look like a next-day recovery. */
export const WINDOW_ORDER: Record<WindowType, number> = {
  immediate: 0, post_session: 1, same_day: 2, next_day: 3, multi_day: 4, functional: 5,
};

/** Observations for one exposure, in reading order. */
export function inWindowOrder(observations: ResponseObservation[]): ResponseObservation[] {
  return [...observations].sort(
    (a, b) =>
      WINDOW_ORDER[a.windowType] - WINDOW_ORDER[b.windowType] ||
      a.occurredAt.localeCompare(b.occurredAt)
  );
}
