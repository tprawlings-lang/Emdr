// The therapeutic-load policy (expansion handoff 05 §3, §4, §6, §7).
//
// §6 opens with the sentence this whole file exists to keep: "No model decides
// the state." What decides it is here, in numbers a clinician can read and
// argue with, versioned so that a stored recommendation says which rules made
// it.
//
// AND THE NUMBERS ARE CONSERVATIVE BY CONSTRUCTION, which §7 spells out. It
// takes repeated favourable recovery and no deterioration anywhere to reach
// `consider_progression`; it takes one pattern of burden and thin capacity to
// reach `stabilize`. The asymmetry is deliberate: the cost of suggesting a
// clinician look at whether to slow down is a conversation, and the cost of
// suggesting they look at whether to push on when the record does not support
// it is a person who gets hurt.
//
// COUNTS, NOT SCORES. The engine counts how many named dimensions read high and
// how many read supportive, and compares those counts to thresholds. That is
// not a readiness number and must not become one: each count is a count of
// FINDINGS, every finding opens its own evidence, and nothing is weighted,
// normalised, or combined into a figure. §13: "No readiness number is displayed
// without explanation; preferred design is categorical evidence-backed state."
//
// Split from the engine so the words and numbers can be read by a client
// component, a test, and the engine from one place.

export const THERAPEUTIC_LOAD_VERSION = "therapeutic-load.1.0.0";

// ---------------------------------------------------------------------------
// States (§3)
// ---------------------------------------------------------------------------

export const LOAD_STATES = [
  "blocked_by_safety",
  "insufficient_data",
  "stabilize",
  "maintain",
  "consider_progression",
] as const;
export type LoadState = (typeof LOAD_STATES)[number];

/**
 * §3's meanings, as the words a clinician actually reads.
 *
 * NONE OF THESE IS AN INSTRUCTION. §1: "a 'consider progression' recommendation
 * means 'there is enough favourable evidence for a clinician to review whether
 * the next step is appropriate,' not 'progress the patient.'" So the label says
 * what there is enough evidence to REVIEW, which is a different sentence from
 * what to do — and the difference is the whole authority boundary.
 */
export const LOAD_STATE_LABEL: Record<LoadState, string> = {
  blocked_by_safety: "Held by a safety decision",
  insufficient_data: "Not enough recovery evidence",
  stabilize: "Evidence to review whether to reduce load",
  maintain: "Current load appears tolerated",
  consider_progression: "Evidence to review whether the next step fits",
};

export const LOAD_STATE_NOTE: Record<LoadState, string> = {
  blocked_by_safety:
    "The safety engine is holding something here. That decision is made by rules elsewhere and this screen does not compute around it, weaken it, or suggest a way past it.",
  insufficient_data:
    "There is not enough recorded about how this person recovers from the work to say anything. Rely on your own judgement; what is missing is listed below.",
  stabilize:
    "Difficulty after the work has been recorded more than once, and the evidence that they are tolerating it is thin. Worth reviewing whether to reduce additional load. This is decision support, not a plan change — nothing has been altered.",
  maintain:
    "What has been recorded is consistent with the current load being tolerated, and it does not support a stronger suggestion in either direction.",
  consider_progression:
    "Recovery after the work has repeatedly been favourable and nothing in the broader course is deteriorating. That is enough evidence for you to review whether the next step is appropriate. Steady has not unlocked, scheduled, or started anything.",
};

// ---------------------------------------------------------------------------
// Dimensions (§4)
// ---------------------------------------------------------------------------

export const LOAD_DIMENSIONS = [
  "acute_load",
  "recovery_time",
  "sleep_cost",
  "dissociation_cost",
  "functional_cost",
  "intervention_tolerance",
  "trajectory_capacity",
] as const;
export type LoadDimensionKey = (typeof LOAD_DIMENSIONS)[number];

export const CAPACITY_DIMENSIONS = [
  "functional_movement",
  "trajectory_favourable",
  "recovery_consistency",
  "stabilizing_response",
] as const;
export type CapacityDimensionKey = (typeof CAPACITY_DIMENSIONS)[number];

/** What a dimension reads. `not_established` is a first-class value and not a
 *  default: a dimension nobody has the evidence for is not a dimension that
 *  came back clear, and the two must never render alike. */
export type DimensionReading = "high" | "moderate" | "low" | "not_established";
export type CapacityReading = "supportive" | "mixed" | "absent" | "not_established";

export const LOAD_DIMENSION_LABEL: Record<LoadDimensionKey, string> = {
  acute_load: "How hard the sessions themselves have been",
  recovery_time: "How the hours afterwards have gone",
  sleep_cost: "Sleep after the work",
  dissociation_cost: "Dissociation after the work",
  functional_cost: "Whether function is moving under this load",
  intervention_tolerance: "How they have responded to what has been used",
  trajectory_capacity: "Whether the broader course is holding",
};

