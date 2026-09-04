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
