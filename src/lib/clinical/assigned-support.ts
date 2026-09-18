import { data } from "../data";
import { newId } from "../db";
import { audit } from "../audit";
import { appendEventSafe } from "../events";
import { repo, type TenantContext } from "../repository";
import { MODULES, type TherapyModule } from "../modules";
import { activePolicy } from "../clinical-policy";

// Assigned support (17 September handoff, "Assigned support command").
//
//   "Replace the isolated feel of Module requests with an Assign support action
//   inside Care and relevant clinical contexts. This is a presentation and
//   workflow change over existing authority. IT MUST NOT CREATE A SECOND ACCESS
//   ENGINE or let an AI grant access."
//
// WHAT AN ASSIGNMENT IS, AND THE WHOLE DESIGN FOLLOWS FROM IT: a clinician
// saying "do this", recorded, with the words the person was given. It is not
// permission. The handoff says so twice — "do not open restricted content
// because an assignment row exists. Access policy still controls the content
// request" — and this module is built so that it could not be otherwise:
// nothing here writes to `module_unlocks`, `checkModuleAccess` never reads this
// table, and a test puts an active assignment on a person and shows the gate
// still refusing them.
//
// THE DIRECTION IS THE NEW PART. `module_unlocks` is a MEMBER asking and a
// clinician answering. This is a CLINICIAN asking and the person answering — by
// doing it, or not. Those are different facts about different people and they
// are stored separately; collapsing them would make "assigned" and "requested"
// one column and lose which of the two happened.
//
// WHAT IS STORED AND WHAT IS REFERENCED. The clinical definition stays in the
// module catalog and is pointed at, so a module whose text is rewritten does
// not leave stale copies in a hundred assignment rows. The patient explanation
// and the sharing rule ARE stored, because they are what somebody was told on a
// date: re-deriving them later would produce today's wording over last month's
// assignment, which is the same drift the clinical-approval hash exists to stop.

/** Whether the person is being asked to do this, or offered it. */
export type Availability = "assigned" | "optional";

/**
 * Where an assignment is in its life.
 *
 * `expired` IS NOT STORED. It is what `effectiveStatus` returns for an active
 * assignment past its expiry, computed on read for the same reason an overdue
 * alert is: a state that depends on a job having run is a state that is wrong
 * whenever the job did not.
 */
export type StoredStatus = "proposed" | "active" | "paused" | "completed" | "withdrawn";
export type AssignmentStatus = StoredStatus | "expired";

export interface SupportAssignment {
  id: string;
  personId: string;
  tenantId: string;
  /** The module this points at. A reference; the definition is not copied. */
  supportId: string;
  supportVersion: string;
  assignedBy: string;
  /** Why, as a code the product can group by rather than free text. */
  purposeCode: string;
  /** The words the PERSON reads. Stored, because it is what they were told. */
  patientExplanation: string;
  /** The sharing rule in force when this was assigned. */
  sharePolicy: string;
  availability: Availability;
  status: StoredStatus;
  startsAt: string;
  expiresAt: string | null;
  reviewAt: string | null;
  policyVersion: string;
  createdAt: string;
  decidedAt: string | null;
  decidedNote: string | null;
}

export class AssignmentRefused extends Error {}

/** Long enough to be an explanation. A person opening their plan and reading
 *  "do this" has been assigned homework, not given care. */
export const MIN_EXPLANATION = 20;

/** The purposes an assignment may be given for.
 *
 *  A CLOSED SET, because free text cannot be grouped, reviewed or counted, and
 *  the review step this feature owes ("show acknowledgement, use, distress,
 *  expiry, withdrawal and clinician review") has to be able to ask what support
 *  is being assigned FOR across a caseload. */
export const PURPOSES = {
  stabilization: "Steadying things before any processing",
  skill_practice: "Practising a skill already introduced in session",
  between_visit: "Keeping continuity between visits",
  preparation: "Preparing for work planned in the next session",
  maintenance: "Holding gains after the main work",
} as const;
export type PurposeCode = keyof typeof PURPOSES;

export function isPurpose(code: string): code is PurposeCode {
  return Object.prototype.hasOwnProperty.call(PURPOSES, code);
}

/** What this clinician may assign to this person right now.
 *
 *  "Return only support definitions allowed for the user, tenant, person, and
 *  current policy."
 *
 *  NOT WHAT THE PERSON MAY OPEN. Those are different questions and answering
 *  the second here is how this becomes a second access engine: a catalog
 *  filtered by the gate would let a clinician discover, from the assign menu,
 *  exactly which safety states a person is in. The gate answers access at the
 *  moment of the content request, where it belongs.
 */
