// Assigning work, and the queue that has to show it.
//
// A CLINICIAN PRESSED ASSIGN, CHOSE AN OWNER, AND WAS TOLD "Recorded <name> as
// the owner." The row went on saying Unassigned — through a reload, and
// permanently. Found by pressing the button rather than by reading the code: 35
// of 35 rows on the demo caseload read Unassigned, which looks like a staffing
// picture and was a display that never read what the command wrote.
//
// THREE FAULTS STACKED INTO ONE SYMPTOM, which is why reading any one of them
// made the code look right:
//
//   `assignWork` records the owner as a care action carrying `owner:<personId>`
//   in `outcome_state` — a sound decision, since the care vocabulary is closed
//   and inventing a ninth value from a presentation module is the wrong
//   direction for a rule to travel. The queue never read that column. Its own
//   comment said "the queue reads the newest", which was the intention.
//
//   An assigned owner is a PERSON and a derived one is a USER: assignees come
//   from `role_assignments`, while `primaryClinicianId` is read off
//   `module_unlocks.clinician_id`, which references `users`. The name map was
//   built from `users` alone, so a person-id owner resolved to no name — and a
//   row with no owner NAME renders as Unassigned however good its id is.
//
//   So even a queue that read the assignment would have gone on saying
//   Unassigned, and the first fix alone would have looked like no fix at all.

