// Therapeutic Load & Readiness (expansion handoff 05).
//
// §1 draws the line this whole feature stands on:
//
//   "Safety asks: is the person allowed to access this activity under Steady's
//    deterministic rules? Therapeutic Load asks: based on observed recovery,
//    how much additional intensity appears prudent for a clinician to consider?
//    The second can never answer the first or override it."
//
// SO THE FIRST THING THE ENGINE DOES IS READ THE GATE AND STOP. Not weight it,
// not fold it into a picture, not compute a workaround — §6's step 1 is "if
// blocked -> state = blocked_by_safety; STOP", and `assess` below has exactly
// that shape, before any dimension is computed. A version of this that gathered
// everything first and let safety be the strongest input would be a version
// where a strong enough recovery record could out-argue a safety stop.
//
// NO MODEL DECIDES THE STATE. §6's closing line, and it is structural: `assess`
// is pure, takes gathered evidence and a versioned policy, and there is no
// gateway call anywhere in this file. §10 lets a model TRANSLATE the state into
// clinician wording and lets it retrieve context; it may not "change state,
// safety gate, plan, or threshold", and it cannot, because it is never asked.
//
// AND NOTHING HERE CHANGES ANYTHING. §13: "no system action autonomously
// changes treatment intensity, module access, or trauma-processing status."
// This module writes exactly two kinds of row — a snapshot of what it read, and
// a record of what a clinician made of it. It has no write path to gates, to
// module unlocks, to plans, or to alerts, and `consider_progression` is a
// sentence about evidence rather than an instruction: §1, "there is enough
// favourable evidence for a clinician to review whether the next step is
// appropriate," not "progress the patient."
//
// THE CONSERVATIVE ASYMMETRY IS DELIBERATE (§7). It takes repeated favourable
// recovery, established capacity, and no deterioration anywhere to reach
// `consider_progression`. It takes one pattern of burden and thin capacity to
// reach `stabilize`. The cost of suggesting a clinician look at slowing down is
// a conversation; the cost of suggesting they look at pushing on when the
// record does not support it is a person who gets hurt.

import crypto from "node:crypto";

import { repo, type TenantContext } from "../repository";
import { ulid } from "../ids";
import { appendEventSafe } from "../events";
import type { ClinicalPolicy } from "../clinical-policy";
import { isDeviation } from "./recovery-trajectory";
import { gatherLoadEvidence, type LoadEvidence, type SessionRecovery } from "./therapeutic-load-evidence";
import {
  THERAPEUTIC_LOAD_POLICY, LOAD_STATE_LABEL, LOAD_DECISIONS,
  LOAD_DIMENSION_LABEL, CAPACITY_DIMENSION_LABEL,
  type TherapeuticLoadPolicy, type LoadState, type LoadDimensionKey,
  type CapacityDimensionKey, type DimensionReading, type CapacityReading,
  type LoadDecision,
} from "./therapeutic-load-policy";

export {
  THERAPEUTIC_LOAD_POLICY, THERAPEUTIC_LOAD_VERSION, LOAD_STATES, LOAD_STATE_LABEL,
  LOAD_STATE_NOTE, LOAD_DIMENSIONS, CAPACITY_DIMENSIONS, LOAD_DIMENSION_LABEL,
  CAPACITY_DIMENSION_LABEL, LOAD_DECISIONS, LOAD_DECISION_LABEL, BLOCKING_GATE_STATES,
} from "./therapeutic-load-policy";
export type {
  TherapeuticLoadPolicy, LoadState, LoadDimensionKey, CapacityDimensionKey,
  DimensionReading, CapacityReading, LoadDecision,
} from "./therapeutic-load-policy";
export { gatherLoadEvidence } from "./therapeutic-load-evidence";
export type { LoadEvidence, SafetyConstraint, SessionRecovery } from "./therapeutic-load-evidence";

export class TherapeuticLoadError extends Error {}

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

export interface LoadDimension {
  key: LoadDimensionKey;
  label: string;
  reading: DimensionReading;
  /** What was seen, in words, on the dimension's own terms. */
  detail: string;
  evidenceIds: string[];
  evidenceType: string;
}

export interface CapacityDimension {
  key: CapacityDimensionKey;
  label: string;
  reading: CapacityReading;
  detail: string;
  evidenceIds: string[];
  evidenceType: string;
}

export interface LoadAssessment {
  state: LoadState;
  stateLabel: string;
  load: LoadDimension[];
  capacity: CapacityDimension[];
  /** The safety decision, when there is one holding something. Displayed and
   *  never reinterpreted. */
  safetyConstraint: { ref: string | null; headline: string | null; safeAlternative: string | null } | null;
  /** Why the state is what it is, in the order a clinician reads it. */
  explanation: string[];
  /** What this cannot support. Never empty for a state above
   *  `insufficient_data`: every reading here rests on how much was recorded. */
  limitations: string[];
  /** The named reasons progression is not on the table, when it is not. §7's
   *  rules, reported individually so a clinician can see which one applied. */
  progressionBlockers: string[];
  policyVersion: string;
  evidenceCutoff: string;
}