export function assignableSupport(): TherapyModule[] {
  return MODULES.filter((m) => m.id !== "sos");
}

function hydrate(r: Record<string, unknown>): SupportAssignment {
  const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
  return {
    id: String(r.id),
    personId: String(r.person_id),
    tenantId: String(r.tenant_id),
    supportId: String(r.support_id),
    supportVersion: String(r.support_version),
    assignedBy: String(r.assigned_by),
    purposeCode: String(r.purpose_code),
    patientExplanation: String(r.patient_explanation),
    sharePolicy: String(r.share_policy),
    availability: String(r.availability) as Availability,
    status: String(r.status) as StoredStatus,
    startsAt: String(r.starts_at),
    expiresAt: str(r.expires_at),
    reviewAt: str(r.review_at),
    policyVersion: String(r.policy_version),
    createdAt: String(r.created_at),
    decidedAt: str(r.decided_at),
    decidedNote: str(r.decided_note),
  };
}

function stamp(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19);
}

/**
 * The status as a reader should see it, given when they are reading.
 *
 * Expiry is derived rather than swept, so an assignment that ran out overnight
 * reads as expired on the next screen rather than on the next job.
 */
export function effectiveStatus(a: SupportAssignment, now: Date): AssignmentStatus {
  if (a.status !== "active" && a.status !== "proposed") return a.status;
  if (a.expiresAt && stamp(now) > a.expiresAt) return "expired";
  return a.status;
}

/** Whether this assignment is still asking the person for anything. */
export function isLive(a: SupportAssignment, now: Date): boolean {
  const s = effectiveStatus(a, now);
  return s === "proposed" || s === "active";
}

/**
 * Record an assignment.
 *
 * REFUSES RATHER THAN DEGRADES, like every other command in this codebase:
 * each branch is a case where storing something would put an assignment in a
 * person's plan that nobody could act on or account for.
 */
export async function assignSupport(
  ctx: TenantContext,
  args: {
    personId: string;
    supportId: string;
    purposeCode: string;
    patientExplanation: string;
    availability: Availability;
    expiresAt?: string | null;
    reviewAt?: string | null;
    /** The same key twice is the same assignment, not two. */
    idempotencyKey: string;
    // NO CLOCK. `starts_at` is when a clinician asked somebody to do something,
    // which is a record rather than a reading, so it is written on real time
    // and nothing can hand this function a different one. The clock contract's
    // own guard caught the first version of this file taking the reading frame
    // here: under a moved demo clock every assignment would have been
    // backdated. `effectiveStatus` below still takes a reading, because asking
    // whether something has run out IS a reading.
  }
): Promise<SupportAssignment> {
  const assignedBy = ctx.personId;
  if (!assignedBy) throw new AssignmentRefused("an assignment records who made it");
  if (args.personId === assignedBy) {
    throw new AssignmentRefused("a clinician cannot assign support to themselves");
  }

  const mod = MODULES.find((m) => m.id === args.supportId);
  if (!mod) throw new AssignmentRefused(`${args.supportId} is not a support definition.`);
  if (!assignableSupport().some((m) => m.id === mod.id)) {
    throw new AssignmentRefused(`${mod.name} cannot be assigned.`);
  }
  if (!isPurpose(args.purposeCode)) {
    throw new AssignmentRefused(`"${args.purposeCode}" is not a recorded purpose for assigning support.`);
  }

  const explanation = args.patientExplanation.trim();
  if (explanation.length < MIN_EXPLANATION) {
    throw new AssignmentRefused(
      "An assignment needs an explanation the person can read. Say what this is for in their " +
      "terms — what they see is the only part of this they experience."
    );
  }

  const policy = activePolicy();
  const now = new Date();
  const c = await data();

  // IDEMPOTENT BY LOOKUP AND BY CONSTRAINT. The read answers the ordinary
  // double-submit; the UNIQUE index answers two requests racing, where both
  // reads miss and both write. Without the second, a double click produces two
  // assignments and the person sees the same thing twice in their plan.
  const existing = (await c.get(
    "SELECT * FROM support_assignments WHERE tenant_id = ? AND idempotency_key = ?",
    [ctx.tenantId, args.idempotencyKey]
  )) as Record<string, unknown> | undefined;
  if (existing) return hydrate(existing);

  const id = newId();
  const row = {
    id,
    person_id: args.personId,
    assigned_by: assignedBy,
    support_id: mod.id,
    // The version the definition had when it was assigned, so a later rewrite
    // is visible as a difference rather than applied retroactively.
    support_version: policy.version,
    purpose_code: args.purposeCode,
    patient_explanation: explanation,
    // The rule in force, stored with the assignment because the handoff
    // requires the sharing rule to be "versioned with the assignment".
    share_policy: policy.version,
    availability: args.availability,
    status: "active" satisfies StoredStatus,
    starts_at: stamp(now),
    expires_at: args.expiresAt ?? null,
    review_at: args.reviewAt ?? null,
    policy_version: policy.version,
    idempotency_key: args.idempotencyKey,
    created_at: stamp(new Date()),
    decided_at: null,
    decided_note: null,
  };

  try {
    await repo(ctx).insert("support_assignments", row);
  } catch (err) {
    // The race the UNIQUE index exists for: read it back rather than failing,
    // because the caller's assignment did happen — once.
    const again = (await c.get(
      "SELECT * FROM support_assignments WHERE tenant_id = ? AND idempotency_key = ?",
      [ctx.tenantId, args.idempotencyKey]
    )) as Record<string, unknown> | undefined;
    if (again) return hydrate(again);
    throw err;
  }

  await appendEventSafe({
    personId: args.personId,
    tenantId: ctx.tenantId,
    type: "intervention.assigned",
    actorType: "clinician",
    actorId: assignedBy,
    payload: {
      assignmentId: id, supportId: mod.id, availability: args.availability,
      purposeCode: args.purposeCode, policyVersion: policy.version,
    },
  });
  await audit({
    actorId: assignedBy, actorRole: "clinician", family: "clinical",
    type: "support_assigned", target: args.personId,
    detail: { assignmentId: id, supportId: mod.id, purposeCode: args.purposeCode },
  });

  return hydrate({ ...row, tenant_id: ctx.tenantId });
}

