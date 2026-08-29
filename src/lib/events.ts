// The longitudinal event spine (ADR 0010).
//
// `longitudinal_events` is the authoritative history. Current-state tables
// (checkins, therapy_sessions, …) become projections rebuilt from it. This
// module owns the append path and the type registry.
//
// Two rules the registry exists to enforce:
//
//   1. Event types are modelled against the A→E domain chain — Person → State
//      → Signal → Assessment → Need → Risk → Intervention → Response → Clinical
//      Action → … — NOT against current UI actions. UI changes; the chain does
//      not. Getting this granularity wrong is expensive to correct later, which
//      is why the catalog is explicit rather than free-form strings.
//
//   2. Payloads are versioned. A payload shape is permanent in a way a column
//      never was: old events must stay readable after the shape evolves, so the
//      version travels with the row and readers switch on it.
//
// Events are immutable. A correction appends a new event referencing the one it
// supersedes; nothing is updated or deleted.

import { data } from "./data";
import { ulid } from "./ids";
import { PLATFORM_TENANT_ID } from "./db";

// ---------- Type catalog ----------

// Version 2 marks the payloads that carry a `projectionId` — the primary key of
// the current-state row the event produces. Step 4 (rebuilding projections from
// events) is what forced it: without the key, a rebuild invents new ids and the
// result can never be byte-identical to the incremental path. See PROJECTORS in
// projections.ts for which key each type carries.
export const EVENT_TYPES = {
  // Identity / consent
  "person.registered": 1,
  "consent.granted": 2,
  "consent.withdrawn": 2,

  // State and measurement
  "daily_checkin.completed": 2,
  "assessment.scored": 1,
  "readiness.recalculated": 1,

  // Care / intervention
  "intervention.assigned": 1,
  "intervention.completed": 2,
  "intervention.response_recorded": 1,
  "session.started": 2,
  "session.completed": 2,
  "session.hard_stopped": 2,
  "lesson.read": 2,

  // AI / memory
  "memory.recorded": 1,
  "memory.patient_corrected": 1,
  "inference.produced": 1,

  // Safety
  "safety_rule.triggered": 1,
  "safety_state.changed": 1,
  "crisis.routed": 1,

  // Access pathway (Web GUI handoff §26's organization atlas, §29's access
  // funnel). These are operational rather than clinical: they record a
  // population's movement from referral to care start, which is what an
  // organization is accountable for and what no existing event type carried.
  //
  // Each is a discrete, dated fact about one person, so the funnel on
  // /organization/access is COUNTED from the ledger rather than stored as four
  // numbers. That matters: §29.1 requires a denominator beside every
  // numerator, and a stored percentage has neither.
  "referral.received": 1,
  "contact.attempted": 1,
  "contact.made": 1,
  "visit.scheduled": 1,
  "care.started": 1,
  // The observed status of a cohort member at the end of a window. NOT a
  // prediction and not a score: §29.1 forbids a predictive risk score outright,
  // and this records what was measured, including that nothing was.
  "outcome.classified": 1,
  // Operational facts about a COVERED POPULATION, arriving from an integration
  // feed rather than from someone using Steady.
  //
  // These deliberately do not reuse "assessment.scored", "session.completed"
  // or "clinician.reviewed". Those are clinical events: each one asserts that
  // a current-state row exists and carries the projectionId that identifies
  // it, so the ledger can be replayed back into that row. A covered life
  // ingested from an eligibility file has no such row — writing a clinical
  // event for one produces an event that claims a record it cannot rebuild,
  // which is exactly what the replay guard caught when this seed first used
  // them.
  //
  // So these are their own types with no projector: countable, never
  // replayable into a person's record, and impossible to confuse with the
  // clinical event of the same name.
  "coverage.measure_recorded": 1,
  "coverage.session_delivered": 1,
  "coverage.reviewed": 1,
  "coverage.gate_recorded": 1,
  "coverage.gate_responded": 1,

  // Missingness, recorded rather than inferred (handoff 07 §2.7, p28).
  //
  // "Create missingness intentionally and record why the value is absent: not
  // due, skipped, declined, interrupted, failed or unavailable."
  //
  // A measure that was never taken and one that was DECLINED look identical in
  // a table, and only the second is a fact about the person. §29.1 requires
  // missing, incomplete, late, rejected and suppressed data to stay visible,
  // and it can only stay visible if it was written down.
  //
  // No projector: there is no current-state row for a thing that did not
  // happen. That is the distinction the coverage.* types were introduced for.
  "measure.not_completed": 1,

  // Clinical action
  "clinician.reviewed": 1,
  "module_unlock.requested": 2,
  "module_unlock.decided": 2,
} as const;

export type EventType = keyof typeof EVENT_TYPES;
export type ActorType =
  | "patient" | "clinician" | "care_manager" | "system" | "model" | "integration";

export function isEventType(t: string): t is EventType {
  return Object.prototype.hasOwnProperty.call(EVENT_TYPES, t);
}

/** Current payload version for a type. Readers switch on the stored version;
 *  writers always use the current one. */
export function currentPayloadVersion(t: EventType): number {
  return EVENT_TYPES[t];
}

// ---------- Provenance ----------

/** Attached to every event so an inference can be reconstructed later: which
 *  rule, which model, which prompt, and what evidence it rested on (ADR 0012,
 *  Handoff D5). Free-form beyond these keys, but these are the ones the
 *  Learning Ledger asks for. */
export interface Provenance {
  ruleVersion?: string;
  modelVersion?: string;
  promptVersion?: string;
  evidenceIds?: string[];
  [k: string]: unknown;
}