// ---------------------------------------------------------------------------
// Reading the dimensions (§4)
// ---------------------------------------------------------------------------
//
// Each returns a categorical reading and the evidence behind it. NONE of them
// returns a number that another one is added to: §13 forbids "a readiness
// number... without explanation", and the surest way to keep a number from
// being displayed is for there not to be one.

function withChecks(sessions: SessionRecovery[]): SessionRecovery[] {
  return sessions.filter((s) => s.check !== null);
}

function acuteLoad(sessions: SessionRecovery[], policy: TherapeuticLoadPolicy): LoadDimension {
  const peaks = sessions.filter((s) => s.peakSuds !== null && s.peakSuds >= policy.highPeakAt);
  const hardStops = sessions.filter((s) => s.hardStop);
  const measured = sessions.filter((s) => s.peakSuds !== null);
  const evidenceIds = [...new Set([...peaks, ...hardStops].map((s) => s.sessionId))];

  // A HARD STOP IS HIGH ON ITS OWN. §4: "repeated high peaks or hard stop" —
  // the disjunction is not an accident. A session the safety engine ended is
  // one exposure and it is not an ordinary one.
  if (hardStops.length > 0) {
    return {
      key: "acute_load", label: LOAD_DIMENSION_LABEL.acute_load, reading: "high",
      detail: `${hardStops.length} session${hardStops.length === 1 ? "" : "s"} in the recent window ended on a safety rule.`,
      evidenceIds, evidenceType: "therapy_session",
    };
  }
  if (measured.length === 0) {
    return {
      key: "acute_load", label: LOAD_DIMENSION_LABEL.acute_load, reading: "not_established",
      detail: "No in-session peak readings were recorded, so how hard the sessions themselves have been is not established.",
      evidenceIds: [], evidenceType: "therapy_session",
    };
  }
  if (peaks.length >= policy.repeatedHighPeaks) {
    return {
      key: "acute_load", label: LOAD_DIMENSION_LABEL.acute_load, reading: "high",
      detail: `${peaks.length} of ${measured.length} recent sessions peaked at ${policy.highPeakAt} or above.`,
      evidenceIds, evidenceType: "therapy_session",
    };
  }
  return {
    key: "acute_load", label: LOAD_DIMENSION_LABEL.acute_load,
    reading: peaks.length > 0 ? "moderate" : "low",
    detail: `${peaks.length} of ${measured.length} recent sessions peaked at ${policy.highPeakAt} or above.`,
    evidenceIds, evidenceType: "therapy_session",
  };
}

function recoveryTime(sessions: SessionRecovery[], policy: TherapeuticLoadPolicy): LoadDimension {
  const checked = withChecks(sessions);
  const missing = sessions.length - checked.length;
  const difficult = checked.filter(
    (s) => !s.check!.recoveryConfirmed || s.check!.delayedRisk >= policy.difficultEveningAt
  );
  const evidenceIds = difficult.map((s) => s.check!.id);

  if (checked.length === 0) {
    return {
      key: "recovery_time", label: LOAD_DIMENSION_LABEL.recovery_time, reading: "not_established",
      // §7: "missing delayed follow-up prevents the system from assuming good
      // recovery." Not established, and named as unasked rather than clear.
      detail: missing > 0
        ? `Nobody was asked how the hours afterwards went, for any of the ${missing} recent session${missing === 1 ? "" : "s"}.`
        : "There are no recent sessions to have asked about.",
      evidenceIds: [], evidenceType: "post_session_check",
    };
  }
  const detail =
    `${difficult.length} of ${checked.length} recent sessions were followed by an unresolved or difficult evening` +
    (missing > 0 ? `, and ${missing} more had nobody ask.` : ".");
  if (difficult.length >= policy.repeatedDifficultRecovery) {
    return {
      key: "recovery_time", label: LOAD_DIMENSION_LABEL.recovery_time, reading: "high",
      detail, evidenceIds, evidenceType: "post_session_check",
    };
  }
  return {
    key: "recovery_time", label: LOAD_DIMENSION_LABEL.recovery_time,
    reading: difficult.length > 0 ? "moderate" : "low",
    detail, evidenceIds, evidenceType: "post_session_check",
  };
}

/** Sleep and dissociation both compare the day after a session to the reading
 *  before it, so "worse afterwards" has a before. A session with no baseline
 *  and a session that made no difference must not look alike. */
