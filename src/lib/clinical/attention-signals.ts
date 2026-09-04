// Durable attention signals (expansion handoff 03 §9, §12; Phase 1).
//
// §9's first sentence is the design: "do not overload the alerts table with
// every non-safety intelligence output. Safety alert semantics must stay
// believable."
//
// An alerts table that also carries "her grounding response has been mixed
// lately" is an alerts table a clinician learns to skim — and the thing they
// skim past is the safety row. So this is a separate substrate for
// REVIEW-WORTHINESS, and `alerts.ts` keeps authority. Nothing in this module
// can create a safety obligation, clear one, or change one's band; the work
// queue merges the two lists and safety keeps its ordering.
//
// FOUR RULES THIS MODULE MAKES STRUCTURAL.
//
//   ONE LINEAGE PER CONCERN. `dedupe_key` is UNIQUE per tenant and person, so
//   §12's "update the row and expose new-since-review rather than creating
//   duplicates" is enforced by the schema rather than remembered by each
//   provider. A provider that re-evaluates every hour updates one row; a queue
//   that grew a row per evaluation would be an alert wall built by arithmetic.
//
//   OPENING IS NOT ACKNOWLEDGING. §12: "opening a row or drawer does not
//   silently acknowledge it. Acknowledgement is explicit." There is no code
//   path here that moves a signal out of `open` as a side effect of reading it
//   — `acknowledge` takes a clinician id, and so does every other transition.
//
//   STABLE IS NOT STORED. §9: "Stable / No Action is a projection outcome...
//   do not insert thousands of stable rows into the signal table." A person
//   with nothing to do about them is the ABSENCE of a row. `stableCount` in
//   work-queue.ts computes it by subtraction, so the table grows with the work
//   rather than with the caseload.
//
//   A DISMISSAL HAS A REASON. §12: "dismiss requires a reason category and
//   optional note." A signal a clinician waved away for a reason nobody
//   recorded is a signal the provider will raise again next week, and nobody
//   will know why it was wrong the first time.
//
// AND ONE ABOUT WHAT SURVIVES A RESOLUTION. §12: "resolution never deletes
// underlying evidence." Resolving sets a state; the evidence rows stay, so the
// same lineage can reopen against genuinely new evidence and still show what it
// rested on the first time.

import { repo, type TenantContext } from "../repository";
import { ulid } from "../ids";
import { appendEventSafe } from "../events";

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

interface SignalRow {
  id: string; person_id: string; signal_type: string; source_feature: string;
  dedupe_key: string; attention_band: string; statement: string;
  change_text: string | null; state: string; owner_person_id: string | null;
  due_at: string | null; first_detected_at: string; last_detected_at: string;
  evidence_at: string; policy_version: string; limitations_json: string;
  created_at: string; updated_at: string;
}

