// The model registry shell (handoff 07 §3.8 p37–38, G13; Wave 7 governance).
//
// §3.8 is twelve required fields and one sentence that decides what this module
// is for:
//
//   "A registered model MAY GENERATE SHADOW OUTPUTS for evaluation. The
//    application DOES NOT SHOW THOSE OUTPUTS TO PATIENTS OR USE THEM FOR CARE
//    until Steady completes clinical, fairness, security and governance
//    review."
//
// SO THIS IS A SHELL, AND THE SHELL IS THE POINT. There is no model in this
// build — the planning engine is descriptive and deterministic, by design and
// by §3's own instruction. Registering nothing may look like ceremony, and it
// is the opposite: §7 names "unregistered model execution" as the thing this
// wave prohibits, and a prohibition written after the first model exists is a
// prohibition written against a working system by someone who wants it to keep
// working.
//
// The registry therefore does two jobs and refuses a third:
//   • it says what a model must declare BEFORE it may run at all;
//   • it says what a shadow output may and may not reach;
//   • it does NOT provide a way to run one, because nothing here runs models.
//
// NO IMPORTS. Held by a review surface and by tests.

/** §3.8's twelve fields, in the document's order. */
export const REGISTRY_FIELDS = [
  "model_id_and_version",
  "intended_use",
  "out_of_scope_use",
  "training_data",
  "features",
  "target",
  "validation",
  "fairness",
  "monitoring",
  "human_factors",
  "retirement",
] as const;
export type RegistryField = (typeof REGISTRY_FIELDS)[number];

/** What each field must contain, from §3.8's right-hand column. Kept verbatim
 *  in substance so a reviewer can compare the screen against the document
 *  without translating. */
export const FIELD_REQUIREMENT: Record<RegistryField, string> = {
  model_id_and_version: "Immutable identifier and semantic version.",
  intended_use: "Question, user, workflow and allowed output.",
  out_of_scope_use: "Explicit prohibited decisions and populations.",
  training_data: "Origin, dates, cohort, representation, exclusions and rights.",
  features: "Definitions, provenance, protected attributes and proxy review.",
  target: "Outcome definition, horizon and censoring.",
  validation: "Temporal, geographic, tenant and subgroup results.",
  fairness: "Chosen metrics, thresholds, intervals and limitations.",
  monitoring: "Drift, missingness, calibration, error rates and alert owners.",
  human_factors: "How users interpret, challenge and override output.",
  retirement: "Stop conditions, replacement plan and archive rules.",
};

/**
 * A registration. Every field is required and every field is a string, because
 * the alternative — optional fields with sensible defaults — is how a model
 * gets registered with nine of the twelve answers.
 */
export type Registration = Record<RegistryField, string>;

/** Which required fields a registration has not answered. */
export function missingFields(r: Partial<Registration>): RegistryField[] {
  return REGISTRY_FIELDS.filter((f) => !(r[f] ?? "").trim());
}

/**
 * §7's prohibition: "unregistered model execution".
 *
 * A model may not run unless every field is answered. Not "should not" — this
 * is the predicate a runner would have to call, and it exists before any runner
 * does so that the runner is written against it rather than around it.
 */
export function mayRun(r: Partial<Registration>): boolean {
  return missingFields(r).length === 0;
}

// ---------------------------------------------------------------------------
// What a shadow output may reach
// ---------------------------------------------------------------------------

/**
 * §3.8's second sentence, as a closed set.
 *
 * Shadow means shadow: the output exists for evaluation and reaches evaluation
 * surfaces. Everything a patient or a care decision touches is on the forbidden
 * list, and the list is exhaustive rather than illustrative so that a new
 * surface is refused by default instead of permitted by omission.
 */
export const SHADOW_MAY_REACH = ["evaluation_record", "governance_review"] as const;

export const SHADOW_MAY_NOT_REACH = [
  "member_surface",
  "clinician_task_queue",
  "care_decision",
  "gate_decision",
  "payer_export",
  "aggregate_report",
] as const;

export type ShadowDestination =
  | (typeof SHADOW_MAY_REACH)[number]
  | (typeof SHADOW_MAY_NOT_REACH)[number];

export function shadowOutputMayReach(destination: ShadowDestination): boolean {
  return (SHADOW_MAY_REACH as ReadonlyArray<string>).includes(destination);
}

/** The four reviews §3.8 names, all of which must complete before a shadow
 *  output stops being a shadow output. */
export const RELEASE_REVIEWS = ["clinical", "fairness", "security", "governance"] as const;
export type ReleaseReview = (typeof RELEASE_REVIEWS)[number];

export interface ReleaseState {
  completed: ReadonlyArray<ReleaseReview>;
}

/** Whether a model's outputs may be used for care. Four reviews, all of them,
 *  and the function says which are outstanding rather than only that the answer
 *  is no. */
export function outstandingReviews(s: ReleaseState): ReleaseReview[] {
  return RELEASE_REVIEWS.filter((r) => !s.completed.includes(r));
}

export function mayLeaveShadowMode(s: ReleaseState): boolean {
  return outstandingReviews(s).length === 0;
}

/**
 * The registry's current contents.
 *
 * EMPTY, AND THAT IS THE REPORTABLE ANSWER. §9's coverage model exists so an
 * empty list can be told apart from a broken one; a registry that renders
 * nothing with no explanation reads as a screen that failed to load. The
 * surface says which of the two this is.
 */
export const REGISTERED_MODELS: ReadonlyArray<Registration> = [];

export const EMPTY_REGISTRY_NOTE =
  "No model is registered, and none is running. The planning engine in this build is descriptive and deterministic — it evaluates fixed rules against recorded data and produces no model output. This registry exists before the first model rather than after it, so the requirements below are what a model would have to answer to run at all.";