function costAfter(
  sessions: SessionRecovery[], policy: TherapeuticLoadPolicy,
  key: "sleep_cost" | "dissociation_cost"
): LoadDimension {
  const label = LOAD_DIMENSION_LABEL[key];
  const comparable = sessions.filter((s) => s.nextDay !== null && s.baseline !== null);
  if (comparable.length === 0) {
    return {
      key, label, reading: "not_established",
      detail:
        "There is no check-in on both sides of a recent session, so nothing can be said about what changed after the work.",
      evidenceIds: [], evidenceType: "checkin",
    };
  }
  const worse = comparable.filter((s) =>
    key === "sleep_cost"
      // Sleep quality runs the other way: lower afterwards is worse.
      ? s.nextDay!.sleepQuality < s.baseline!.sleepQuality
      : s.nextDay!.dissociation > s.baseline!.dissociation
  );
  const evidenceIds = worse.map((s) => s.sessionId);
  const detail = `${worse.length} of ${comparable.length} recent sessions were followed by a worse reading the next day.`;
  if (worse.length >= policy.repeatedDifficultRecovery) {
    return { key, label, reading: "high", detail, evidenceIds, evidenceType: "checkin" };
  }
  return {
    key, label, reading: worse.length > 0 ? "moderate" : "low",
    detail, evidenceIds, evidenceType: "checkin",
  };
}

function functionalCost(evidence: LoadEvidence): LoadDimension {
  const f = evidence.functional;
  if (f.goalCount === 0) {
    return {
      key: "functional_cost", label: LOAD_DIMENSION_LABEL.functional_cost, reading: "not_established",
      detail: "No life goal has been set with this person, so there is nothing to read function against.",
      evidenceIds: [], evidenceType: "return_goal_observation",
    };
  }
  if (f.moving === 0 && f.losingGround === 0) {
    return {
      key: "functional_cost", label: LOAD_DIMENSION_LABEL.functional_cost, reading: "not_established",
      detail: `${f.goalCount} active goal${f.goalCount === 1 ? "" : "s"}, none with two accepted observations in the window to compare.`,
      evidenceIds: f.evidenceIds, evidenceType: "return_goal_observation",
    };
  }
  if (f.losingGround > 0) {
    return {
      key: "functional_cost", label: LOAD_DIMENSION_LABEL.functional_cost, reading: "high",
      detail: `${f.losingGround} goal${f.losingGround === 1 ? " has" : "s have"} lost ground in the window${f.moving > 0 ? `, while ${f.moving} moved forward` : ""}.`,
      evidenceIds: f.evidenceIds, evidenceType: "return_goal_observation",
    };
  }
  return {
    key: "functional_cost", label: LOAD_DIMENSION_LABEL.functional_cost, reading: "low",
    detail: `${f.moving} goal${f.moving === 1 ? "" : "s"} moved forward in the window and none lost ground.`,
    evidenceIds: f.evidenceIds, evidenceType: "return_goal_observation",
  };
}

function interventionTolerance(evidence: LoadEvidence): LoadDimension {
  const shown = evidence.fingerprints;
  if (shown.length === 0) {
    return {
      key: "intervention_tolerance", label: LOAD_DIMENSION_LABEL.intervention_tolerance,
      reading: "not_established",
      detail: "No intervention has enough comparable exposures for a pattern yet.",
      evidenceIds: [], evidenceType: "intervention_instance",
    };
  }
  const burden = shown.filter((f) => f.patternState === "recovery_burden_observed");
  const mixed = shown.filter((f) => f.patternState === "mixed");
  const evidenceIds = [...burden, ...mixed].flatMap((f) => f.evidence.instanceIds).slice(0, 12);
  if (burden.length > 0) {
    return {
      key: "intervention_tolerance", label: LOAD_DIMENSION_LABEL.intervention_tolerance, reading: "high",
      detail: `Difficulty afterwards has been observed repeatedly for ${burden.map((f) => f.definition.displayName).join(", ")}.`,
      evidenceIds, evidenceType: "intervention_instance",
    };
  }
  if (mixed.length > 0) {
    return {
      key: "intervention_tolerance", label: LOAD_DIMENSION_LABEL.intervention_tolerance, reading: "moderate",
      detail: `The windows disagree for ${mixed.map((f) => f.definition.displayName).join(", ")} — settling in one and difficulty in another.`,
      evidenceIds, evidenceType: "intervention_instance",
    };
  }
  return {
    key: "intervention_tolerance", label: LOAD_DIMENSION_LABEL.intervention_tolerance, reading: "low",
    detail: `${shown.length} intervention${shown.length === 1 ? "" : "s"} with enough evidence, none showing repeated difficulty afterwards.`,
    evidenceIds: shown.flatMap((f) => f.evidence.instanceIds).slice(0, 12),
    evidenceType: "intervention_instance",
  };
}