export interface AppendEventArgs {
  personId: string;
  type: EventType;
  payload?: Record<string, unknown>;
  /** Who caused it. Defaults to the person themselves. */
  actorId?: string | null;
  actorType?: ActorType;
  /** When it happened in the world. Defaults to now. Differs from recorded_at
   *  for anything ingested from an external system. */
  occurredAt?: string;
  tenantId?: string;
  sourceSystem?: string;
  provenance?: Provenance;
  /** Ties one user action to every downstream effect. */
  correlationId?: string | null;
  /** The event this one corrects. Corrections append; they never mutate. */
  supersedesEventId?: string | null;
}

export interface LongitudinalEvent {
  id: string;
  tenant_id: string;
  person_id: string;
  event_type: EventType;
  payload_version: number;
  payload: Record<string, unknown>;
  actor_id: string | null;
  actor_type: ActorType;
  occurred_at: string;
  recorded_at: string;
  source_system: string;
  provenance: Provenance;
  correlation_id: string | null;
  supersedes_event_id: string | null;
}

// ---------- Append ----------

/** Append one event. Returns its id (a ULID, so lexical order == append order).
 *
 *  Throws on an unregistered type: an unknown event type is a programming
 *  error, and silently accepting it would put an unreadable row into permanent
 *  history. */
export async function appendEvent(args: AppendEventArgs): Promise<string> {
  if (!isEventType(args.type)) {
    throw new Error(`Unregistered event type: ${String(args.type)}`);
  }
  const id = ulid();
  const c = await data();
  await c.run(
    `INSERT INTO longitudinal_events
       (id, tenant_id, person_id, event_type, payload_version, payload,
        actor_id, actor_type, occurred_at, source_system, provenance,
        correlation_id, supersedes_event_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?, ?, ?, ?)`,
    [
      id,
      args.tenantId ?? PLATFORM_TENANT_ID,
      args.personId,
      args.type,
      currentPayloadVersion(args.type),
      JSON.stringify(args.payload ?? {}),
      args.actorId === undefined ? args.personId : args.actorId,
      args.actorType ?? "patient",
      args.occurredAt ?? null,
      args.sourceSystem ?? "steady",
      JSON.stringify(args.provenance ?? {}),
      args.correlationId ?? null,
      args.supersedesEventId ?? null,
    ]
  );
  return id;
}

/** Best-effort append. Used at dual-write call sites during the migration so a
 *  spine failure can never break a working product path. Once the spine is
 *  authoritative this is removed in favour of appendEvent. */
export async function appendEventSafe(args: AppendEventArgs): Promise<string | null> {
  try {
    return await appendEvent(args);
  } catch (err) {
    console.error("longitudinal event append failed (non-fatal during dual-write):", err);
    return null;
  }
}

// ---------- Read ----------

interface RawRow {
  id: string; tenant_id: string; person_id: string; event_type: string;
  payload_version: number; payload: string; actor_id: string | null;
  actor_type: string; occurred_at: string; recorded_at: string;
  source_system: string; provenance: string; correlation_id: string | null;
  supersedes_event_id: string | null;
}

function hydrate(r: RawRow): LongitudinalEvent {
  const parse = (s: string) => {
    try { return JSON.parse(s) as Record<string, unknown>; } catch { return {}; }
  };
  return {
    ...r,
    event_type: r.event_type as EventType,
    actor_type: r.actor_type as ActorType,
    payload: parse(r.payload),
    provenance: parse(r.provenance) as Provenance,
  };
}

export interface ReadEventsFilter {
  personId?: string;
  tenantId?: string;
  types?: EventType[];
  /** Exclusive lower bound on event id — ULIDs sort by creation, so this is
   *  "everything after". */
  afterId?: string;
  /** Only events the system knew about at this instant. This is what makes a
   *  prediction reconstructable without future-data leakage (Handoff D4/D6). */
  asOf?: string;
  limit?: number;
}

/** Read events in append order. */
export async function readEvents(f: ReadEventsFilter = {}): Promise<LongitudinalEvent[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.personId) { where.push("person_id = ?"); params.push(f.personId); }
  if (f.tenantId) { where.push("tenant_id = ?"); params.push(f.tenantId); }
  if (f.afterId) { where.push("id > ?"); params.push(f.afterId); }
  if (f.asOf) { where.push("recorded_at <= ?"); params.push(f.asOf); }
  if (f.types && f.types.length > 0) {
    where.push(`event_type IN (${f.types.map(() => "?").join(",")})`);
    params.push(...f.types);
  }
  const sql =
    `SELECT * FROM longitudinal_events${where.length ? ` WHERE ${where.join(" AND ")}` : ""}` +
    ` ORDER BY id${f.limit ? " LIMIT ?" : ""}`;
  if (f.limit) params.push(f.limit);
  const c = await data();
  return ((await c.all(sql, params)) as RawRow[]).map(hydrate);
}

/** Everything the system knew about a person at a given instant — the input to
 *  any point-in-time reconstruction. */
export async function readEventsAsOf(personId: string, asOf: string): Promise<LongitudinalEvent[]> {
  return readEvents({ personId, asOf });
}

export async function eventCount(personId?: string): Promise<number> {
  const c = await data();
  const row = (await c.get(
    `SELECT COUNT(*) AS n FROM longitudinal_events${personId ? " WHERE person_id = ?" : ""}`,
    personId ? [personId] : []
  )) as { n: number };
  return Number(row?.n ?? 0);
}