/** Everything assigned to this person, newest first. */
export async function assignmentsFor(
  ctx: TenantContext, personId: string
): Promise<SupportAssignment[]> {
  const rows = await repo(ctx).findMany<Record<string, unknown>>(
    "support_assignments", "person_id = ?", [personId], { orderBy: "created_at DESC" }
  );
  return rows.map(hydrate);
}

export type AssignmentChange = "paused" | "withdrawn" | "completed";

/**
 * Change an assignment's state, with a note.
 *
 * ONE FUNCTION FOR THREE OUTCOMES, like the handoff resolver above it, because
 * they are one decision: a caller that could reach only two of them would
 * leave the third to be done with an UPDATE somewhere else.
 */
export async function changeAssignment(
  ctx: TenantContext,
  // Also on real time: a state change is a record of somebody deciding.
  args: { assignmentId: string; to: AssignmentChange; note?: string }
): Promise<SupportAssignment> {
  const actor = ctx.personId;
  if (!actor) throw new AssignmentRefused("a change records who made it");

  const current = await repo(ctx).findOne<Record<string, unknown>>(
    "support_assignments", "id = ?", [args.assignmentId]
  );
  if (!current) throw new AssignmentRefused("Assignment not found.");
  const before = hydrate(current);

  if (before.status !== "active" && before.status !== "proposed" && before.status !== "paused") {
    throw new AssignmentRefused(`This assignment is already ${before.status}.`);
  }
  // WITHDRAWAL NEEDS A REASON and completion does not. Completing says the
  // person did it; withdrawing takes back something they were told to do, and a
  // person who opens their plan to find it gone is owed the reason.
  const note = (args.note ?? "").trim();
  if (args.to === "withdrawn" && note.length < 8) {
    throw new AssignmentRefused("Withdrawing an assignment needs a reason the person can read.");
  }

  const now = new Date();
  const c = await data();
  await c.run(
    `UPDATE support_assignments SET status = ?, decided_at = ?, decided_note = ?
      WHERE id = ? AND tenant_id = ?`,
    [args.to, stamp(now), note || null, args.assignmentId, ctx.tenantId]
  );

  await appendEventSafe({
    personId: before.personId,
    tenantId: ctx.tenantId,
    type: "intervention.assignment_changed",
    actorType: "clinician",
    actorId: actor,
    payload: { assignmentId: before.id, from: before.status, to: args.to },
  });
  await audit({
    actorId: actor, actorRole: "clinician", family: "clinical",
    type: "support_assignment_changed", target: before.personId,
    detail: { assignmentId: before.id, to: args.to },
  });

  return { ...before, status: args.to, decidedAt: stamp(now), decidedNote: note || null };
}