function trajectoryCapacity(evidence: LoadEvidence): LoadDimension {
  const stated = evidence.trajectory.snapshots.filter(
    (s) => s.signalEligible && s.state !== "insufficient_data"
  );
  if (stated.length === 0) {
    return {
      key: "trajectory_capacity", label: LOAD_DIMENSION_LABEL.trajectory_capacity, reading: "not_established",
      detail: "No domain has enough comparable observations for a trajectory state yet.",
      evidenceIds: [], evidenceType: "longitudinal_event",
    };
  }
  const moved = stated.filter((s) => isDeviation(s.state));
  const evidenceIds = moved.flatMap((s) => s.classification.current.evidenceIds).slice(0, 12);
  if (moved.length >= 2) {
    return {
      key: "trajectory_capacity", label: LOAD_DIMENSION_LABEL.trajectory_capacity, reading: "high",
      detail: `${moved.length} domains have changed course: ${moved.map((s) => s.label).join(", ")}.`,
      evidenceIds, evidenceType: "longitudinal_event",
    };
  }
  if (moved.length === 1) {
    return {
      key: "trajectory_capacity", label: LOAD_DIMENSION_LABEL.trajectory_capacity, reading: "moderate",
      detail: `${moved[0].label} has changed course; the other ${stated.length - 1} domain${stated.length === 2 ? "" : "s"} with a state have not.`,
      evidenceIds, evidenceType: "longitudinal_event",
    };
  }
  return {
    key: "trajectory_capacity", label: LOAD_DIMENSION_LABEL.trajectory_capacity, reading: "low",
    detail: `${stated.length} domain${stated.length === 1 ? "" : "s"} with a state, none of them changing course.`,
    evidenceIds: [], evidenceType: "longitudinal_event",
  };
}

// ---- Capacity (§6 step 4) -------------------------------------------------

function functionalMovement(evidence: LoadEvidence): CapacityDimension {
  const f = evidence.functional;
  const base = {
    key: "functional_movement" as const, label: CAPACITY_DIMENSION_LABEL.functional_movement,
    evidenceIds: f.evidenceIds, evidenceType: "return_goal_observation",
  };
  if (f.goalCount === 0 || (f.moving === 0 && f.losingGround === 0)) {
    return { ...base, reading: "not_established", detail: "Nothing comparable recorded against a goal in the window." };
  }
  if (f.losingGround > 0 && f.moving > 0) {
    return { ...base, reading: "mixed", detail: `${f.moving} goal${f.moving === 1 ? "" : "s"} moved forward and ${f.losingGround} lost ground.` };
  }
  if (f.losingGround > 0) {
    return { ...base, reading: "absent", detail: `${f.losingGround} goal${f.losingGround === 1 ? " has" : "s have"} lost ground and none moved forward.` };
  }
  return { ...base, reading: "supportive", detail: `${f.moving} goal${f.moving === 1 ? "" : "s"} moved forward in the window.` };
}

function trajectoryFavourable(evidence: LoadEvidence): CapacityDimension {
  const stated = evidence.trajectory.snapshots.filter(
    (s) => s.signalEligible && s.state !== "insufficient_data"
  );
  const base = {
    key: "trajectory_favourable" as const, label: CAPACITY_DIMENSION_LABEL.trajectory_favourable,
    evidenceIds: stated.flatMap((s) => s.classification.current.evidenceIds).slice(0, 12),
    evidenceType: "longitudinal_event",
  };
  if (stated.length === 0) {
    return { ...base, reading: "not_established", detail: "No domain has a trajectory state yet." };
  }
  const moved = stated.filter((s) => isDeviation(s.state));
  const favourable = stated.filter((s) => s.state === "improving" || s.state === "stable");
  if (moved.length > 0 && favourable.length > 0) {
    return { ...base, reading: "mixed", detail: `${favourable.length} domain${favourable.length === 1 ? "" : "s"} favourable or holding, ${moved.length} changed course.` };
  }
  if (moved.length > 0) {
    return { ...base, reading: "absent", detail: `Every domain with a state has changed course.` };
  }
  return { ...base, reading: "supportive", detail: `${favourable.length} domain${favourable.length === 1 ? "" : "s"} favourable or holding, none changing course.` };
}

function recoveryConsistency(
  sessions: SessionRecovery[], policy: TherapeuticLoadPolicy
): CapacityDimension {
  const checked = withChecks(sessions);
  const missing = sessions.length - checked.length;
  const base = {
    key: "recovery_consistency" as const, label: CAPACITY_DIMENSION_LABEL.recovery_consistency,
    evidenceIds: checked.map((s) => s.check!.id), evidenceType: "post_session_check",
  };
  // §7: "missing delayed follow-up prevents the system from assuming good
  // recovery." A window with unasked sessions cannot be supportive, however
  // good the ones that were asked look.
  if (checked.length < policy.minRecoveryEvidence) {
    return { ...base, reading: "not_established", detail: `Only ${checked.length} recent session${checked.length === 1 ? " has" : "s have"} a follow-up recorded.` };
  }
  const settled = checked.filter(
    (s) => s.check!.recoveryConfirmed && s.check!.delayedRisk < policy.difficultEveningAt
  );
  if (missing > 0) {
    return {
      ...base, reading: "mixed",
      detail: `${settled.length} of ${checked.length} asked-about sessions recovered without difficulty, and ${missing} more had nobody ask.`,
    };
  }
  if (settled.length === checked.length) {
    return { ...base, reading: "supportive", detail: `All ${checked.length} recent sessions recovered without recorded difficulty.` };
  }
  if (settled.length === 0) {
    return { ...base, reading: "absent", detail: `None of the ${checked.length} recent sessions recovered without recorded difficulty.` };
  }
  return { ...base, reading: "mixed", detail: `${settled.length} of ${checked.length} recent sessions recovered without recorded difficulty.` };
}