function toSignal(r: SignalRow): AttentionSignal {
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

function nowStamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listSignalsForPerson(
  ctx: TenantContext, personId: string, opts: { states?: SignalState[] } = {}
): Promise<AttentionSignal[]> {
  const states = opts.states ?? [...OPEN_STATES];
  const rows = await repo(ctx).findMany<SignalRow>(
    "clinical_attention_signals",
    `person_id = ? AND state IN (${states.map(() => "?").join(",")})`,
    [personId, ...states],
    { orderBy: "last_detected_at DESC, id ASC" }
  );
  return rows.map(toSignal);
}

/** Every open signal in the tenant. The queue filters by caseload; this does
 *  not, because who a clinician may see is the caseload model's decision and
 *  duplicating it here would be a second answer to the same question. */
export async function listOpenSignals(ctx: TenantContext): Promise<AttentionSignal[]> {
  const rows = await repo(ctx).findMany<SignalRow>(
    "clinical_attention_signals",
    `state IN (${OPEN_STATES.map(() => "?").join(",")})`,
    [...OPEN_STATES],
    { orderBy: "last_detected_at DESC, id ASC" }
  );
  return rows.map(toSignal);
}

export async function getSignal(
  ctx: TenantContext, id: string
): Promise<AttentionSignal | null> {
  const row = await repo(ctx).findOne<SignalRow>("clinical_attention_signals", "id = ?", [id]);
  return row ? toSignal(row) : null;
}

export async function evidenceForSignal(
  ctx: TenantContext, signalId: string
): Promise<SignalEvidence[]> {
  const rows = await repo(ctx).findMany<{
    evidence_type: string; evidence_id: string; rank: number;
  }>(
    "clinical_attention_signal_evidence", "signal_id = ?", [signalId],
    { orderBy: "rank ASC, evidence_id ASC" }
  );
  return rows.map((r) => ({ evidenceType: r.evidence_type, evidenceId: r.evidence_id, rank: r.rank }));
}

// ---------------------------------------------------------------------------
// Upsert: one lineage per concern (§12)
// ---------------------------------------------------------------------------

export interface UpsertResult {
  signal: AttentionSignal;
  /** What happened to the lineage. Returned rather than inferred, because the
   *  three outcomes emit three different events and a caller that had to guess
   *  would emit the wrong one. */
  outcome: "opened" | "updated" | "reopened" | "unchanged";
}

/**
 * Record what a provider observed, into one lineage.
 *
 * FOUR OUTCOMES, AND THE DISTINCTIONS MATTER.
 *
 *   OPENED — no row for this dedupe key. A new concern.
 *
 *   UPDATED — an open row whose evidence moved. §12: update the row and expose
 *   new-since-review. The band may rise or fall with the evidence, because the
 *   band is a fact about the current evidence and freezing it would leave a
 *   `review_now` standing after the thing that caused it resolved.
 *
 *   REOPENED — a resolved or dismissed row that the provider is raising again
 *   against NEWER evidence. §12: "resolved condition + genuinely new evidence →
 *   reopen lineage." Newer is checked here rather than trusted: re-running a
 *   provider over the same evidence must not reopen what a clinician closed,
 *   and that is the difference between a queue and a nag.
 *
 *   UNCHANGED — the same evidence again. No write, no event. A provider that
 *   runs hourly against a quiet record produces nothing, which is what keeps
 *   the ledger a history of the person rather than of the cron.
 *
 * A CLINICIAN'S STATE IS NEVER OVERWRITTEN BY AN UPDATE. An acknowledged signal
 * whose evidence moves stays acknowledged and gains `changeText`; the row shows
 * "new since your review" rather than silently becoming unread again.
 */
export async function upsertSignal(
  ctx: TenantContext,
  args: {
    personId: string;
    sourceFeature: string;
    candidate: AttentionSignalCandidate;
    ownerPersonId?: string | null;
    dueAt?: string | null;
  }
): Promise<UpsertResult> {
  const c = args.candidate;
  if (!c.statement.trim()) {
    throw new AttentionSignalError("A signal needs a statement a clinician can read.");
  }
  if (!(ATTENTION_BANDS as readonly string[]).includes(c.band)) {
    throw new AttentionSignalError(`Unknown attention band: ${c.band}`);
  }

  const r = repo(ctx);
  const existing = await r.findOne<SignalRow>(
    "clinical_attention_signals", "person_id = ? AND dedupe_key = ?", [args.personId, c.dedupeKey]
  );

  if (!existing) {
    const id = ulid();
    await r.insert("clinical_attention_signals", {
      id,
      person_id: args.personId,
      signal_type: c.type,
      source_feature: args.sourceFeature,
      dedupe_key: c.dedupeKey,
      attention_band: c.band,
      statement: c.statement,
      change_text: c.changeText ?? null,
      state: "open",
      owner_person_id: args.ownerPersonId ?? null,
      due_at: args.dueAt ?? null,
      first_detected_at: c.evidenceAt,
      last_detected_at: c.evidenceAt,
      evidence_at: c.evidenceAt,
      policy_version: c.policyVersion,
      limitations_json: JSON.stringify(c.limitations),
    });
    await writeEvidence(ctx, id, c);
    await recordSignalEvent(ctx, "attention_signal.opened", args.personId, id, c);
    return { signal: (await getSignal(ctx, id))!, outcome: "opened" };
  }

  const prior = toSignal(existing);
  const newerEvidence = c.evidenceAt > prior.evidenceAt;

  // The same evidence again. Nothing happened, so nothing is written.
  if (!newerEvidence && prior.band === c.band && prior.statement === c.statement) {
    return { signal: prior, outcome: "unchanged" };
  }

  const closed = prior.state === "resolved" || prior.state === "dismissed";
  if (closed && !newerEvidence) {
    // A closed concern re-detected on evidence the clinician already saw. §12
    // reopens on "genuinely new evidence"; this is not that.
    return { signal: prior, outcome: "unchanged" };
  }

  await r.update(
    "clinical_attention_signals",
    {
      attention_band: c.band,
      statement: c.statement,
      change_text: c.changeText ?? prior.changeText,
      // Reopening returns the lineage to `open`. An update to a live signal
      // leaves the clinician's own state alone.
      ...(closed ? { state: "open" } : {}),
      last_detected_at: c.evidenceAt,
      evidence_at: c.evidenceAt,
      policy_version: c.policyVersion,
      limitations_json: JSON.stringify(c.limitations),
      updated_at: nowStamp(),
    },
    "id = ?",
    [prior.id]
  );
  await writeEvidence(ctx, prior.id, c);
  const outcome = closed ? "reopened" : "updated";
  await recordSignalEvent(
    ctx,
    closed ? "attention_signal.reopened" : "attention_signal.updated",
    args.personId, prior.id, c
  );
  return { signal: (await getSignal(ctx, prior.id))!, outcome };
}

/** Evidence rows, replaced wholesale for the current evaluation.
 *
 *  Replaced rather than appended: the evidence list is what the CURRENT
 *  statement rests on, and accumulating every id a lineage ever touched would
 *  make "view evidence" open a pile that no longer supports the sentence above
 *  it. §12's "resolution never deletes underlying evidence" is about the source
 *  records, which are untouched — this is the pointer list. */
async function writeEvidence(
  ctx: TenantContext, signalId: string, c: AttentionSignalCandidate
): Promise<void> {
  const r = repo(ctx);
  await r.deleteWhere("clinical_attention_signal_evidence", "signal_id = ?", [signalId]);
  let rank = 0;
  for (const evidenceId of c.evidenceIds) {
    await r.insert("clinical_attention_signal_evidence", {
      signal_id: signalId,
      evidence_type: c.evidenceType ?? "unspecified",
      evidence_id: evidenceId,
      rank: rank++,
    });
  }
}

/** The ledger entry for a detection. Carries ids, bands, versions and counts —
 *  never the statement, which is patient-scoped clinical text and lives on the
 *  row a scoped reader can open (§18). */
async function recordSignalEvent(
  ctx: TenantContext,
  type: "attention_signal.opened" | "attention_signal.updated" | "attention_signal.reopened",
  personId: string, signalId: string, c: AttentionSignalCandidate
): Promise<void> {
  await appendEventSafe({
    personId,
    tenantId: ctx.tenantId,
    type,
    actorId: null,
    // A provider is deterministic machinery, not a model and not a person.
    actorType: "system",
    occurredAt: c.evidenceAt,
    payload: {
      signalId,
      signalType: c.type,
      dedupeKey: c.dedupeKey,
      band: c.band,
      evidenceCount: c.evidenceIds.length,
      policyVersion: c.policyVersion,
    },
    provenance: { ruleVersion: c.policyVersion, evidenceIds: c.evidenceIds },
  });
}

/**
 * Withdraw open signals whose condition no longer holds.
 *
 * THE MISSING HALF OF A PROVIDER'S CONTRACT, and its absence is invisible: a
 * person who stopped checking in for three weeks and then started again keeps
 * an "engagement gap" row forever, because nothing ever asked the provider
 * whether it still meant it. The queue slowly fills with concerns that were
 * true once, and a clinician learns that the rows are not current.
 *
 * §20 names the rule for the case where the evidence goes away: "keep row only
 * if remaining authorized evidence supports it; otherwise update/withdraw per
 * provider policy." This is that withdrawal.
 *
 * ONLY FOR PROVIDERS THAT ACTUALLY RAN. `ranProviders` is the list, and passing
 * it is not a convenience — a provider that THREW has not said anything about
 * its signals, and treating its silence as "the condition cleared" would let one
 * failing provider quietly resolve every concern it owns. That is the §20
 * partial-coverage trap from the other direction, and it fails silently in the
 * dangerous direction.
 *
 * A WITHDRAWAL IS NOT A CLINICIAN'S RESOLUTION. The state is `resolved` because
 * that is the vocabulary, but the event says the provider withdrew it and
 * carries no clinician id — so an audit can always tell a concern somebody
 * decided about from one that simply stopped being true.
 */
export async function withdrawStaleSignals(
  ctx: TenantContext,
  args: {
    personId: string;
    /** Providers whose evaluation completed. A provider that failed is absent,
     *  and its signals are left exactly as they were. */
    ranProviders: string[];
    /** The dedupe keys those providers emitted this time. */
    stillPresent: Set<string>;
    evidenceAt: string;
  }
): Promise<string[]> {
  if (args.ranProviders.length === 0) return [];
  const ran = new Set(args.ranProviders);
  const open = await listSignalsForPerson(ctx, args.personId);
  const withdrawn: string[] = [];

  for (const signal of open) {
    if (!ran.has(signal.sourceFeature)) continue;
    if (args.stillPresent.has(signal.dedupeKey)) continue;

    await repo(ctx).update(
      "clinical_attention_signals",
      {
        state: "resolved",
        change_text: "No longer observed in the current evidence.",
        updated_at: nowStamp(),
      },
      "id = ?", [signal.id]
    );
    await appendEventSafe({
      personId: args.personId,
      tenantId: ctx.tenantId,
      type: "attention_signal.state_changed",
      // NO ACTOR. Nobody decided this; the condition stopped holding. An
      // actorId here would put a clinician's name on a judgement they never
      // made.
      actorId: null,
      actorType: "system",
      occurredAt: args.evidenceAt,
      payload: {
        signalId: signal.id,
        from: signal.state,
        to: "resolved",
        withdrawnByProvider: signal.sourceFeature,
        dismissReason: null,
        note: null,
        evidenceAt: args.evidenceAt,
        sourceSurface: "provider_reconciliation",
      },
    });
    withdrawn.push(signal.id);
  }
  return withdrawn;
}

// ---------------------------------------------------------------------------
// Lifecycle (§12)
// ---------------------------------------------------------------------------

/**
 * A clinician explicitly reviewed this without resolving it.
 *
 * TAKES A CLINICIAN ID, which is the whole guarantee. §12: "opening a row or
 * drawer does not silently acknowledge it." There is no acknowledgement path
 * that a page render could reach, because every path needs somebody's id.
 */
export async function acknowledgeSignal(
  ctx: TenantContext,
  args: { signalId: string; clinicianId: string; sourceSurface: string }
): Promise<AttentionSignal> {
  const signal = await getSignal(ctx, args.signalId);
  if (!signal) throw new AttentionSignalError("No such attention signal.");

  await repo(ctx).update(
    "clinical_attention_signals",
    { state: "acknowledged", updated_at: nowStamp() },
    "id = ?", [args.signalId]
  );
  await appendEventSafe({
    personId: signal.personId,
    tenantId: ctx.tenantId,
    type: "attention_signal.acknowledged",
    actorId: args.clinicianId,
    actorType: "clinician",
    payload: {
      signalId: args.signalId,
      // §12: acknowledgement records "clinician, timestamp, evidence
      // version/cutoff, and source surface". The cutoff is what makes a later
      // "new since your review" answerable.
      evidenceAt: signal.evidenceAt,
      policyVersion: signal.policyVersion,
      sourceSurface: args.sourceSurface,
    },
  });
  return (await getSignal(ctx, args.signalId))!;
}

/**
 * Move a signal to a waiting, resolved or dismissed state.
 *
 * A DISMISSAL WITHOUT A REASON IS REFUSED. §12 requires a reason category, and
 * refusing here rather than defaulting one is what makes the count of
 * "dismissed because the evidence looked wrong" a number worth reading — a
 * default would fill it with whatever the first option happened to be.
 *
 * A waiting state must name its dependency, for the same kind of reason: §2's
 * display rule is that "patient silence is not noncompliance", and a waiting
 * row that cannot say what it is waiting for reads as one.
 */
export async function setSignalState(
  ctx: TenantContext,
  args: {
    signalId: string;
    clinicianId: string;
    state: Exclude<SignalState, "open" | "acknowledged">;
    dismissReason?: DismissReason;
    dependency?: string;
    note?: string | null;
    dueAt?: string | null;
    sourceSurface: string;
  }
): Promise<AttentionSignal> {
  const signal = await getSignal(ctx, args.signalId);
  if (!signal) throw new AttentionSignalError("No such attention signal.");

  if (args.state === "dismissed" && !args.dismissReason) {
    throw new AttentionSignalError("Dismissing a signal needs a reason.");
  }
  if (
    (args.state === "waiting_member" || args.state === "waiting_staff") &&
    !args.dependency?.trim()
  ) {
    throw new AttentionSignalError("A waiting signal needs to say what it is waiting for.");
  }

  await repo(ctx).update(
    "clinical_attention_signals",
    {
      state: args.state,
      // The dependency becomes the visible change text, so the row explains
      // itself without the clinician opening it.
      ...(args.dependency ? { change_text: args.dependency.trim() } : {}),
      ...(args.dueAt !== undefined ? { due_at: args.dueAt } : {}),
      updated_at: nowStamp(),
    },
    "id = ?", [args.signalId]
  );
  await appendEventSafe({
    personId: signal.personId,
    tenantId: ctx.tenantId,
    type: "attention_signal.state_changed",
    actorId: args.clinicianId,
    actorType: "clinician",
    payload: {
      signalId: args.signalId,
      from: signal.state,
      to: args.state,
      dismissReason: args.dismissReason ?? null,
      // The note is a clinician's own words about their own decision, not
      // patient content, and the decision is not reconstructable without it.
      note: args.note ?? null,
      evidenceAt: signal.evidenceAt,
      sourceSurface: args.sourceSurface,
    },
  });
  return (await getSignal(ctx, args.signalId))!;
}

// ---------------------------------------------------------------------------
// The care-time ledger (§13)
// ---------------------------------------------------------------------------

/** §13's action vocabulary. Closed, because an action type nobody defined is
 *  an action nobody can count or audit. */
export const CARE_ACTIONS = [
  "review", "contact", "add_followup", "record_thought",
  "open_session_prep", "review_trajectory", "adjust_plan_link", "resolve",
] as const;
export type CareAction = (typeof CARE_ACTIONS)[number];

/**
 * Record that a clinician did something between visits.
 *
 * DURATION IS ONLY EVER PASSED IN, never measured here. §13: "do not count
 * passive browser-open time as clinical work." A module that could read a clock
 * at both ends would eventually be asked to, and the resulting number would be
 * how long a tab was open — which is the one number that must not end up in a
 * staffing or reimbursement conversation.
 *
 * There is no billable flag anywhere in this path, also per §13: "do not mark
 * time billable from Steady alone."
 */
export async function recordCareAction(
  ctx: TenantContext,
  args: {
    personId: string;
    clinicianId: string;
    action: CareAction;
    signalId?: string | null;
    note?: string | null;
    startedAt?: string | null;
    durationSeconds?: number | null;
    outcomeState?: string | null;
    sourceSurface: string;
  }
): Promise<string> {
  if (!(CARE_ACTIONS as readonly string[]).includes(args.action)) {
    throw new AttentionSignalError(`Unknown care action: ${args.action}`);
  }
  const id = ulid();
  const completedAt = nowStamp();
  await repo(ctx).insert("between_visit_care_actions", {
    id,
    person_id: args.personId,
    clinician_person_id: args.clinicianId,
    signal_id: args.signalId ?? null,
    action_type: args.action,
    note: args.note ?? null,
    started_at: args.startedAt ?? null,
    completed_at: completedAt,
    // Null unless the caller bounded it explicitly. Absent duration is absent,
    // not zero and not inferred.
    duration_seconds: args.durationSeconds ?? null,
    outcome_state: args.outcomeState ?? null,
    source_surface: args.sourceSurface,
  });
  await appendEventSafe({
    personId: args.personId,
    tenantId: ctx.tenantId,
    type: "between_visit_care.action_recorded",
    actorId: args.clinicianId,
    actorType: "clinician",
    payload: {
      actionId: id,
      actionType: args.action,
      signalId: args.signalId ?? null,
      durationSeconds: args.durationSeconds ?? null,
      outcomeState: args.outcomeState ?? null,
      sourceSurface: args.sourceSurface,
    },
  });
  return id;
}

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
}

export async function careActionsForPerson(
  ctx: TenantContext, personId: string, limit = 25
): Promise<CareActionRecord[]> {
  const rows = await repo(ctx).findMany<{
    id: string; person_id: string; clinician_person_id: string; signal_id: string | null;
    action_type: string; note: string | null; started_at: string | null;
    completed_at: string; duration_seconds: number | null; outcome_state: string | null;
    source_surface: string;
  }>(
    "between_visit_care_actions", "person_id = ?", [personId],
    { orderBy: "completed_at DESC, id DESC", limit }
  );
  return rows.map((r) => ({
    id: r.id,
    personId: r.person_id,
    clinicianPersonId: r.clinician_person_id,
    signalId: r.signal_id,
    action: r.action_type as CareAction,
    note: r.note,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    durationSeconds: r.duration_seconds,
    outcomeState: r.outcome_state,
    sourceSurface: r.source_surface,
  }));
}