process.env.EMDR_DATA_DIR = `/tmp/steady-assign-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "0";
process.env.EMDR_SESSION_SECRET = "assign-test-secret-at-least-32-characters";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "assign-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";

import { getDb } from "../src/lib/db";
import { buildWorkQueue, type WorkItem } from "../src/lib/clinical/work-queue";

const db = getDb();
const T = {
  tenant: "tenant-assign",
  other: "tenant-assign-other",
  clinician: "clin-assign",
  clinicianPerson: "person-clin-assign",
  member: "mem-assign",
  // The owner is a PERSON with a role assignment and no account — which is what
  // eleven of the twelve fabricated clinicians are, deliberately: unused logins
  // are credentials to rotate for no demonstration value.
  ownerPerson: "person-owner-assign",
  otherOwner: "person-owner-assign-2",
};

for (const t of [T.tenant, T.other]) {
  db.prepare("INSERT OR IGNORE INTO tenants (id, kind, name) VALUES (?, 'organization', ?)").run(t, t);
}
db.prepare(
  "INSERT OR IGNORE INTO users (id, email, name, role, password_hash, tenant_id) VALUES (?, ?, 'Dr Who', 'clinician', 'x', ?)"
).run(T.clinician, "clin-assign@example.test", T.tenant);
db.prepare(
  "INSERT OR IGNORE INTO users (id, email, name, role, password_hash, tenant_id) VALUES (?, ?, 'A Member', 'member', 'x', ?)"
).run(T.member, "mem-assign@example.test", T.tenant);
db.prepare("INSERT OR IGNORE INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, 'A Member', 'fabricated')")
  .run(T.member, T.tenant);
db.prepare("INSERT OR IGNORE INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, 'Noor Fontaine', 'fabricated')")
  .run(T.ownerPerson, T.tenant);
db.prepare("INSERT OR IGNORE INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, 'Someone Else', 'fabricated')")
  .run(T.otherOwner, T.tenant);
// `between_visit_care_actions.clinician_person_id` references `persons`, so the
// clinician doing the assigning needs one too — the same person/user split that
// caused the defect, showing up again in the fixture.
db.prepare("INSERT OR IGNORE INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, 'Dr Who', 'fabricated')")
  .run(T.clinicianPerson, T.tenant);

// Something for the queue to hold.
db.prepare(
  `INSERT OR IGNORE INTO alerts (id, user_id, alert_type, severity, detail, status, tenant_id)
   VALUES ('alert-assign', ?, 'harm_urge', 'urgent', 'fabricated', 'open', ?)`
).run(T.member, T.tenant);

/** An assignment, written exactly the way `assignWork` writes one. */
function recordAssignment(id: string, ownerPersonId: string, at: string, tenant = T.tenant) {
  db.prepare(
    `INSERT OR REPLACE INTO between_visit_care_actions
       (id, tenant_id, person_id, clinician_person_id, action_type, note, outcome_state,
        completed_at, source_surface)
     VALUES (?, ?, ?, ?, 'add_followup', 'Assigned.', ?, ?, 'command_center_row')`
  ).run(id, tenant, T.member, T.clinicianPerson, `owner:${ownerPersonId}`, at);
}

const rowsFor = async (): Promise<WorkItem[]> => {
  const q = await buildWorkQueue({
    clinicianId: T.clinician, tenantId: T.tenant, now: new Date("2026-09-19T10:00:00Z"),
  });
  return q.items.filter((i) => i.personId === T.member);
};

test("with nothing assigned, the row says so rather than naming somebody", async () => {
  const rows = await rowsFor();
  assert.ok(rows.length > 0, "the fixture put nothing on the queue, so nothing below is tested");
  for (const r of rows) {
    assert.equal(r.ownerName, null, "a row named an owner before anybody assigned one");
  }
});

test("an assignment somebody made is the owner the row shows", async () => {
  // THE WHOLE DEFECT IN ONE ASSERTION. Before this, the command answered
  // "Recorded Noor Fontaine as the owner" and this value stayed null forever.
  recordAssignment("assign-1", T.ownerPerson, "2026-09-10 09:00:00");
  const rows = await rowsFor();
  for (const r of rows) {
    assert.equal(r.ownerId, T.ownerPerson, "the queue did not read the assignment back");
    assert.equal(
      r.ownerName, "Noor Fontaine",
      "the owner has no NAME, so the row renders as Unassigned however right the id is",
    );
  }
});

test("reassigning wins, because the ledger appends rather than updating", async () => {
  // An assignment is a correction as often as it is a first decision. The row a
  // clinician means is the last one they wrote; reading the first would show
  // work as owned by somebody who handed it on.
  recordAssignment("assign-2", T.otherOwner, "2026-09-12 09:00:00");
  const rows = await rowsFor();
  for (const r of rows) {
    assert.equal(r.ownerId, T.otherOwner, "an older assignment outranked a newer one");
    assert.equal(r.ownerName, "Someone Else");
  }
});

test("an assignment in another tenant is not read", async () => {
  // A display field is still a disclosure. An owner read across tenants would
  // say who works where, arriving through a name on a row.
  recordAssignment("assign-other", T.ownerPerson, "2026-09-18 09:00:00", T.other);
  const rows = await rowsFor();
  for (const r of rows) {
    assert.equal(r.ownerId, T.otherOwner, "an assignment from another tenant reached this queue");
  }
});

test("the command's encoding and the queue's reader still agree", () => {
  // TWO ENDS OF ONE STRING, IN TWO MODULES. `assignWork` writes
  // `owner:<personId>` into a free-text column and the queue slices the prefix
  // back off. Nothing but this check makes them one decision: renaming the
  // prefix on either side compiles, passes every type, and silently returns the
  // product to answering "Recorded X as the owner" over a row that says
  // Unassigned.
  const writer = fs.readFileSync("src/lib/clinical/shell-actions.ts", "utf8");
  const reader = fs.readFileSync("src/lib/clinical/work-queue.ts", "utf8");
  assert.match(writer, /outcomeState: `owner:\$\{command\.payload\.ownerId\}`/,
    "assignWork no longer writes the `owner:` prefix the queue reads");
  assert.match(reader, /LIKE 'owner:%'/,
    "the queue no longer selects the rows assignWork writes");
  assert.match(reader, /slice\("owner:"\.length\)/,
    "the queue no longer strips the prefix assignWork writes");
});