function stabilizingResponse(evidence: LoadEvidence): CapacityDimension {
  const shown = evidence.fingerprints;
  const base = {
    key: "stabilizing_response" as const, label: CAPACITY_DIMENSION_LABEL.stabilizing_response,
    evidenceIds: shown.flatMap((f) => f.evidence.instanceIds).slice(0, 12),
    evidenceType: "intervention_instance",
  };
  if (shown.length === 0) {
    return { ...base, reading: "not_established", detail: "No intervention has enough comparable exposures for a pattern yet." };
  }
  const favourable = shown.filter((f) => f.patternState === "favorable_observed_pattern");
  const adverse = shown.filter(
    (f) => f.patternState === "recovery_burden_observed" || f.patternState === "mixed"
  );
  if (favourable.length > 0 && adverse.length === 0) {
    return { ...base, reading: "supportive", detail: `Settling has been observed repeatedly after ${favourable.map((f) => f.definition.displayName).join(", ")}.` };
  }
  if (favourable.length > 0) {
    return { ...base, reading: "mixed", detail: `Settling observed after ${favourable.length} intervention${favourable.length === 1 ? "" : "s"}, difficulty or disagreement after ${adverse.length}.` };
  }
  return { ...base, reading: "absent", detail: "No intervention has shown repeated settling." };
}

// ---------------------------------------------------------------------------
// The policy engine (§6)
// ---------------------------------------------------------------------------

/**
 * Decide the state from gathered evidence.
 *
 * PURE, and the cutoff and policy are arguments. That is what makes §13's
 * "safety gate is read first and always outranks therapeutic-load output"
 * something a test can prove rather than something the code intends: the gate
 * arrives as data, and the first branch returns before a dimension is computed.
 */
