// The Return-to-Life vocabulary: levels, domains, and the words for both.
//
// SPLIT FROM THE STORE BECAUSE A CLIENT COMPONENT NEEDS IT. The goal form runs
// in the browser and has to label five rungs and eight domains; the store
// reaches `repository` → `data` → better-sqlite3, which cannot be bundled. The
// build caught it, and the fix is the right shape anyway: the words are shared
// between server and client, the rows are server-only, and nothing here imports
// anything that touches a database.
//
// WHY THE WORDS LIVE IN ONE PLACE AT ALL. §9 asks for "plain language, not
// clinical scoring language", and §14 asks that "patient report and clinician
// observation display differently". Both are properties of the whole product
// rather than of a screen — a clinician's form and a patient's view describing
// the same level differently is the failure, and it is only avoidable if there
// is one source for the wording.

export const GOAL_LEVELS = [-2, -1, 0, 1, 2] as const;
export type GoalLevel = (typeof GOAL_LEVELS)[number];

export type GoalStatus = "draft" | "active" | "paused" | "completed" | "archived";

/** §5's taxonomy. `other` is patient-defined and last, because §5's note is
 *  "never force a goal into an incorrect category" — a closed list with no
 *  escape does exactly that. */
export type GoalDomain =
  | "daily_living" | "sleep" | "work_school" | "relationships"
  | "mobility_travel" | "self_care" | "community_recreation" | "other";

export const GOAL_DOMAINS: GoalDomain[] = [
  "daily_living", "sleep", "work_school", "relationships",
  "mobility_travel", "self_care", "community_recreation", "other",
];

export const DOMAIN_LABEL: Record<GoalDomain, string> = {
  daily_living: "Daily living",
  sleep: "Sleep",
  work_school: "Work or school",
  relationships: "Relationships",
  mobility_travel: "Getting around",
  self_care: "Looking after yourself",
  community_recreation: "Community and recreation",
  other: "Something else",
};

/** §10's four classes. */
export type EvidenceClass =
  | "patient_reported" | "clinician_observed" | "system_measured" | "model_candidate";

/** What each class means, in the words a surface should use. One source, so
 *  the clinician view and the patient view cannot describe the same class
 *  differently — which is how "they told us" quietly becomes "it was
 *  observed". */
export const EVIDENCE_LABEL: Record<EvidenceClass, string> = {
  patient_reported: "They told us",
  clinician_observed: "You saw this",
  system_measured: "Steady measured it",
  model_candidate: "Steady suggests this may be related",
};

export type ObservationStatus = "proposed" | "accepted" | "rejected";

/** §3's ladder copy, in plain language. A patient should never have to learn
 *  what -2 means to understand their own goal, so no label carries a number. */
export const LEVEL_LABEL: Record<GoalLevel, string> = {
  [-2]: "Where you are now",
  [-1]: "A real step",
  [0]: "What you are aiming for",
  [1]: "Beyond that",
  [2]: "Well beyond that",
};

/** §3: "baseline is descriptive, not a judgement." */
export const BASELINE_NOTE =
  "Where you are now is a starting point, not a failure. It is what the ladder is measured from.";

/** §1: "achievement is not cure." */
export const COMPLETION_NOTE =
  "Reaching a goal means this part of life changed. It is not a statement about symptoms, diagnosis, or what caused the change.";

export interface GoalLadderRung {
  level: GoalLevel;
  description: string;
}
