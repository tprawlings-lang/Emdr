// The attention vocabulary — bands, states, dismissal reasons, care actions and
// the shapes they travel in (expansion handoff 03 §9, §10, §13).
//
// Split from the store for the same reason intervention-vocabulary and
// response-vocabulary were: the Quick Review Drawer is a client component, it
// needs these labels, and the store reaches better-sqlite3. Importing the store
// into the browser bundle is something the build refuses, correctly — and it
// refused this one before the split, which is how the file came to exist.
//
// Nothing here touches a database, so nothing here can weaken the boundary the
// store enforces. These are names for kinds of thing, and the rule §9 protects
// — that an attention band is review-worthiness and never safety authority —
// lives in the names themselves: there is no band here that could be read as a
// safety state.

// ---------------------------------------------------------------------------
// Vocabulary (§9, §10)
// ---------------------------------------------------------------------------

/** §10's four bands. Review-worthiness only — none of these is a safety state,
 *  and `review_now` is deliberately NOT called "urgent": §2's display rule is
 *  that "non-safety review_now cannot masquerade as safety". */
export const ATTENTION_BANDS = ["review_now", "review_today", "follow_up", "watch"] as const;
export type AttentionBand = (typeof ATTENTION_BANDS)[number];

export const BAND_LABEL: Record<AttentionBand, string> = {
  review_now: "Review now",
  review_today: "Review today",
  follow_up: "Follow up",
  watch: "Worth watching",
};

/** §9's lifecycle states. */
export const SIGNAL_STATES = [
  "open", "acknowledged", "waiting_member", "waiting_staff", "resolved", "dismissed",
] as const;
export type SignalState = (typeof SIGNAL_STATES)[number];

/** States that still claim a clinician's attention. Used by the queue and by
 *  the stable count, from one place so the two cannot disagree about what
 *  "open work" means. */
export const OPEN_STATES: readonly SignalState[] = [
  "open", "acknowledged", "waiting_member", "waiting_staff",
];

export function isOpenState(s: SignalState): boolean {
  return OPEN_STATES.includes(s);
}

/** §12: "dismiss requires a reason category and optional note." A closed set,
 *  because a free-text-only dismissal is a dismissal nobody can count. */
export const DISMISS_REASONS = [
  "not_clinically_relevant",
  "already_addressed",
  "evidence_looks_wrong",
  "expected_for_this_person",
  "other",
] as const;
export type DismissReason = (typeof DISMISS_REASONS)[number];

export const DISMISS_REASON_LABEL: Record<DismissReason, string> = {
  not_clinically_relevant: "Not clinically relevant for them",
  already_addressed: "Already addressed",
  evidence_looks_wrong: "The evidence looks wrong",
  expected_for_this_person: "Expected for this person",
  other: "Something else",
};

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

