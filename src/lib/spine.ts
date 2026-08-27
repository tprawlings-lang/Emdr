// Dual-write to the longitudinal spine (ADR 0010 step 2).
//
// Every existing mutation keeps writing its current-state table exactly as it
// does today, and additionally appends an event here. Both paths stay active
// until reads move to projections; nothing depends on events yet.
//
// Why this module exists rather than inlining appends at each call site: the
// check-in, screening, and session writes are duplicated between the web path
// (lib/actions.ts) and the mobile path (lib/mobile/*.ts). Instrumenting each
// separately would double that duplication and let the two event streams drift
// — the same change applied to one path and not the other would silently
// produce different history for web and mobile members. The event *shape*
// therefore lives here, once, and both call sites invoke the same recorder.
//
// Every recorder is best-effort (appendEventSafe): during dual-write a spine
// failure must never break a working product path.

import { appendEventSafe, type Provenance } from "./events";
import { data } from "./data";
import { ulid } from "./ids";
import { PLATFORM_TENANT_ID } from "./db";

// ---------- Identity dual-write ----------

/** Mirror a newly-created user onto the identity spine.
 *
 *  A PREREQUISITE for event dual-write, not an optional extra:
 *  `longitudinal_events.person_id` references `persons(id)`, so a user created
 *  since the last boot would have no person row and every append for them would
 *  fail the foreign key. The boot-time backfill only reconciles users that
 *  already existed.
 *
 *  `persons.id` is set equal to the user id (ADR 0011 refinement), so existing
 *  `user_id` values remain valid person references. */
