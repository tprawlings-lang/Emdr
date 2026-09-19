// FAILURE-INJECTION EVIDENCE for the failure register's
// `safety.real-information-enters-a-synthetic-environment` — see
// src/lib/governance/failure-register.ts.
//
//   "Real information enters a synthetic environment → use incident handling.
//   DO NOT SOLVE IT BY CHANGING THE BANNER."
//
// The scan that FINDS this is well tested. What was not tested is what happens
// next, and the handoff's second sentence is the whole reason to test it: the
// environment already carries a FABRICATED flag, and the cheapest response to a
// finding is to reason about what the label means until the finding sounds
// acceptable. Changing what a screen says about the data does not change what
// is in it.
//
// So this injects a real-shaped value into a fabricated person's record and
// follows the consequences: the scan turns, the release gate blocks, and the
// flag on the screen does not move — because it is about the account, and the
// account was always fabricated.

process.env.EMDR_DATA_DIR = `/tmp/steady-contam-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "contam-test-key";
process.env.EMDR_SESSION_SECRET = process.env.EMDR_SESSION_SECRET ?? "contam-test-secret-not-real";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";

import { getDb } from "../src/lib/db";
import { runIdentityScan, SCAN_BOUNDARY } from "../src/lib/demo-identity-scan";
import { resolveEvidence } from "../src/lib/review/gates";

/** Put a real-shaped value where a fabricated person's note lives. */
function contaminate(db: ReturnType<typeof getDb>, value: string): void {
  const person = db.prepare("SELECT id, tenant_id FROM persons WHERE provenance = 'fabricated' LIMIT 1")
    .get() as { id: string; tenant_id: string } | undefined;
  assert.ok(person, "no fabricated person to contaminate, so nothing is being injected");
  db.prepare(
    `INSERT INTO between_visit_care_actions
       (id, tenant_id, person_id, clinician_person_id, action_type, note, completed_at, source_surface)
     VALUES (?, ?, ?, ?, 'contact', ?, datetime('now'), 'test')`,
  ).run(`contam-${Date.now()}`, person.tenant_id, person.id, person.id, value);
}

test("a real-shaped value in a fabricated record turns the scan", () => {
  const db = getDb();
  const before = runIdentityScan(db);
  assert.equal(before.severity, "clean", `the environment was already ${before.severity}`);

  // THE INJECTION. A phone number in a care note is the ordinary way this
  // happens: somebody pastes a callback number into a record while
  // demonstrating.
  contaminate(db, "Call back on (415) 555-0134 before Friday.");

  const after = runIdentityScan(db);
  assert.notEqual(after.severity, "clean", "a dialable number in a demo record read as clean");
  assert.ok(after.findings.length > 0);

  // THE FINDING NEVER CARRIES THE VALUE. A scan report that quotes what it
  // found reproduces the disclosure in the artefact written to investigate it.
  const report = JSON.stringify(after.findings);
  assert.ok(!report.includes("555-0134"), "the scan report repeats the value it found");
  assert.ok(!report.includes("415"), "the scan report repeats digits from the value it found");
});

test("the release gate blocks while the scan is dirty, and nothing can talk it round", () => {
  const db = getDb();
  const scan = runIdentityScan(db);
  assert.notEqual(scan.severity, "clean", "the previous test's injection did not persist");

  const evidence = resolveEvidence(db, {});
  const identity = evidence.get("demo_identity")!;
  assert.equal(identity.status, "fail", "the demo-identity gate passed over a contaminated scan");
  assert.match(identity.summary, /finding/i);

  // AND THE GATE READS THE SCAN, not a stored verdict somebody could set. A
  // gate whose status came from a column would be closable by editing the
  // column, which is the database version of changing the banner.
  assert.equal(Number(identity.facts.findings) > 0, true);
});

test("the fabricated label is about the account, so it cannot be the remedy", () => {
  // THE SENTENCE THE HANDOFF PUTS IN CAPITALS. The flag says who you are signed
  // in as; it makes no claim about any particular value in the database, so it
  // is neither falsified by a finding nor repaired by being left on. A reader
  // who treats it as the answer has swapped a cleanup for a caption.
  const flag = fs.readFileSync("src/components/app/ProvenanceFlag.tsx", "utf8");
  assert.match(flag, /isRealAccount/, "the flag no longer derives from the account's provenance");
  assert.ok(
    !/identityScan|runIdentityScan|severity/.test(flag),
    "the fabricated flag reads the scan, so a finding would change a label instead of the data",
  );

  // And the scan's own boundary says what a clean result does NOT establish,
  // which is the other half of not letting a caption do the work.
  assert.match(SCAN_BOUNDARY, /does not mean/i);
  assert.match(SCAN_BOUNDARY, /not a re-identification test/i);
});

test("the incident path for this is written down, and it is not a relabel", () => {
  // A scan finding is a stop condition with somewhere to go. Without a named
  // path the honest response and the convenient one look equally available at
  // the moment somebody is trying to get a demo working.
  const runbook = fs.readFileSync("docs/incident-response.md", "utf8");
  const at = runbook.indexOf("## Real information found in a fabricated environment");
  assert.ok(at > 0, "the runbook has no path for real information in a demo environment");
  const section = runbook.slice(at, at + 3000);

  assert.match(section, /the remedy is never the label/i);
  // The export path first: a cleaned database and a circulating CSV is a fix on
  // one side only.
  assert.match(section, /export_jobs/);
  // Remove the value, not the row — deleting the person hides the finding from
  // the scan without answering how it arrived.
  assert.match(section, /Remove the value, not the row/i);
  assert.match(section, /how it arrived/i);
  // And a clean re-run is the evidence, not an assertion that it was handled.
  assert.match(section, /demo_identity/);
});
