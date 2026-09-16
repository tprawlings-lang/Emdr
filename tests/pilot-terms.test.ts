process.env.EMDR_DATA_DIR = `/tmp/steady-terms-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "0";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "pilot-terms-test-key";
process.env.EMDR_SESSION_SECRET = process.env.EMDR_SESSION_SECRET ?? "pilot-terms-test-secret-not-real";

// What each participant agreed to, and what that permits.
//
// The notice changed after people had ticked it: the pilot gained clinician
// notes and three egress channels, which makes three of the original notice's
// sentences false. Rewriting the page changes what the NEXT person agrees to
// and nothing about the last one, so permission follows the version each
// person accepted.
//
// The properties below are what keep that true rather than decorative:
//
//   1. v1 permits neither records about them nor egress; v2 permits both.
//   2. No grant, or a version nobody taught this about, is the STRICTEST
//      answer — never the most permissive.
//   3. Fabricated people are exempt deliberately, by provenance, not by
//      falling through a check.
//   4. The refusal reaches the clinician as a sentence, at draft time, before
//      they lose what they typed.

import { strict as assert } from "node:assert";
import test from "node:test";

import { getDb } from "../src/lib/db";
import {
  pilotHandling, participantsOnOldTerms,
  PILOT_TERMS_V1, PILOT_TERMS_V2, PILOT_ACK_SCOPE, CURRENT_PILOT_TERMS,
} from "../src/lib/enrollment/pilot-terms";
import { PILOT_TENANT_ID } from "../src/lib/enrollment/gate";
import { saveDraft, NoteError } from "../src/lib/clinical/notes";

const CLIN = "terms-clinician";
const BODY = "Reviewed the week with them; sleep improving, no safety concerns raised today.";

function clear() {
  const db = getDb();
  // FOREIGN KEYS OFF FOR THE TEARDOWN ONLY. One test drives the real
  // enrollment action, which writes a user, a person, a ledger event, a
  // consent pair and a subscription; unpicking that by hand means knowing
  // every table that will ever reference a member, and getting it wrong shows
  // up as a foreign-key error in an unrelated test. The constraint is restored
  // immediately, so nothing under test runs without it.
  db.pragma("foreign_keys = OFF");
  try {
    db.prepare("DELETE FROM clinical_notes").run();
    for (const t of ["longitudinal_events"]) {
      db.prepare(`DELETE FROM ${t} WHERE person_id IN (SELECT id FROM persons WHERE tenant_id = ?)`)
        .run(PILOT_TENANT_ID);
    }
    for (const t of ["consents", "subscriptions"]) {
      db.prepare(`DELETE FROM ${t} WHERE user_id IN (SELECT id FROM users WHERE tenant_id = ?)`)
        .run(PILOT_TENANT_ID);
    }
    db.prepare("DELETE FROM persons WHERE tenant_id = ?").run(PILOT_TENANT_ID);
    db.prepare("DELETE FROM users WHERE tenant_id = ?").run(PILOT_TENANT_ID);
  } finally {
    db.pragma("foreign_keys = ON");
  }
  db.prepare(
    "INSERT INTO tenants (id, kind, name) VALUES (?, 'program', 'Steady Pilot') ON CONFLICT(id) DO NOTHING",
  ).run(PILOT_TENANT_ID);
  db.prepare(
    `INSERT INTO users (id, email, name, role, password_hash, status, tenant_id)
     VALUES (?, 'terms-clin@example.test', 'Clin', 'clinician', 'x', 'active', ?)`,
  ).run(CLIN, PILOT_TENANT_ID);
}

/** A participant, their provenance, and the notice they ticked (if any). */
function person(id: string, provenance: "real" | "fabricated", version: string | null) {
  const db = getDb();
  db.prepare(
    `INSERT INTO users (id, email, name, role, password_hash, status, tenant_id)
     VALUES (?, ?, ?, 'member', 'x', 'active', ?)`,
  ).run(id, `${id}@example.test`, id, PILOT_TENANT_ID);
  db.prepare(
    "INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, ?, ?)",
  ).run(id, PILOT_TENANT_ID, id, provenance);
  if (version) {
    db.prepare(
      `INSERT INTO consents (id, user_id, policy_version, scope, granted_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
    ).run(`c-${id}`, id, version, PILOT_ACK_SCOPE);
  }
  return id;
}