export async function provisionPerson(args: {
  userId: string;
  name: string;
  email: string;
  role: "member" | "clinician" | "admin";
  passwordHash?: string | null;
  tenantId?: string;
}): Promise<void> {
  const tenantId = args.tenantId ?? PLATFORM_TENANT_ID;
  try {
    const c = await data();
    await c.run(
      `INSERT INTO persons (id, tenant_id, display_name) VALUES (?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
      [args.userId, tenantId, args.name]
    );
    await c.run(
      `INSERT INTO accounts (id, person_id, tenant_id, email, password_hash)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING`,
      [ulid(), args.userId, tenantId, args.email, args.passwordHash ?? null]
    );
    await c.run(
      `INSERT INTO role_assignments (id, person_id, tenant_id, role) VALUES (?, ?, ?, ?)
       ON CONFLICT(person_id, tenant_id, role) DO NOTHING`,
      [ulid(), args.userId, tenantId, args.role]
    );
    await appendEventSafe({
      personId: args.userId,
      tenantId,
      type: "person.registered",
      payload: { role: args.role },
      actorType: "patient",
    });
  } catch (err) {
    console.error("identity spine provisioning failed (non-fatal during dual-write):", err);
  }
}

// ---------- State and measurement ----------

export async function recordCheckin(args: {
  userId: string;
  checkinDate: string;
  activation: number;
  shutdown: number;
  dissociation: number;
  sleepQuality: number;
  harmUrge: boolean;
  feelsSafe: boolean;
  substanceFlag: boolean;
  recommendedAction: string;
  triggerIds?: string[];
  via?: "web" | "mobile";
}): Promise<void> {
  await appendEventSafe({
    personId: args.userId,
    type: "daily_checkin.completed",
    occurredAt: undefined,
    payload: {
      checkinDate: args.checkinDate,
      activation: args.activation,
      shutdown: args.shutdown,
      dissociation: args.dissociation,
      sleepQuality: args.sleepQuality,
      harmUrge: args.harmUrge,
      feelsSafe: args.feelsSafe,
      substanceFlag: args.substanceFlag,
      recommendedAction: args.recommendedAction,
      triggerIds: args.triggerIds ?? [],
      via: args.via ?? "web",
    },
    actorType: "patient",
    provenance: { ruleVersion: "checkin-routing-v1" },
  });
}

export async function recordAssessment(args: {
  userId: string;
  instrument: string;
  instrumentVersion: string;
  totalScore: number;
  riskFlags?: string[];
  context?: string;
  via?: "web" | "mobile";
}): Promise<void> {
  // Scores and coded risk flags only — never the raw item responses, which
  // stay encrypted in `screenings` under the existing governance zone.
  await appendEventSafe({
    personId: args.userId,
    type: "assessment.scored",
    payload: {
      instrument: args.instrument,
      instrumentVersion: args.instrumentVersion,
      totalScore: args.totalScore,
      riskFlags: args.riskFlags ?? [],
      context: args.context ?? null,
      via: args.via ?? "web",
    },
    actorType: "patient",
    provenance: { ruleVersion: `${args.instrument}:${args.instrumentVersion}` },
  });
}

// ---------- Care and intervention ----------

export async function recordSessionStarted(args: {
  userId: string;
  sessionId: string;
  moduleId: string;
  focus?: string | null;
  via?: "web" | "mobile";
}): Promise<void> {
  await appendEventSafe({
    personId: args.userId,
    type: "session.started",
    payload: {
      sessionId: args.sessionId,
      moduleId: args.moduleId,
      focus: args.focus ?? null,
      via: args.via ?? "web",
    },
    actorType: "patient",
    correlationId: args.sessionId,
  });
}

export async function recordSessionFinished(args: {
  userId: string;
  sessionId: string;
  moduleId?: string | null;
  status: string;
  preSuds?: number | null;
  postSuds?: number | null;
  peakSuds?: number | null;
  hardStopReason?: string | null;
  via?: "web" | "mobile";
}): Promise<void> {
  const hardStopped = args.status === "hard_stop";
  await appendEventSafe({
    personId: args.userId,
    type: hardStopped ? "session.hard_stopped" : "session.completed",
    payload: {
      sessionId: args.sessionId,
      moduleId: args.moduleId ?? null,
      status: args.status,
      preSuds: args.preSuds ?? null,
      postSuds: args.postSuds ?? null,
      peakSuds: args.peakSuds ?? null,
      hardStopReason: args.hardStopReason ?? null,
      via: args.via ?? "web",
    },
    actorType: "patient",
    correlationId: args.sessionId,
    provenance: { ruleVersion: "session-safety-v1" },
  });
}

/** A completed practice — Handoff B2 learns intervention→response from these,
 *  which is why the exact intervention version is carried. */
export async function recordInterventionCompleted(args: {
  userId: string;
  interventionId: string;
  interventionType: string;
  interventionVersion?: string;
  durationSec: number;
}): Promise<void> {
  await appendEventSafe({
    personId: args.userId,
    type: "intervention.completed",
    payload: {
      interventionId: args.interventionId,
      interventionType: args.interventionType,
      // Interventions are not yet versioned (ADR 0012 conflict 6). Recording
      // the placeholder now means the field exists in history from the start
      // rather than appearing mid-stream.
      interventionVersion: args.interventionVersion ?? "unversioned",
      durationSec: args.durationSec,
    },
    actorType: "patient",
  });
}

export async function recordLessonRead(args: {
  userId: string;
  lessonId: string;
}): Promise<void> {
  await appendEventSafe({
    personId: args.userId,
    type: "lesson.read",
    payload: { lessonId: args.lessonId },
    actorType: "patient",
  });
}

// ---------- AI and memory ----------

export async function recordMemoryWritten(args: {
  userId: string;
  memoryType: string;
  key: string;
  source: string;
  corrected?: boolean;
  provenance?: Provenance;
}): Promise<void> {
  // Key and type only — the value stays encrypted in `ai_memory_items`. The
  // event records THAT something was remembered and where it came from, which
  // is what provenance needs; the content lives in its own governance zone.
  await appendEventSafe({
    personId: args.userId,
    type: args.corrected ? "memory.patient_corrected" : "memory.recorded",
    payload: { memoryType: args.memoryType, key: args.key, source: args.source },
    actorType: args.source === "user_message" ? "patient" : "system",
    provenance: args.provenance,
  });
}

// ---------- Consent and clinical action ----------

export async function recordConsent(args: {
  userId: string;
  policyVersion: string;
  scope: string;
  granted: boolean;
}): Promise<void> {
  await appendEventSafe({
    personId: args.userId,
    type: args.granted ? "consent.granted" : "consent.withdrawn",
    payload: { policyVersion: args.policyVersion, scope: args.scope },
    actorType: "patient",
  });
}

export async function recordUnlockDecision(args: {
  personId: string;
  moduleId: string;
  decision: string;
  clinicianId: string;
  isOverride?: boolean;
}): Promise<void> {
  await appendEventSafe({
    personId: args.personId,
    type: "module_unlock.decided",
    payload: {
      moduleId: args.moduleId,
      decision: args.decision,
      override: args.isOverride ?? false,
    },
    actorId: args.clinicianId,
    actorType: "clinician",
  });
}
