// Who a person's clinician is, as a standing fact.
//
// THERE WAS NO WAY TO SAY IT. The caseload carried `primaryClinicianId` and
// derived it from `module_unlocks.clinician_id` — whoever last approved or
// refused a request to open a gated module. A clinician who answered one
// unlock for somebody else's patient became that patient's primary clinician;
// a person who had never requested an unlock had none at all, which was all
// 250 of them. So every queue row read Unassigned, the `hybrid` caseload
// model's promise that "a named owner carries accountability" was inert, and
// "Dr Chen's caseload" was not a thing the system knew.
//
// THREE THINGS THIS IS NOT. It is not the queue's per-item owner: `assignWork`
// attaches somebody to one piece of work, and that still outranks this for
// that item, because a standing clinician and whoever picked up today's alert
// are different answers to different questions. It is not access — the active
// `hybrid` model lets anyone in the tenant act, deliberately, so that a member
// in an Immediate band does not wait for one person to come back from leave.
// And it is not an escalation rule: nothing here moves a person automatically,
// because who unclaimed work falls to is an operational decision this codebase
// must not invent.
//
// HISTORY IS KEPT, BECAUSE A TRANSFER IS A CLINICAL FACT. `ended_at` null is
// the current assignment and the rows before it say who held this person and
// when that changed. Updating one row in place would answer "who looks after
// them" and lose "who did, in March" — and the second question is the one
// asked after something goes wrong.

import { randomUUID } from "node:crypto";

import { data } from "../data";

export interface CaseloadAssignment {
  id: string;
  personId: string;
  /** A PERSON id. Eleven of the twelve fabricated clinicians are persons with
   *  a role assignment and no login; keying this to accounts would make them
   *  unassignable. Where a clinician does hold an account the two ids are the
   *  same value, so an access comparison against a signed-in id still works. */
  clinicianPersonId: string;
  clinicianName: string | null;
  assignedBy: string | null;
  reason: string | null;
  startedAt: string;
  endedAt: string | null;
  endedReason: string | null;
}

interface Row {
  id: string;
  person_id: string;
  clinician_person_id: string;
  clinician_name: string | null;
  assigned_by: string | null;
  reason: string | null;
  started_at: string;
  ended_at: string | null;
  ended_reason: string | null;
}

function hydrate(r: Row): CaseloadAssignment {
  return {
    id: r.id, personId: r.person_id, clinicianPersonId: r.clinician_person_id,
    clinicianName: r.clinician_name, assignedBy: r.assigned_by, reason: r.reason,
    startedAt: r.started_at, endedAt: r.ended_at, endedReason: r.ended_reason,
  };
}

const SELECT = `SELECT a.id, a.person_id, a.clinician_person_id, p.display_name AS clinician_name,
                       a.assigned_by, a.reason, a.started_at, a.ended_at, a.ended_reason
                  FROM caseload_assignments a
                  LEFT JOIN persons p ON p.id = a.clinician_person_id`;

function stamp(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19);
}

/**
 * Everyone currently assigned, in one tenant.
 *
 * TENANT-SCOPED IN THE QUERY rather than filtered after. Who works with whom is
 * a disclosure about staffing as much as about care, and a caseload that
 * silently spans tenants is the failure ADR 0011 exists to prevent.
 */
export async function currentAssignments(tenantId: string): Promise<Map<string, CaseloadAssignment>> {
  const c = await data();
  const rows = (await c.all(
    `${SELECT} WHERE a.tenant_id = ? AND a.ended_at IS NULL ORDER BY a.started_at ASC`,
    [tenantId]
  )) as Row[];
  // Ascending, so a later row wins if two are somehow open at once. That
  // should not happen — `assignToCaseload` ends the current one in the same
  // transaction — and picking deterministically beats picking by accident.
  const out = new Map<string, CaseloadAssignment>();
  for (const r of rows) out.set(r.person_id, hydrate(r));
  return out;
}

/** One person's current clinician, or null. */
export async function assignmentFor(
  tenantId: string, personId: string
): Promise<CaseloadAssignment | null> {
  const c = await data();
  const row = (await c.get(
    `${SELECT} WHERE a.tenant_id = ? AND a.person_id = ? AND a.ended_at IS NULL
      ORDER BY a.started_at DESC LIMIT 1`,
    [tenantId, personId]
  )) as Row | undefined;
  return row ? hydrate(row) : null;
}

