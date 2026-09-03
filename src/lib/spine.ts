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
import type { Role } from "./roles";
import { data } from "./data";
import { ulid } from "./ids";
import { PLATFORM_TENANT_ID, newId } from "./db";
import { CHECKIN_ROUTING_VERSION } from "./gating";

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
  role: Role;
  passwordHash?: string | null;
  tenantId?: string;
}): Promise<void> {
  const tenantId = args.tenantId ?? PLATFORM_TENANT_ID;
  try {
    const c = await data();
    await c.run(
      // REAL. This is the signup path: a human filled in a form. The
      // distinction the provenance column draws is generated-by-the-system
      // versus originated-by-a-person, not demo versus production — somebody
      // exploring a demonstration is still a person, and their data must never
      // be poolable with a synthetic agent's.
      `INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, ?, 'real')
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

/** 'YYYY-MM-DD HH:MM:SS' UTC — the format both backends store.
 *
 *  Instrumented writes compute the timestamp ONCE in JS and pass the same value
 *  to the current-state row and to its event, rather than letting each take its
 *  own `CURRENT_TIMESTAMP`. Two clock reads microseconds apart normally agree,
 *  and occasionally straddle a second boundary — which would make a replay
 *  differ from the live row for no reason anyone could reproduce. It also keeps
 *  these writes free of backend-specific date functions, which is what
 *  lib/data.ts asks of every query. */
export function nowStamp(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

/** The id an upsert-keyed write will end up under: the existing row's, or a
 *  fresh one.
 *
 *  Needed because several current-state writes are upserts — a second check-in
 *  the same day, or a re-read of a lesson, updates the row already there and
 *  keeps its original id. Generating an id inline in the INSERT and passing
 *  that same value to the recorder therefore names a row that does not exist,
 *  and the projection rebuild produces a duplicate instead of the update. Both
 *  the web and mobile paths call this, so the two cannot drift apart on it. */
export async function upsertRowId(
  table: string, where: string, params: unknown[]
): Promise<string> {
  const c = await data();
  const row = (await c.get(`SELECT id FROM ${table} WHERE ${where}`, params)) as
    | { id: string }
    | undefined;
  return row?.id ?? newId();
}

// ---------- State and measurement ----------

export async function recordCheckin(args: {
  userId: string;
  /** Primary key of the `checkins` row this event produces. Required so the
   *  projection rebuild reproduces the same row rather than inventing an id.
   *  For the repeat check-in of a day this is the id of the row already there —
   *  the write is an upsert, so the original id survives and the event must say
   *  so. */
  checkinId: string;
  /** Timestamp shared with the `checkins` row, so a replay matches it exactly. */
  occurredAt?: string;
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
    occurredAt: args.occurredAt,
    payload: {
      projectionId: args.checkinId,
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
    provenance: { ruleVersion: CHECKIN_ROUTING_VERSION },
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
  occurredAt?: string;
  via?: "web" | "mobile";
}): Promise<void> {
  await appendEventSafe({
    personId: args.userId,
    type: "session.started",
    occurredAt: args.occurredAt,
    payload: {
      // therapy_sessions.id IS the session id, so it doubles as the projection
      // key; it is named explicitly all the same, so every v2 projector reads
      // the same field.
      projectionId: args.sessionId,
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
  /** The session's merged `detail_json` at completion. Carried because it is
   *  written at both start and finish and is otherwise unrecoverable from
   *  events — a rebuild would leave it at the column default. */
  detail?: Record<string, unknown> | null;
  occurredAt?: string;
  via?: "web" | "mobile";
}): Promise<void> {
  const hardStopped = args.status === "hard_stop";
  await appendEventSafe({
    personId: args.userId,
    type: hardStopped ? "session.hard_stopped" : "session.completed",
    occurredAt: args.occurredAt,
    payload: {
      projectionId: args.sessionId,
      detail: args.detail ?? null,
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
  /** Primary key of the `practice_completions` row. */
  completionId: string;
  interventionId: string;
  interventionType: string;
  interventionVersion?: string;
  durationSec: number;
  occurredAt?: string;
}): Promise<void> {
  await appendEventSafe({
    personId: args.userId,
    type: "intervention.completed",
    occurredAt: args.occurredAt,
    payload: {
      projectionId: args.completionId,
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
  /** Primary key of the `lesson_reads` row. The write is idempotent per
   *  (user, lesson), so on a re-read this is the id already stored. */
  readId: string;
  lessonId: string;
  occurredAt?: string;
}): Promise<void> {
  await appendEventSafe({
    personId: args.userId,
    type: "lesson.read",
    occurredAt: args.occurredAt,
    payload: { projectionId: args.readId, lessonId: args.lessonId },
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

/** Grant a consent: write the row AND record the event, in one call.
 *
 *  Consent was being written at seven different places — signup (twice), the
 *  web care-program page, the mobile onboarding path, voice consent on web and
 *  on mobile, and processing consent — of which only two recorded an event. The
 *  rest wrote history the spine never saw, and a replay of `consents` was
 *  therefore missing rows. Rather than instrument seven sites and rely on the
 *  eighth remembering, the write and the event live together here and every
 *  site calls this.
 *
 *  Returns the consent row's id. */
export async function grantConsent(args: {
  userId: string;
  policyVersion: string;
  scope: string;
  /** Skip if an unrevoked grant for this scope already exists. */
  onlyIfInactive?: boolean;
}): Promise<string | null> {
  const c = await data();
  if (args.onlyIfInactive) {
    const active = await c.get(
      "SELECT id FROM consents WHERE user_id = ? AND scope = ? AND revoked_at IS NULL LIMIT 1",
      [args.userId, args.scope]
    );
    if (active) return (active as { id: string }).id;
  }
  const id = newId();
  const at = nowStamp();
  await c.run(
    "INSERT INTO consents (id, user_id, policy_version, scope, granted_at) VALUES (?, ?, ?, ?, ?)",
    [id, args.userId, args.policyVersion, args.scope, at]
  );
  await recordConsent({
    userId: args.userId, consentId: id, policyVersion: args.policyVersion,
    scope: args.scope, granted: true, occurredAt: at,
  });
  return id;
}

/** Withdraw every active consent for a scope, recording one event per row
 *  revoked — a withdrawal closes a specific grant, and the projection needs to
 *  know which. */
export async function withdrawConsent(args: {
  userId: string;
  scope: string;
}): Promise<number> {
  const c = await data();
  const active = (await c.all(
    "SELECT id, policy_version FROM consents WHERE user_id = ? AND scope = ? AND revoked_at IS NULL",
    [args.userId, args.scope]
  )) as { id: string; policy_version: string }[];
  if (active.length === 0) return 0;

  const at = nowStamp();
  await c.run(
    "UPDATE consents SET revoked_at = ? WHERE user_id = ? AND scope = ? AND revoked_at IS NULL",
    [at, args.userId, args.scope]
  );
  for (const row of active) {
    await recordConsent({
      userId: args.userId, consentId: row.id, policyVersion: row.policy_version,
      scope: args.scope, granted: false, occurredAt: at,
    });
  }
  return active.length;
}

export async function recordConsent(args: {
  userId: string;
  occurredAt?: string;
  /** Primary key of the `consents` row. On withdrawal this is the id of the row
   *  being revoked — a withdrawal is not a new consent, and the projection has
   *  to know which grant it closes. */
  consentId: string;
  policyVersion: string;
  scope: string;
  granted: boolean;
}): Promise<void> {
  await appendEventSafe({
    personId: args.userId,
    type: args.granted ? "consent.granted" : "consent.withdrawn",
    occurredAt: args.occurredAt,
    payload: {
      projectionId: args.consentId,
      policyVersion: args.policyVersion,
      scope: args.scope,
    },
    actorType: "patient",
  });
}

/** A member asking for a module. The request half of the unlock workflow was
 *  missing from the spine entirely — only the clinician's decision was
 *  recorded, so a rebuild had no row to decide *on*. */
export async function recordUnlockRequested(args: {
  personId: string;
  unlockId: string;
  moduleId: string;
  memberNote?: string | null;
  occurredAt?: string;
}): Promise<void> {
  await appendEventSafe({
    personId: args.personId,
    type: "module_unlock.requested",
    occurredAt: args.occurredAt,
    payload: {
      projectionId: args.unlockId,
      moduleId: args.moduleId,
      memberNote: args.memberNote ?? null,
    },
    actorType: "patient",
  });
}

export async function recordUnlockDecision(args: {
  personId: string;
  /** Primary key of the `module_unlocks` row. */
  unlockId: string;
  moduleId: string;
  decision: string;
  clinicianId: string;
  decisionReason?: string | null;
  isOverride?: boolean;
  occurredAt?: string;
}): Promise<void> {
  await appendEventSafe({
    personId: args.personId,
    type: "module_unlock.decided",
    occurredAt: args.occurredAt,
    payload: {
      projectionId: args.unlockId,
      moduleId: args.moduleId,
      decision: args.decision,
      decisionReason: args.decisionReason ?? null,
      override: args.isOverride ?? false,
    },
    actorId: args.clinicianId,
    actorType: "clinician",
  });
}