export function assess(
  evidence: LoadEvidence,
  args: { asOf: string; policy?: TherapeuticLoadPolicy }
): LoadAssessment {
  const policy = args.policy ?? THERAPEUTIC_LOAD_POLICY;
  const limitations: string[] = [];
  const progressionBlockers: string[] = [];

  if (evidence.unavailable.length > 0) {
    limitations.push(
      `Could not read: ${evidence.unavailable.join(", ")}. This reading rests on a partial picture.`
    );
  }

  // ---- Step 1: the gate, and stop. ---------------------------------------
  if (evidence.safety.blocked) {
    return {
      state: "blocked_by_safety",
      stateLabel: LOAD_STATE_LABEL.blocked_by_safety,
      // NO DIMENSIONS. §1: "if the safety engine blocks an activity,
      // Therapeutic Load displays that external constraint and stops. It does
      // not compute a workaround." Computing them anyway and hiding them would
      // leave a stored snapshot arguing with the gate.
      load: [], capacity: [],
      safetyConstraint: {
        ref: evidence.safety.ref,
        headline: evidence.safety.headline,
        safeAlternative: evidence.safety.safeAlternative,
      },
      explanation: [
        evidence.safety.headline ?? "A safety decision is holding something here.",
        evidence.safety.moduleTitle
          ? `The binding constraint is on ${evidence.safety.moduleTitle}.`
          : "",
        "Steady has not computed a load reading past this point. That decision is made by rules elsewhere and nothing here can change, weaken, or work around it.",
      ].filter(Boolean),
      limitations,
      progressionBlockers: ["A safety decision is holding something here."],
      policyVersion: policy.version,
      evidenceCutoff: args.asOf,
    };
  }

  // ---- Step 2: minimum recovery evidence. --------------------------------
  const sessions = evidence.sessions;
  const checked = withChecks(sessions);
  if (checked.length < policy.minRecoveryEvidence) {
    return {
      state: "insufficient_data",
      stateLabel: LOAD_STATE_LABEL.insufficient_data,
      load: [], capacity: [],
      safetyConstraint: null,
      explanation: [
        sessions.length === 0
          ? "No sessions are recorded for this person, so there is nothing to read recovery from."
          : `${checked.length} of the last ${sessions.length} sessions had anybody ask how the hours afterwards went. ${policy.minRecoveryEvidence} are needed.`,
        "Rely on your own judgement here. What is missing is a follow-up after the work, not a reassuring answer to one.",
      ],
      limitations,
      progressionBlockers: ["There is not enough recorded about how this person recovers."],
      policyVersion: policy.version,
      evidenceCutoff: args.asOf,
    };
  }

  // ---- Steps 3 and 4: the dimensions. ------------------------------------
  const load: LoadDimension[] = [
    acuteLoad(sessions, policy),
    recoveryTime(sessions, policy),
    costAfter(sessions, policy, "sleep_cost"),
    costAfter(sessions, policy, "dissociation_cost"),
    functionalCost(evidence),
    interventionTolerance(evidence),
    trajectoryCapacity(evidence),
  ];
  const capacity: CapacityDimension[] = [
    functionalMovement(evidence),
    trajectoryFavourable(evidence),
    recoveryConsistency(sessions, policy),
    stabilizingResponse(evidence),
  ];

  // COUNTS OF NAMED FINDINGS, NOT A SCORE. Nothing is weighted and nothing is
  // combined into a figure; each contributing dimension is listed by name in
  // the explanation and opens its own evidence.
  const burden = load.filter((d) => d.reading === "high");
  const support = capacity.filter((d) => d.reading === "supportive");
  const unestablished = [
    ...load.filter((d) => d.reading === "not_established"),
    ...capacity.filter((d) => d.reading === "not_established"),
  ];

  if (unestablished.length > 0) {
    limitations.push(
      `${unestablished.length} of the ${load.length + capacity.length} dimensions could not be established: ` +
      `${unestablished.map((d) => d.label.toLowerCase()).join("; ")}. Not established is not the same as clear.`
    );
  }
  const missingFollowups = sessions.length - checked.length;
  if (missingFollowups > 0) {
    limitations.push(
      `${missingFollowups} recent session${missingFollowups === 1 ? "" : "s"} had nobody ask how the hours afterwards went. That is missing evidence, not good recovery.`
    );
  }

  // ---- §7's conservative rules, each named. ------------------------------
  if (evidence.safety.openAlerts.length > 0) {
    progressionBlockers.push(
      `${evidence.safety.openAlerts.length} open safety alert${evidence.safety.openAlerts.length === 1 ? "" : "s"} on this person. An unresolved safety state rules out a progression suggestion.`
    );
  }
  if (checked.length < policy.minSessionsForProgression) {
    progressionBlockers.push(
      `${checked.length} session${checked.length === 1 ? "" : "s"} with a follow-up recorded; ${policy.minSessionsForProgression} are needed. One good session is not a pattern.`
    );
  }
  if (missingFollowups > 0) {
    progressionBlockers.push(
      "A recent session has no follow-up, so Steady cannot assume the recovery went well."
    );
  }
  const functionDown = load.find((d) => d.key === "functional_cost")!.reading === "high";
  const trajectoryDown = load.find((d) => d.key === "trajectory_capacity")!.reading === "high";
  if (functionDown || trajectoryDown) {
    // §7: "functional deterioration or multi-domain trajectory reversal
    // prevents a favorable progression suggestion until clinician review, even
    // if immediate session SUDS decreases."
    progressionBlockers.push(
      functionDown && trajectoryDown
        ? "Function has lost ground and more than one domain has changed course."
        : functionDown
          ? "Function has lost ground in the window, whatever the in-session readings did."
          : "More than one domain has changed course, whatever the in-session readings did."
    );
  }
  if (burden.length > 0) {
    progressionBlockers.push(
      `Recorded burden in ${burden.map((d) => d.label.toLowerCase()).join("; ")}.`
    );
  }
  if (support.length < policy.capacityThreshold) {
    progressionBlockers.push(
      `${support.length} of ${capacity.length} capacity dimensions read supportive; ${policy.capacityThreshold} are needed.`
    );
  }
  if (policy.clinicianUncertaintyHolds && evidence.clinician.uncertain) {
    progressionBlockers.push(
      "Your own note records uncertainty about pushing on. That is context, not a rule Steady applied to you — it holds the suggestion at maintain and it is shown so you can see it did."
    );
  }

  // ---- Step 5: the state. ------------------------------------------------
  const explanation: string[] = [];
  let state: LoadState;

  if (burden.length >= policy.burdenThreshold && support.length < policy.capacityThreshold) {
    state = "stabilize";
    explanation.push(
      `${burden.length} load dimensions read high — ${burden.map((d) => d.label.toLowerCase()).join("; ")} — and ${support.length} of ${capacity.length} capacity dimensions read supportive.`
    );
    explanation.push(
      "That combination is what this policy treats as repeated burden with thin evidence of tolerating it."
    );
  } else if (progressionBlockers.length === 0) {
    state = "consider_progression";
    explanation.push(
      `Recovery after the last ${checked.length} sessions has been favourable, and ${support.map((d) => d.label.toLowerCase()).join("; ")} support it.`
    );
    explanation.push(
      "Nothing in the broader course is deteriorating and no safety state is unresolved."
    );
  } else {
    state = "maintain";
    explanation.push(
      burden.length > 0
        ? `${burden.length} load dimension${burden.length === 1 ? "" : "s"} read high and ${support.length} capacity dimension${support.length === 1 ? "" : "s"} read supportive — not the combination this policy treats as repeated burden with thin capacity.`
        : `No load dimension reads high, and ${progressionBlockers.length} thing${progressionBlockers.length === 1 ? "" : "s"} rule out a progression suggestion.`
    );
  }

  // The boundary sentence, on every state that is not blocked. It is in the
  // explanation rather than in a footnote because a footnote is what a reader
  // scrolls past.
  explanation.push(
    "This is decision support. Nothing has been unlocked, scheduled, or changed, and the safety engine decides access on its own rules."
  );

  if (limitations.length === 0) {
    limitations.push(
      `Read over the last ${sessions.length} sessions under policy ${policy.version}. Every dimension rests on what was recorded, and a dimension nobody recorded is not a dimension that came back clear.`
    );
  }

  return {
    state,
    stateLabel: LOAD_STATE_LABEL[state],
    load, capacity,
    safetyConstraint: evidence.safety.openAlerts.length > 0
      ? {
          ref: null,
          headline: `${evidence.safety.openAlerts.length} open safety alert${evidence.safety.openAlerts.length === 1 ? "" : "s"} on this person, handled on the safety screen.`,
          safeAlternative: null,
        }
      : null,
    explanation,
    limitations,
    progressionBlockers,
    policyVersion: policy.version,
    evidenceCutoff: args.asOf,
  };
}