export interface AttentionSignal {
  id: string;
  personId: string;
  signalType: string;
  sourceFeature: string;
  dedupeKey: string;
  band: AttentionBand;
  /** Why this row exists, in one plain sentence. §4: "never an unexplained
   *  score." */
  statement: string;
  /** What changed since the last review, or null when there is nothing
   *  deterministic to compare against — rendered as "first time here", never
   *  as an invented comparison. */
  changeText: string | null;
  state: SignalState;
  ownerPersonId: string | null;
  dueAt: string | null;
  firstDetectedAt: string;
  lastDetectedAt: string;
  /** The cutoff the provider evaluated against. */
  evidenceAt: string;
  policyVersion: string;
  limitations: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SignalEvidence {
  evidenceType: string;
  evidenceId: string;
  rank: number;
}

/** §10's candidate: what a provider returns. Deliberately has no id, no state
 *  and no owner — a provider says what it observed, and the lifecycle is this
 *  module's. A provider that could set state would be a provider that could
 *  resolve its own signal. */
export interface AttentionSignalCandidate {
  type: string;
  dedupeKey: string;
  band: AttentionBand;
  statement: string;
  changeText?: string | null;
  evidenceIds: string[];
  evidenceAt: string;
  limitations: string[];
  policyVersion: string;
  /** What kind of thing the evidence ids are, so the drawer can open them. */
  evidenceType?: string;
}

/** The stored row shape. Exported so the store maps every row through the one
 *  hydrator, rather than each reader building its own. */
export interface SignalRow {
  id: string; person_id: string; signal_type: string; source_feature: string;
  dedupe_key: string; attention_band: string; statement: string;
  change_text: string | null; state: string; owner_person_id: string | null;
  due_at: string | null; first_detected_at: string; last_detected_at: string;
  evidence_at: string; policy_version: string; limitations_json: string;
  created_at: string; updated_at: string;
}

export function toSignal(r: SignalRow): AttentionSignal {
  let limitations: string[] = [];
  try {
    const parsed = JSON.parse(r.limitations_json);
    if (Array.isArray(parsed)) limitations = parsed.filter((x): x is string => typeof x === "string");
  } catch { /* a malformed list is an empty list, never a crash on a read path */ }
  return {
    id: r.id,
    personId: r.person_id,
    signalType: r.signal_type,
    sourceFeature: r.source_feature,
    dedupeKey: r.dedupe_key,
    band: r.attention_band as AttentionBand,
    statement: r.statement,
    changeText: r.change_text,
    state: r.state as SignalState,
    ownerPersonId: r.owner_person_id,
    dueAt: r.due_at,
    firstDetectedAt: r.first_detected_at,
    lastDetectedAt: r.last_detected_at,
    evidenceAt: r.evidence_at,
    policyVersion: r.policy_version,
    limitations,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export class AttentionSignalError extends Error {}

/** The stamp format the clinical tables use. */
export function nowStamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}


/** §13's action vocabulary. Closed, because an action type nobody defined is
 *  an action nobody can count or audit. */
export const CARE_ACTIONS = [
  "review", "contact", "add_followup", "record_thought",
  "open_session_prep", "review_trajectory", "adjust_plan_link", "resolve",
] as const;
export type CareAction = (typeof CARE_ACTIONS)[number];

/**
 * The ones the product actually writes.
 *
 * CLOSED IS NOT THE SAME AS BUILT, which is what this constant is for. §13's
 * vocabulary names eight actions; four of them once had no writer anywhere —
 * `record_thought`, `open_session_prep`, `review_trajectory` and
 * `adjust_plan_link` — and two of those four would have rendered on no screen
 * even if something wrote them. A word in a closed vocabulary reads exactly
 * like a built feature, and the demo seed proved it: reaching for
 * `record_thought` as the obvious home for a clinician's note put 249 rows of a
 * shape no clinician can produce into the demonstration, invisible everywhere.
 *
 * ALL EIGHT ARE WRITTEN NOW, and the constant stays rather than being deleted
 * with the gap it described. It is the thing that made the gap countable, and
 * the next action added to §13's list arrives unwritten like the last four did;
 * a list that existed only while it was non-empty would have to be reinvented
 * at exactly the moment nobody remembers why it mattered.
 *
 * NAMED HERE RATHER THAN IN THE TEST that checks it, so that somebody choosing
 * an action type meets the distinction at the vocabulary instead of finding it
 * after seeding a thousand rows. tests/demo-population.test.ts holds this list
 * to the source, so it cannot quietly go stale in either direction.
 */
export const PRODUCT_WRITTEN_CARE_ACTIONS: readonly CareAction[] = [
  "review", "contact", "add_followup", "resolve",
  // ADDED 23 SEPTEMBER. Three of the four unwritten actions got a writer: a
  // captured thought records one by itself, and a clinician presses a control
  // to record that they prepared for a session or read a trajectory.
  "record_thought", "open_session_prep", "review_trajectory",
  // ADDED 24 SEPTEMBER, and it needed a feature rather than a writer. There was
  // no plan link in this product — no model, no screen, no column, nothing
  // called a link on a plan anywhere — so the word could not be written until
  // somebody decided what one IS. It is the connection between a piece of
  // assigned support and the goal it is meant to move, it lives on the
  // assignment, and `linkAssignmentToGoal` is the only thing that writes this.
  "adjust_plan_link",
];

/**
 * What is left: nothing, and that is worth being able to ask.
 *
 * EMPTY AND KEPT. Every word in §13's closed vocabulary now has something in
 * the product that produces it and a screen that shows it. This stays as the
 * question rather than the answer, because the failure it guards against is a
 * word added to the list above and quietly left without a writer, which reads
 * as a built feature to everybody downstream.
 */
export const UNWRITTEN_CARE_ACTIONS: readonly CareAction[] =
  CARE_ACTIONS.filter((a) => !PRODUCT_WRITTEN_CARE_ACTIONS.includes(a));

export interface CareActionRecord {
  id: string;
  personId: string;
  clinicianPersonId: string;
  signalId: string | null;
  action: CareAction;
  note: string | null;
  startedAt: string | null;
  completedAt: string;
  durationSeconds: number | null;
  outcomeState: string | null;
  sourceSurface: string;
  /** The entry this one corrects, when it is a correction. §13: "clinician can
   *  correct or annotate recorded care time", and the cross-feature invariant
   *  is that corrections append — so the superseded row is still there, and
   *  this is the pointer back to it. */
  supersedesId: string | null;
  /** Why the correction was made. Required on a correction, because an
   *  unexplained rewrite of a care-time record is the thing a ledger exists to
   *  prevent. */
  correctionReason: string | null;
  /**
   * The newest evidence the reviewer had in front of them.
   *
   * Null on every row written before completion semantics existed, and that is
   * the honest value: `reviewCurrency` reads an absent version as "unknown"
   * rather than inventing one and calling the review current.
   */
  reviewedEvidenceAt: string | null;
  /** Who holds this next. "Next responsible party" from the handoff's list —
   *  a completion that names nobody leaves the person between two people. */
  nextResponsibleParty: string | null;
  /** The currency policy in force when this was recorded, so a later reader
   *  knows which rule decided what "out of date" meant. */
  reviewCurrencyPolicy: string | null;
  createdAt: string;
}
