// The projection envelope (Web GUI handoff §30.8, §30.3, §8.3).
//
// Every projection arrives wrapped. The wrapper is not ceremony: §30.8 lists
// eight distinct presentation states, and the whole point is that they must not
// look alike.
//
//   "Health software cannot treat 'no data' as one condition." (§14)
//
// The two that matter most are the pair this codebase has already conflated
// once. An empty queue because the day is genuinely clear, and an empty queue
// because the projection failed, render identically if the page just maps over
// an array. The first is good news. The second is a clinician working blind
// while believing they are up to date — and the failure mode is silent, which
// is what makes it dangerous rather than merely annoying.
//
// So `ready` is one variant among eight rather than the default, and the type
// forces a page to say what it does with the other seven. A page that only
// handles `ready` will not compile against `renderEnvelope`.
//
// Two of the states are safety states rather than data states, and they fail
// CLOSED (§30.8): with policy unavailable a new session cannot start, and with
// audit unavailable a high-impact action cannot proceed. Both keep grounding
// and crisis paths open, because those must survive every failure this system
// can have — §1's "grounding and crisis resources remain reachable even when a
// write, subscription, sync, or service fails."

/** §30.8's eight states, in the order the table gives them. */
export type PresentationState =
  | "loading"
  | "ready"
  | "empty"
  | "stale"
  | "partial"
  | "permission_denied"
  | "projection_failed"
  | "policy_unavailable"
  | "audit_unavailable";

/** Provenance every projection carries (§8.3, §30.2).
 *
 *  §8.3: "Each projection must include computed_at, source_watermark,
 *  policy_version, and tenant_id. A projection is disposable. The event and
 *  review records remain authoritative." */
export interface ProjectionMeta {
  /** Contract shape, e.g. "member_today.v4" — the page examples name a version
   *  per screen, so a projection and the page that reads it can disagree
   *  loudly rather than silently. */
  schemaVersion: string;
  /** Which build of the projection produced this instance. */
  projectionVersion: string;
  generatedAt: string;
  tenantId: string;
  /** Newest source event this instance reflects. */
  sourceWatermark: string | null;
  policyVersion: string;
}

/** What is missing, for `partial`.
 *
 *  §30.8: "Show present values and list missing sources. Do not calculate a
 *  clean total from incomplete inputs." Naming the source is the difference
 *  between a caveat and an explanation. */
export interface MissingSource {
  source: string;
  reason: string;
  /** Last time this source did produce data, when that is known. */
  lastGoodAt?: string;
}

export interface Envelope<T> {
  state: PresentationState;
  meta: ProjectionMeta;
  /** Present for ready, stale and partial. Never for the rest — a failed
   *  projection with usable-looking data in it is how a fallback to raw domain
   *  tables gets written by accident (§30.8 forbids that fallback). */
  data?: T;
  /** Why this state holds, in words a person can read. */
  reason?: string;
  /** stale only: when the data was actually current, and why it is not now. */
  staleSince?: string;
  /** partial only. */
  missing?: MissingSource[];
  /** projection_failed only: the id to quote to support. §30.8 says log the
   *  correlation ID privately — this is the opaque half the user may see. */
  correlationId?: string;
}

export class EnvelopeError extends Error {}

// ---------------------------------------------------------------------------
// Constructors — one per state, so a state is chosen rather than defaulted
// ---------------------------------------------------------------------------

export function ready<T>(meta: ProjectionMeta, data: T): Envelope<T> {
  return { state: "ready", meta, data };
}

/** An intentional absence. `reason` must explain whether it is expected —
 *  §30.8: "Explain what is absent and whether that is expected." */
export function empty<T>(meta: ProjectionMeta, reason: string): Envelope<T> {
  if (!reason.trim()) throw new EnvelopeError("an empty projection must say what is absent");
  return { state: "empty", meta, reason };
}

export function stale<T>(meta: ProjectionMeta, data: T, staleSince: string, reason: string): Envelope<T> {
  if (!staleSince) throw new EnvelopeError("stale data must say when it was last current");
  return { state: "stale", meta, data, staleSince, reason };
}

export function partial<T>(meta: ProjectionMeta, data: T, missing: MissingSource[]): Envelope<T> {
  if (missing.length === 0) {
    throw new EnvelopeError("a partial projection with nothing missing is a ready projection");
  }
  return { state: "partial", meta, data, missing };
}

/** §30.8: "Generic scope message. No subject or field existence leak."
 *
 *  Deliberately takes no subject and no reason detail. A denial that explains
 *  itself confirms the subject exists, which §26's role acceptance forbids:
 *  "Denied and missing pages do not reveal protected existence." */
export function permissionDenied<T>(meta: ProjectionMeta): Envelope<T> {
  return {
    state: "permission_denied",
    meta,
    reason: "You do not have access to this in your current role and scope.",
  };
}

export function projectionFailed<T>(meta: ProjectionMeta, correlationId: string): Envelope<T> {
  return {
    state: "projection_failed",
    meta,
    correlationId,
    reason: "This view could not be assembled. Support options remain available.",
  };
}

/** Fail closed: no new session may start (§30.8, §30.7). */
export function policyUnavailable<T>(meta: ProjectionMeta): Envelope<T> {
  return {
    state: "policy_unavailable",
    meta,
    reason: "Steady cannot confirm today's safety decision, so new sessions are paused. Grounding and support remain open.",
  };
}

/** Fail closed: protected evidence and high-impact actions are blocked
 *  (§30.6 step 7 — "fail closed for protected evidence if audit write fails"). */
export function auditUnavailable<T>(meta: ProjectionMeta): Envelope<T> {
  return {
    state: "audit_unavailable",
    meta,
    reason: "Actions that must be recorded are unavailable until audit logging recovers.",
  };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** The three states that carry data. */
export const STATES_WITH_DATA: PresentationState[] = ["ready", "stale", "partial"];

/** States in which a decision requiring current data must not be taken.
 *
 *  §30.8: stale "blocks decisions that require current data"; the two
 *  fail-closed states block session start and recorded actions; and a failed or
 *  denied projection has nothing to decide from. */
export const STATES_BLOCKING_DECISIONS: PresentationState[] = [
  "loading", "empty", "stale", "permission_denied",
  "projection_failed", "policy_unavailable", "audit_unavailable",
];

export function hasData<T>(e: Envelope<T>): e is Envelope<T> & { data: T } {
  return STATES_WITH_DATA.includes(e.state) && e.data !== undefined;
}

/** Whether an action that needs current, authorised, recordable state may run. */
export function decisionAllowed<T>(e: Envelope<T>): boolean {
  return !STATES_BLOCKING_DECISIONS.includes(e.state);
}

/** Crisis and grounding survive every state.
 *
 *  Not a helper so much as a statement with a test attached: there is no
 *  envelope state in which support is withdrawn, and §1 lists that among the
 *  things that must not change. */
export function supportReachable<T>(_e: Envelope<T>): true {
  return true;
}