// ---------------------------------------------------------------------------
// Computing and storing
// ---------------------------------------------------------------------------

export interface LoadSnapshot extends LoadAssessment {
  id: string;
  personId: string;
  /** Which adapters could not run. */
  unavailable: string[];
}

/** Derived, so recomputing the same cutoff under the same policy lands on the
 *  same row rather than a second one. Exported so a test can address the write
 *  path the engine actually uses rather than a parallel one. */
export function loadSnapshotId(args: {
  tenantId: string; personId: string; policyVersion: string; evidenceCutoff: string;
}): string {
  return crypto.createHash("sha256")
    .update([args.tenantId, args.personId, args.policyVersion, args.evidenceCutoff].join("|"))
    .digest("hex").slice(0, 26);
}

export async function computeTherapeuticLoad(
  ctx: TenantContext, personId: string,
  args: { asOf?: string; policy?: TherapeuticLoadPolicy; clinicalPolicy?: ClinicalPolicy } = {}
): Promise<LoadSnapshot> {
  const policy = args.policy ?? THERAPEUTIC_LOAD_POLICY;
  const asOf = args.asOf ?? new Date().toISOString();
  const evidence = await gatherLoadEvidence(ctx, {
    personId, asOf, windowSessions: policy.windowSessions, policy: args.clinicalPolicy,
  });
  const assessment = assess(evidence, { asOf, policy });
  return {
    ...assessment,
    id: loadSnapshotId({ tenantId: ctx.tenantId, personId, policyVersion: policy.version, evidenceCutoff: asOf }),
    personId,
    unavailable: evidence.unavailable,
  };
}

/** Persist a snapshot with its evidence, by role. Idempotent on the derived id. */
export async function saveTherapeuticLoad(
  ctx: TenantContext, snapshot: LoadSnapshot, actorPersonId: string
): Promise<void> {
  const r = repo(ctx);
  const existing = await r.findOne<{ id: string }>("therapeutic_load_snapshots", "id = ?", [snapshot.id]);
  if (existing) return;

  await r.insert("therapeutic_load_snapshots", {
    id: snapshot.id,
    person_id: snapshot.personId,
    state: snapshot.state,
    policy_version: snapshot.policyVersion,
    evidence_cutoff: snapshot.evidenceCutoff,
    load_dimensions_json: JSON.stringify(snapshot.load),
    capacity_dimensions_json: JSON.stringify(snapshot.capacity),
    safety_constraint_ref: snapshot.safetyConstraint?.ref ?? null,
    explanation_json: JSON.stringify(snapshot.explanation),
    limitations_json: JSON.stringify(snapshot.limitations),
    computed_at: new Date().toISOString(),
  });

  // §5's four roles. A constraint and a capacity finding are not the same kind
  // of evidence, and a table that stored them alike would lose the distinction
  // that makes the snapshot readable a year later.
  const rows: Array<{ type: string; id: string; role: string }> = [];
  for (const d of snapshot.load) {
    for (const id of d.evidenceIds) rows.push({ type: d.evidenceType, id, role: "load" });
  }
  for (const d of snapshot.capacity) {
    for (const id of d.evidenceIds) rows.push({ type: d.evidenceType, id, role: "capacity" });
  }
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.type}|${row.id}|${row.role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await r.insert("therapeutic_load_evidence", {
      snapshot_id: snapshot.id, evidence_type: row.type, evidence_id: row.id, role: row.role,
    }).catch(() => { /* a repeated citation is one citation */ });
  }

  await appendEventSafe({
    personId: snapshot.personId,
    type: "therapeutic_load.snapshot_computed",
    actorType: "system",
    actorId: actorPersonId,
    payload: {
      snapshotId: snapshot.id, state: snapshot.state,
      policyVersion: snapshot.policyVersion, evidenceCutoff: snapshot.evidenceCutoff,
      blockedBySafety: snapshot.state === "blocked_by_safety",
    },
  });
}