/** Who held this person, newest first. The current one is included. */
export async function assignmentHistory(
  tenantId: string, personId: string
): Promise<CaseloadAssignment[]> {
  const c = await data();
  const rows = (await c.all(
    `${SELECT} WHERE a.tenant_id = ? AND a.person_id = ? ORDER BY a.started_at DESC, a.id DESC`,
    [tenantId, personId]
  )) as Row[];
  return rows.map(hydrate);
}

/** Everyone one clinician currently holds. */
export async function caseloadOf(
  tenantId: string, clinicianPersonId: string
): Promise<CaseloadAssignment[]> {
  const c = await data();
  const rows = (await c.all(
    `${SELECT} WHERE a.tenant_id = ? AND a.clinician_person_id = ? AND a.ended_at IS NULL
      ORDER BY a.started_at ASC`,
    [tenantId, clinicianPersonId]
  )) as Row[];
  return rows.map(hydrate);
}

export type AssignmentResult =
  | { ok: true; id: string; replaced: CaseloadAssignment | null }
  /** Already assigned to this clinician. Not an error and not a write: a
   *  repeated assignment that closed and reopened the same row would put a
   *  transfer in the history that never happened. */
  | { ok: true; id: null; replaced: null; unchanged: true }
  | { ok: false; reason: string };

/**
 * Assign a person to a clinician, ending whoever held them.
 *
 * ONE OPEN ROW PER PERSON, ENFORCED BY ENDING THE OLD ONE HERE rather than by a
 * unique index on (tenant, person) — the index cannot express "at most one
 * where ended_at is null" portably, and a partial index that silently does
 * nothing on another engine would be worse than a rule written down.
 */
export async function assignToCaseload(args: {
  tenantId: string;
  personId: string;
  clinicianPersonId: string;
  /** Person id of whoever decided. Null for the demonstration seed, which is
   *  not somebody. */
  assignedBy?: string | null;
  reason?: string | null;
  now?: Date;
}): Promise<AssignmentResult> {
  if (!args.personId || !args.clinicianPersonId) {
    return { ok: false, reason: "An assignment needs a person and a clinician." };
  }
  // A PERSON CANNOT BE THEIR OWN CLINICIAN. Cheap to check and confusing to
  // find later, and it is exactly the shape a bad id mapping produces.
  if (args.personId === args.clinicianPersonId) {
    return { ok: false, reason: "A person cannot be assigned to themselves." };
  }

  const current = await assignmentFor(args.tenantId, args.personId);
  if (current && current.clinicianPersonId === args.clinicianPersonId) {
    return { ok: true, id: null, replaced: null, unchanged: true };
  }

  const at = stamp(args.now ?? new Date());
  const c = await data();
  if (current) {
    await c.run(
      `UPDATE caseload_assignments SET ended_at = ?, ended_reason = ?
        WHERE id = ? AND ended_at IS NULL`,
      [at, "Reassigned", current.id]
    );
  }
  const id = randomUUID();
  await c.run(
    `INSERT INTO caseload_assignments
       (id, tenant_id, person_id, clinician_person_id, assigned_by, reason, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, args.tenantId, args.personId, args.clinicianPersonId,
     args.assignedBy ?? null, args.reason?.trim() || null, at]
  );
  return { ok: true, id, replaced: current };
}

/**
 * End an assignment without starting another.
 *
 * A REAL STATE, NOT A GAP. Somebody leaves and their people are unassigned
 * until a person decides where they go — and the product must be able to say
 * that rather than keeping a name on the row that nobody is behind. The
 * unclaimed-work count on the Command Center is what makes it visible.
 */
export async function endAssignment(args: {
  tenantId: string;
  personId: string;
  reason: string;
  now?: Date;
}): Promise<{ ok: boolean; reason?: string }> {
  const reason = args.reason.trim();
  // A REASON IS REQUIRED. Leaving a person with no clinician is a decision,
  // and an unexplained one reads later as a mistake nobody can rule out.
  if (!reason) return { ok: false, reason: "Say why this person is being left unassigned." };
  const current = await assignmentFor(args.tenantId, args.personId);
  if (!current) return { ok: false, reason: "Nobody is assigned to this person." };
  const c = await data();
  await c.run(
    "UPDATE caseload_assignments SET ended_at = ?, ended_reason = ? WHERE id = ? AND ended_at IS NULL",
    [stamp(args.now ?? new Date()), reason, current.id]
  );
  return { ok: true };
}