// ---------------------------------------------------------------------------
// 1. What each version permits
// ---------------------------------------------------------------------------

test("the old notice permits neither records about them nor egress", async () => {
  clear(); person("terms-v1", "real", PILOT_TERMS_V1);
  const h = await pilotHandling("terms-v1");
  assert.equal(h.version, PILOT_TERMS_V1);
  assert.equal(h.clinicalRecords, false);
  assert.equal(h.egress, false);
  assert.match(h.reason, /not a medical record|nobody would contact/i, "the refusal does not say what they were told");
});

test("the current notice permits both", async () => {
  clear(); person("terms-v2", "real", PILOT_TERMS_V2);
  const h = await pilotHandling("terms-v2");
  assert.equal(h.clinicalRecords, true);
  assert.equal(h.egress, true);
});

test("new enrollees are given the current notice, not the original", () => {
  assert.equal(CURRENT_PILOT_TERMS, PILOT_TERMS_V2);
});

// ---------------------------------------------------------------------------
// 2. The unknown cases fail strict
// ---------------------------------------------------------------------------

test("no acknowledgment at all is the strictest answer, not the newest", async () => {
  clear(); person("terms-none", "real", null);
  const h = await pilotHandling("terms-none");
  assert.equal(h.version, null);
  assert.equal(h.clinicalRecords, false);
  assert.equal(h.egress, false);
});

test("a version nobody taught this about does not inherit v2's permissions", async () => {
  // A future v3 must not become permissive by looking newer. Permission
  // follows wording somebody actually read.
  clear(); person("terms-v3", "real", "wellness-ack-v3");
  const h = await pilotHandling("terms-v3");
  assert.equal(h.version, "wellness-ack-v3");
  assert.equal(h.clinicalRecords, false);
  assert.equal(h.egress, false);
});

test("the later grant governs when somebody moves from v1 to v2", async () => {
  clear(); person("terms-moved", "real", PILOT_TERMS_V1);
  getDb().prepare(
    `INSERT INTO consents (id, user_id, policy_version, scope, granted_at)
     VALUES ('c-moved-2', 'terms-moved', ?, ?, datetime('now', '+1 second'))`,
  ).run(PILOT_TERMS_V2, PILOT_ACK_SCOPE);

  const h = await pilotHandling("terms-moved");
  assert.equal(h.version, PILOT_TERMS_V2, "the earlier grant still governs after re-consent");
  assert.equal(h.clinicalRecords, true);
  // And the v1 row SURVIVES, because it is the record that they were once
  // handled differently.
  const rows = getDb().prepare(
    "SELECT COUNT(*) AS n FROM consents WHERE user_id = 'terms-moved' AND scope = ?",
  ).get(PILOT_ACK_SCOPE) as { n: number };
  assert.equal(rows.n, 2, "re-consent erased the record of the earlier terms");
});

// ---------------------------------------------------------------------------
// 3. The gate a clinician actually meets
// ---------------------------------------------------------------------------

test("a note about someone on the old notice is refused, at draft time, in words", async () => {
  clear(); person("terms-note-v1", "real", PILOT_TERMS_V1);
  await assert.rejects(
    () => saveDraft({ personId: "terms-note-v1", tenantId: PILOT_TENANT_ID, clinicianId: CLIN,
                      kind: "session", body: BODY }),
    (e: Error) => e instanceof NoteError && /accepted the original notice|not a medical record/i.test(e.message),
  );
  const n = getDb().prepare("SELECT COUNT(*) AS n FROM clinical_notes").get() as { n: number };
  assert.equal(n.n, 0, "a draft was written about somebody who was told that would not happen");
});