export async function evidenceForLoadSnapshot(
  ctx: TenantContext, snapshotId: string
): Promise<Array<{ evidenceType: string; evidenceId: string; role: string }>> {
  const rows = await repo(ctx).findMany<{ evidence_type: string; evidence_id: string; role: string }>(
    "therapeutic_load_evidence", "snapshot_id = ?", [snapshotId], { orderBy: "role ASC, evidence_type ASC" }
  );
  return rows.map((r) => ({ evidenceType: r.evidence_type, evidenceId: r.evidence_id, role: r.role }));
}

// ---------------------------------------------------------------------------
// Clinician review (§5, §8)
// ---------------------------------------------------------------------------

export interface LoadReview {
  id: string;
  snapshotId: string;
  clinicianPersonId: string;
  decision: LoadDecision;
  note: string | null;
  createdAt: string;
}

/**
 * Record a clinician's decision about a recommendation.
 *
 * THIS CHANGES NOTHING BUT THE RECORD. §8: "these actions record judgement;
 * they do not automatically change plan/gates", and §13: "no system action
 * autonomously changes treatment intensity, module access, or trauma-processing
 * status." `review_progression` is a clinician saying they will look at it —
 * not an unlock, not a schedule, and there is no write path from here to either.
 */
export async function recordLoadReview(
  ctx: TenantContext,
  args: {
    personId: string; snapshotId: string; clinicianPersonId: string;
    decision: LoadDecision; note?: string | null;
  }
): Promise<LoadReview> {
  if (!(LOAD_DECISIONS as readonly string[]).includes(args.decision)) {
    throw new TherapeuticLoadError(`"${args.decision}" is not one of the recorded decisions.`);
  }
  if (args.decision === "disagree" && !args.note?.trim()) {
    throw new TherapeuticLoadError(
      "Recording a disagreement needs the reason in words — otherwise the next reader sees a contested reading with nothing to contest it with."
    );
  }
  const id = ulid();
  const createdAt = new Date().toISOString();
  await repo(ctx).insert("therapeutic_load_reviews", {
    id,
    person_id: args.personId,
    snapshot_id: args.snapshotId,
    clinician_person_id: args.clinicianPersonId,
    decision: args.decision,
    note: args.note?.trim() || null,
    created_at: createdAt,
  });
  await appendEventSafe({
    personId: args.personId,
    type: "therapeutic_load.clinician_reviewed",
    actorType: "clinician",
    actorId: args.clinicianPersonId,
    payload: { snapshotId: args.snapshotId, decision: args.decision, hasNote: Boolean(args.note?.trim()) },
  });
  return {
    id, snapshotId: args.snapshotId, clinicianPersonId: args.clinicianPersonId,
    decision: args.decision, note: args.note?.trim() || null, createdAt,
  };
}

export async function loadReviewsForPerson(
  ctx: TenantContext, personId: string
): Promise<LoadReview[]> {
  const rows = await repo(ctx).findMany<{
    id: string; snapshot_id: string; clinician_person_id: string;
    decision: string; note: string | null; created_at: string;
  }>("therapeutic_load_reviews", "person_id = ?", [personId], { orderBy: "created_at DESC" });
  return rows.map((r) => ({
    id: r.id, snapshotId: r.snapshot_id, clinicianPersonId: r.clinician_person_id,
    decision: r.decision as LoadDecision, note: r.note, createdAt: r.created_at,
  }));
}

// ---------------------------------------------------------------------------
// What other surfaces read (§8, §9)
// ---------------------------------------------------------------------------

/** The compact shape Session Prep, the caseload and the drawer read. */
export interface LoadContext {
  state: LoadState;
  stateLabel: string;
  /** §8's "2-4 evidence bullets". */
  bullets: string[];
  limitations: string[];
  policyVersion: string;
  blockedBySafety: boolean;
}

export function loadContext(snapshot: LoadSnapshot): LoadContext {
  const contributing =
    snapshot.state === "consider_progression"
      ? snapshot.capacity.filter((d) => d.reading === "supportive")
      : snapshot.load.filter((d) => d.reading === "high" || d.reading === "moderate");
  return {
    state: snapshot.state,
    stateLabel: snapshot.stateLabel,
    // The dimensions that actually contributed, named, at most four. A bullet
    // list of every dimension would be complete and unreadable, and §8 asks for
    // two to four.
    bullets: contributing.slice(0, 4).map((d) => `${d.label}: ${d.detail}`),
    limitations: snapshot.limitations,
    policyVersion: snapshot.policyVersion,
    blockedBySafety: snapshot.state === "blocked_by_safety",
  };
}
