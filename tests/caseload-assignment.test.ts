// Who a person's clinician is, as a standing fact.
//
// THERE WAS NO WAY TO SAY IT. `primaryClinicianId` was derived from
// `module_unlocks.clinician_id` — whoever last approved or refused a request to
// open a gated module. A clinician who answered one unlock for somebody else's
// patient became that patient's primary clinician, and a person who had never
// requested one had nobody. That was all 250 members, so every queue row read
// Unassigned, the `hybrid` model's promise that "a named owner carries
// accountability" was inert, and "Dr Chen's caseload" was not a thing the
// system knew.
//
// THE ASSERTION THAT MATTERS MOST is the last one: assigning somebody has to
// change what a clinician SEES. Three times this session a command has written
// a record no screen read back — the unlock decisions, the queue's Assign
// control, and a signed release gate — and each looked complete from the
// writing end.

process.env.EMDR_DATA_DIR = `/tmp/steady-caseload-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "0";
process.env.EMDR_SESSION_SECRET = "caseload-test-secret-at-least-32-chars";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "caseload-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";

import { getDb } from "../src/lib/db";
import { data } from "../src/lib/data";
import {
  assignToCaseload, endAssignment, assignmentFor, assignmentHistory,
  currentAssignments, caseloadOf,
} from "../src/lib/clinical/caseload-assignment";
import { buildCaseload, canAct, isCoverageAction } from "../src/lib/clinical/caseload";
import { buildWorkQueue } from "../src/lib/clinical/work-queue";

const db = getDb();
const T = {
  tenant: "tenant-cl",
  other: "tenant-cl-other",
  member: "mem-cl",
  // A clinician WITH an account, so the access comparison can be exercised.
  chen: "clin-cl-chen",
  // A clinician who is a PERSON ONLY — no login — which eleven of the twelve
  // fabricated clinicians are, deliberately.
  ada: "person-cl-ada",
};

for (const t of [T.tenant, T.other]) {
  db.prepare("INSERT OR IGNORE INTO tenants (id, kind, name) VALUES (?, 'organization', ?)").run(t, t);
}
db.prepare(
  "INSERT OR IGNORE INTO users (id, email, name, role, password_hash, tenant_id) VALUES (?, ?, 'Dr Chen', 'clinician', 'x', ?)"
).run(T.chen, "chen-cl@example.test", T.tenant);
db.prepare(
  "INSERT OR IGNORE INTO users (id, email, name, role, password_hash, tenant_id, status) VALUES (?, ?, 'A Member', 'member', 'x', ?, 'active')"
).run(T.member, "mem-cl@example.test", T.tenant);
for (const [id, name] of [[T.member, "A Member"], [T.chen, "Dr Chen"], [T.ada, "Dr Ada Osei"]] as const) {
  db.prepare("INSERT OR IGNORE INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, ?, 'fabricated')")
    .run(id, T.tenant, name);
}

async function clear() {
  const c = await data();
  await c.run("DELETE FROM caseload_assignments", []);
}

test("with nobody assigned, the person has no clinician and the row says so", async () => {
  await clear();
  assert.equal(await assignmentFor(T.tenant, T.member), null);
  const caseload = await buildCaseload({ clinicianId: T.chen, tenantId: T.tenant });
  const row = caseload.rows.find((r) => r.personId === T.member);
  assert.ok(row, "the fixture put nobody on the caseload, so nothing below is tested");
  assert.equal(row.primaryClinicianId, null, "a clinician was derived from somewhere");
});

test("assigning somebody changes what the caseload says", async () => {
  // THE WHOLE POINT, AND THE TRAP THIS SESSION KEEPS FINDING: a command that
  // writes a record no screen reads back looks complete from the writing end.
  await clear();
  const r = await assignToCaseload({
    tenantId: T.tenant, personId: T.member, clinicianPersonId: T.chen,
    assignedBy: T.chen, reason: "Took them on at intake.",
  });
  assert.ok(r.ok);

  const caseload = await buildCaseload({ clinicianId: T.chen, tenantId: T.tenant });
  const row = caseload.rows.find((r2) => r2.personId === T.member)!;
  assert.equal(row.primaryClinicianId, T.chen, "the caseload did not read the assignment back");
});

test("a clinician with no login can hold a caseload", async () => {
  // Eleven of the twelve fabricated clinicians are persons with a role and no
  // account, deliberately — unused credentials are credentials to rotate.
  // Keying this to accounts would have made them unassignable, which is the
  // same constraint that limits who can sign a clinical note.
  await clear();
  const r = await assignToCaseload({
    tenantId: T.tenant, personId: T.member, clinicianPersonId: T.ada,
  });
  assert.ok(r.ok);
  const a = await assignmentFor(T.tenant, T.member);
  assert.equal(a?.clinicianPersonId, T.ada);
  assert.equal(a?.clinicianName, "Dr Ada Osei", "an id with no name reaches the screen as unassigned");
});

test("reassigning ends the old one and keeps it in the history", async () => {
  // A transfer is a clinical fact. Updating one row in place would answer "who
  // looks after them" and lose "who did, in March" — and the second question is
  // the one asked after something goes wrong.
  await clear();
  await assignToCaseload({ tenantId: T.tenant, personId: T.member, clinicianPersonId: T.chen });
  await assignToCaseload({ tenantId: T.tenant, personId: T.member, clinicianPersonId: T.ada });

  const current = await assignmentFor(T.tenant, T.member);
  assert.equal(current?.clinicianPersonId, T.ada);

  const history = await assignmentHistory(T.tenant, T.member);
  assert.equal(history.length, 2, "the previous clinician was overwritten rather than ended");
  const previous = history.find((h) => h.clinicianPersonId === T.chen)!;
  assert.ok(previous.endedAt, "the previous assignment is still open, so two people hold one person");
  assert.equal(previous.endedReason, "Reassigned");

  // AND ONLY ONE IS OPEN.
  const open = history.filter((h) => h.endedAt === null);
  assert.equal(open.length, 1, `${open.length} assignments are open at once`);
});

test("assigning to the same clinician twice records nothing", async () => {
  // A repeated assignment that closed and reopened the same row would put a
  // transfer in the history that never happened.
  await clear();
  await assignToCaseload({ tenantId: T.tenant, personId: T.member, clinicianPersonId: T.chen });
  const again = await assignToCaseload({
    tenantId: T.tenant, personId: T.member, clinicianPersonId: T.chen,
  });
  assert.ok(again.ok && "unchanged" in again && again.unchanged);
  assert.equal((await assignmentHistory(T.tenant, T.member)).length, 1);
});

test("unassigning needs a reason, and leaves a real state rather than a gap", async () => {
  await clear();
  await assignToCaseload({ tenantId: T.tenant, personId: T.member, clinicianPersonId: T.chen });

  const refused = await endAssignment({ tenantId: T.tenant, personId: T.member, reason: "  " });
  assert.equal(refused.ok, false, "a person was left unassigned with no reason recorded");

  const ok = await endAssignment({
    tenantId: T.tenant, personId: T.member, reason: "Dr Chen left; awaiting reallocation.",
  });
  assert.ok(ok.ok);
  assert.equal(await assignmentFor(T.tenant, T.member), null);
  const h = await assignmentHistory(T.tenant, T.member);
  assert.equal(h[0].endedReason, "Dr Chen left; awaiting reallocation.");
});

test("a person cannot be assigned to themselves", async () => {
  // Cheap to check and confusing to find later — and exactly the shape a bad
  // id mapping produces.
  await clear();
  const r = await assignToCaseload({
    tenantId: T.tenant, personId: T.member, clinicianPersonId: T.member,
  });
  assert.equal(r.ok, false);
});

test("an assignment in another tenant is not read", async () => {
  // Who works with whom is a disclosure about staffing as much as about care,
  // and a caseload that silently spans tenants is what ADR 0011 exists to
  // prevent.
  await clear();
  await assignToCaseload({
    tenantId: T.other, personId: T.member, clinicianPersonId: T.chen,
  });
  assert.equal(await assignmentFor(T.tenant, T.member), null, "an assignment crossed tenants");
  assert.equal((await currentAssignments(T.tenant)).size, 0);
  assert.equal((await caseloadOf(T.tenant, T.chen)).length, 0);
  assert.equal((await caseloadOf(T.other, T.chen)).length, 1);

  // AND THROUGH THE CASELOAD QUERY, which is a SECOND place the scope is
  // written and therefore a second place it can be dropped. Removing the
  // tenant from that subselect passed every assertion above — the module's own
  // readers were scoped and the screen's was not, which is exactly the shape a
  // tenant leak takes: correct in the place everybody tests.
  const caseload = await buildCaseload({ clinicianId: T.chen, tenantId: T.tenant });
  const row = caseload.rows.find((r) => r.personId === T.member)!;
  assert.equal(
    row.primaryClinicianId, null,
    "the caseload read an assignment belonging to another tenant",
  );
});

test("the caseload model still decides who may act, not the assignment", async () => {
  // AN ASSIGNMENT IS ACCOUNTABILITY, NOT ACCESS. The active `hybrid` model lets
  // anyone in the tenant act, deliberately, so a member in an Immediate band
  // does not wait for one person to come back from leave. What changes is that
  // acting on somebody else's patient is now VISIBLE as coverage — it never
  // could be before, because nobody had a patient.
  await clear();
  await assignToCaseload({ tenantId: T.tenant, personId: T.member, clinicianPersonId: T.ada });

  assert.equal(canAct("hybrid", T.chen, T.ada), true, "hybrid stopped letting the team cover");
  assert.equal(canAct("pooled", T.chen, T.ada), true);
  assert.equal(canAct("owned", T.chen, T.ada), false, "owned stopped owning");
  assert.equal(
    isCoverageAction("hybrid", T.chen, T.ada), true,
    "acting on somebody else's patient is not marked as coverage",
  );
  assert.equal(isCoverageAction("hybrid", T.ada, T.ada), false);
});

test("an assigned person's queue rows name their clinician", async () => {
  // The queue reads the caseload, so this is the end of the chain: an
  // assignment made on the Care screen reaches the row a clinician looks at.
  await clear();
  db.prepare(
    `INSERT OR IGNORE INTO alerts (id, user_id, alert_type, severity, detail, status, tenant_id)
     VALUES ('alert-cl', ?, 'harm_urge', 'urgent', 'fabricated', 'open', ?)`
  ).run(T.member, T.tenant);
  await assignToCaseload({ tenantId: T.tenant, personId: T.member, clinicianPersonId: T.ada });

  const q = await buildWorkQueue({
    clinicianId: T.chen, tenantId: T.tenant, now: new Date("2026-09-23T10:00:00Z"),
  });
  const rows = q.items.filter((i) => i.personId === T.member);
  assert.ok(rows.length > 0, "the fixture put nothing on the queue");
  for (const row of rows) {
    assert.equal(row.ownerId, T.ada, "the queue did not read the caseload assignment");
    assert.equal(
      row.ownerName, "Dr Ada Osei",
      "the owner has no NAME, so the row renders as Unassigned however right the id is",
    );
  }
});