export const CAPACITY_DIMENSION_LABEL: Record<CapacityDimensionKey, string> = {
  functional_movement: "Movement toward things that matter to them",
  trajectory_favourable: "Domains moving favourably or holding",
  recovery_consistency: "Recovery after sessions being consistent",
  stabilizing_response: "Settling observed after stabilizing work",
};

// ---------------------------------------------------------------------------
// Clinician review (§8)
// ---------------------------------------------------------------------------

export const LOAD_DECISIONS = [
  "acknowledged",
  "agree_stabilize",
  "agree_maintain",
  "review_progression",
  "disagree",
  "defer",
] as const;
export type LoadDecision = (typeof LOAD_DECISIONS)[number];

/** §8's six actions. Each RECORDS a judgement; none changes a plan or a gate,
 *  and the wording says so rather than leaving it to a footnote nobody reads. */
export const LOAD_DECISION_LABEL: Record<LoadDecision, string> = {
  acknowledged: "Read it",
  agree_stabilize: "Agrees — worth reducing load",
  agree_maintain: "Agrees — hold where we are",
  review_progression: "Will review whether the next step fits",
  disagree: "Disagrees with this reading",
  defer: "Not deciding this yet",
};

// ---------------------------------------------------------------------------
// Thresholds (§6, §7)
// ---------------------------------------------------------------------------

export interface TherapeuticLoadPolicy {
  version: string;
  /** How many sessions with a post-session check are needed before any state
   *  other than `insufficient_data` is available. §7: "no 'consider
   *  progression' from one good session" — and equally, no `stabilize` from
   *  one hard one. */
  minRecoveryEvidence: number;
  /** How many recent sessions the dimensions are read over. */
  windowSessions: number;
  /** How many load dimensions must read `high` before repeated burden is
   *  established. Two, so a single dimension having a bad month does not
   *  become a recommendation on its own. */
  burdenThreshold: number;
  /** How many capacity dimensions must read `supportive` before capacity
   *  counts as established. */
  capacityThreshold: number;
  /** How many sessions with favourable recovery are needed before
   *  `consider_progression` is reachable at all. §7's first rule. */
  minSessionsForProgression: number;
  /** The post-session delayed-risk reading at or above which an evening counts
   *  as difficult. Below the product's own escalation threshold on purpose:
   *  this describes the trend under that line, which is the part no other
   *  surface shows. */
  difficultEveningAt: number;
  /** Peak in-session distress at or above which a session counts as a high
   *  peak. */
  highPeakAt: number;
  /** How many high peaks in the window make acute load `high`. */
  repeatedHighPeaks: number;
  /** How many sessions with unresolved or difficult recovery make the recovery
   *  dimension `high`. */
  repeatedDifficultRecovery: number;
  /** Whether a clinician's own recorded uncertainty holds the state at
   *  `maintain`. §7 allows this "if configured" and is careful that it "should
   *  not be silently treated as a deterministic safety rule" — so it is a flag
   *  with a name, it is reported in the explanation when it fires, and it can
   *  only ever move the state DOWN from progression. */
  clinicianUncertaintyHolds: boolean;
}

export const THERAPEUTIC_LOAD_POLICY: TherapeuticLoadPolicy = {
  version: THERAPEUTIC_LOAD_VERSION,
  minRecoveryEvidence: 2,
  windowSessions: 6,
  burdenThreshold: 2,
  capacityThreshold: 2,
  minSessionsForProgression: 3,
  difficultEveningAt: 6,
  highPeakAt: 7,
  repeatedHighPeaks: 2,
  repeatedDifficultRecovery: 2,
  clinicianUncertaintyHolds: true,
};

/**
 * The gate states that stop the calculation.
 *
 * §6 step 1: "READ existing safety/gate decision. if blocked -> state =
 * blocked_by_safety; STOP."
 *
 * `unknown` is in this list and that is a judgement worth stating. It is not a
 * block — it means Steady could not confirm access — but a load recommendation
 * computed while the safety picture cannot be read is a recommendation resting
 * on an assumption nobody made. §7: "any unresolved existing safety state
 * prevents progression suggestion", and unconfirmable is unresolved.
 *
 * `caution` is NOT here. It is an open state with gentler framing, and treating
 * it as a block would make almost every stabilization day read as a safety
 * stop — which would teach a clinician that "held by a safety decision" means
 * very little.
 */
export const BLOCKING_GATE_STATES = ["limited", "review_needed", "safety_stop", "unknown"] as const;