test("a note about someone on the current notice is allowed", async () => {
  clear(); person("terms-note-v2", "real", PILOT_TERMS_V2);
  const id = await saveDraft({ personId: "terms-note-v2", tenantId: PILOT_TENANT_ID, clinicianId: CLIN,
                               kind: "session", body: BODY });
  assert.ok(id, "the current notice did not permit a note");
});

test("fabricated people are exempt — the demonstration still works", async () => {
  // The exemption is the point: clinicians exercise the full workflow on the
  // 240 fabricated profiles, who have no terms to hold and disclose nothing.
  clear(); person("terms-fab", "fabricated", null);
  const id = await saveDraft({ personId: "terms-fab", tenantId: PILOT_TENANT_ID, clinicianId: CLIN,
                               kind: "session", body: BODY });
  assert.ok(id, "the gate caught the fabricated population, which breaks the demonstration");
});

test("a person with no record at all is refused rather than assumed fabricated", async () => {
  clear();
  await assert.rejects(
    () => saveDraft({ personId: "terms-ghost", tenantId: PILOT_TENANT_ID, clinicianId: CLIN,
                      kind: "session", body: BODY }),
    (e: Error) => e instanceof NoteError,
  );
});

// ---------------------------------------------------------------------------
// 4. The operator's worklist
// ---------------------------------------------------------------------------

test("the re-consent worklist names everyone not yet on the current notice", async () => {
  clear();
  person("terms-a", "real", PILOT_TERMS_V1);
  person("terms-b", "real", null);
  person("terms-c", "real", PILOT_TERMS_V2);
  person("terms-d", "fabricated", null);

  const waiting = (await participantsOnOldTerms()).map((r) => r.userId).sort();
  assert.deepEqual(waiting, ["terms-a", "terms-b"],
    "the worklist is wrong: it must hold v1 and no-grant, and never the current notice or fabricated people");
});

// ---------------------------------------------------------------------------
// 5. What enrollment actually records
// ---------------------------------------------------------------------------

test("a new enrollee is recorded against the CURRENT notice, not the original", async () => {
  // DRIVEN THROUGH THE REAL ACTION, because the constant being right proves
  // nothing about the call site. An earlier version of this file asserted
  // `CURRENT_PILOT_TERMS === PILOT_TERMS_V2` and stayed green when the grant
  // was mutated back to v1 — a test of a name, not of behaviour.
  clear();
  process.env.EMDR_ENROLLMENT_CODE = "a-long-enough-pilot-code";
  const { enrollAction } = await import("../src/lib/enrollment/actions");

  const form = new FormData();
  form.set("access_code", "a-long-enough-pilot-code");
  form.set("name", "Terms Enrollee");
  form.set("email", "terms-enrollee@example.test");
  form.set("password", "a-good-enough-password");
  form.set("dob", "1990-04-04");
  form.set("wellness_ack", "on");
  form.set("data_ack", "on");

  // The action ends in a redirect and a cookie write, neither of which exists
  // outside a request. Both happen AFTER the consent rows, so the throw is
  // caught and the record is inspected.
  await enrollAction(form).catch(() => undefined);
  delete process.env.EMDR_ENROLLMENT_CODE;

  const row = getDb().prepare(
    "SELECT id FROM users WHERE email = 'terms-enrollee@example.test'",
  ).get() as { id: string } | undefined;
  assert.ok(row, "the enrollment did not complete far enough to record anything");

  const h = await pilotHandling(row!.id);
  assert.equal(h.version, PILOT_TERMS_V2,
    "a new enrollee was recorded against a notice other than the one they were shown");
  assert.equal(h.clinicalRecords, true);
  assert.equal(h.egress, true);

  // Left in place: `clear()` empties the pilot tenant at the start of each test.
});
