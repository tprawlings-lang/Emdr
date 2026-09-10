// The identity scan (§26 p44: "/review/demo-data — Reset and verify fabricated
// data — seed, scan, reset — Run identity scan").
//
// A scan is only worth running if it can find something, so every rule here is
// tested by planting the thing it looks for. A scanner verified only against
// clean data is a scanner verified against nothing: it would pass identically
// if `test` returned false for every input.
//
// The second half of the file is about what the scan REFUSES to do — decrypt a
// field, judge a real person's own details, or report a clean result over rows
// it never read.

process.env.EMDR_DATA_DIR = `/tmp/steady-scan-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "scan-test-secret-at-least-32-characters-long";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "scan-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import { getDb, PLATFORM_TENANT_ID } from "../src/lib/db";
import { encryptField } from "../src/lib/crypto";
import {
  runIdentityScan, SCAN_RULES, SCAN_TARGETS, SCAN_BOUNDARY,
} from "../src/lib/demo-identity-scan";

const db = getDb();

function person(id: string, provenance: "fabricated" | "real", name: string, email: string) {
  db.prepare(
    `INSERT OR IGNORE INTO users (id, tenant_id, email, password_hash, name, role)
     VALUES (?, ?, ?, 'x', ?, 'member')`
  ).run(id, PLATFORM_TENANT_ID, email, name);
  db.prepare(
    `INSERT OR IGNORE INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, ?, ?)`
  ).run(id, PLATFORM_TENANT_ID, name, provenance);
}

function trigger(id: string, userId: string, name: string, notes: string) {
  db.prepare(
    `INSERT OR REPLACE INTO user_triggers
       (id, user_id, tenant_id, trigger_name, trigger_category, intensity_score, notes)
     VALUES (?, ?, ?, ?, 'situational', 3, ?)`
  ).run(id, userId, PLATFORM_TENANT_ID, name, notes);
}

// A clean fabricated person, so the population is never empty and "clean" is
// distinguishable from "nothing to scan".
person("scan-clean", "fabricated", "Fabricated Person", "st-clean@steady.local");
trigger("scan-clean-t", "scan-clean", "Crowded rooms", "Worse in the evening.");

test("every rule finds the thing it looks for", () => {
  // Planted one at a time, so a rule that matches nothing is not covered by
  // another rule's finding on the same row.
  const planted: Array<{ id: string; value: string; kind: string }> = [
    { id: "scan-email", value: "someone@gmail.com", kind: "Deliverable email domain" },
    { id: "scan-ssn", value: "Referred with 123-45-6789 on file", kind: "Government identifier shape" },
    { id: "scan-phone", value: "Call back on (415) 555-0134", kind: "Telephone number" },
    { id: "scan-addr", value: "Lives at 42 Willow Street", kind: "Postal address" },
  ];
  for (const p of planted) {
    person(p.id, "fabricated", "Planted", `st-${p.id}@steady.local`);
    trigger(`${p.id}-t`, p.id, "Planted trigger", p.value);
  }
  const r = runIdentityScan(db);
  try {
    for (const p of planted) {
      const hit = r.findings.find((f) => f.rowId === `${p.id}-t` && f.kind === p.kind);
      assert.ok(hit, `the "${p.kind}" rule did not find ${JSON.stringify(p.value)}`);
      // The finding is locatable without republishing the identifier it found.
      assert.ok(!hit!.shape.includes("6789") && !hit!.shape.includes("0134"),
        `the finding prints the identifier back: ${hit!.shape}`);
    }
    assert.equal(r.severity, "contaminated");
  } finally {
    // In a finally, because the cleanup used to sit after the assertions: one
    // failing rule left every planted identifier in the database, and the next
    // three tests failed for a reason that had nothing to do with them.
    for (const p of planted) {
      db.prepare("DELETE FROM user_triggers WHERE id = ?").run(`${p.id}-t`);
    }
  }
});

test("a rule that matched nothing would be caught here", () => {
  // The rule list is only as good as its coverage, so every rule must have been
  // exercised by the test above. A rule added without a planted case fails.
  const covered = new Set([
    "Deliverable email domain", "Government identifier shape", "Telephone number", "Postal address",
  ]);
  const uncovered = SCAN_RULES.map((r) => r.kind).filter((k) => !covered.has(k));
  assert.deepEqual(uncovered, [],
    `these rules have no planted case, so nothing proves they match anything: ${uncovered.join(", ")}`);
});

test("a reserved domain is not a finding", () => {
  // The demo's own addresses must not fire, or the scan is noise and gets
  // ignored — which is the same as not having one.
  for (const addr of ["st-042@steady.local", "demo@example.com", "a@b.test", "x@thing.invalid"]) {
    const rule = SCAN_RULES.find((r) => r.kind === "Deliverable email domain")!;
    assert.equal(rule.test(addr), false, `${addr} was flagged as deliverable`);
  }
});

test("a real person's own details are outside the scan", () => {
  // A human signing up in this environment is legitimate and their address is
  // supposed to reach them. The first version of this scan flagged exactly that
  // and called it contamination.
  person("scan-real", "real", "A Real Human", "a.real.human@gmail.com");
  const r = runIdentityScan(db);
  assert.equal(r.findings.filter((f) => f.rowId === "scan-real").length, 0,
    "a real person's real email was reported as contamination");
  assert.ok(r.realPeople >= 1, "real people are not counted at all");
  // Reported, not judged: their presence must not change the verdict.
  assert.notEqual(r.severity, "contaminated");
});

test("encrypted fields are counted, never decrypted", () => {
  person("scan-enc", "fabricated", "Encrypted Notes", "st-enc@steady.local");
  // Ciphertext of a value that WOULD be a finding in the clear.
  trigger("scan-enc-t", "scan-enc", "Sealed", encryptField("Call 415-555-0199")!);
  const r = runIdentityScan(db);
  assert.ok(r.unreadable >= 1, "an encrypted field was not counted as unreadable");
  assert.equal(r.findings.filter((f) => f.rowId === "scan-enc-t").length, 0,
    "the scanner matched inside ciphertext, which means it is reading shapes in random bytes");
  const cov = r.coverage.find((c) => c.table === "user_triggers" && c.column === "notes")!;
  assert.ok(cov.encrypted >= 1, "coverage does not report the field it could not read");
  db.prepare("DELETE FROM user_triggers WHERE id = ?").run("scan-enc-t");
});

test("a missing column is reported, not counted as clean", () => {
  // Every target is checked against the live schema. A scan whose coverage
  // shrinks in silence is how a check keeps passing after it stops checking.
  const r = runIdentityScan(db);
  for (const t of SCAN_TARGETS) {
    for (const col of t.columns) {
      const cov = r.coverage.find((c) => c.table === t.table && c.column === col);
      assert.ok(cov, `${t.table}.${col} is not in the coverage report at all`);
      if (cov!.absent) {
        assert.ok(r.absentTargets.includes(`${t.table}.${col}`),
          `${t.table}.${col} is absent but not named in absentTargets`);
      }
    }
  }
  // This schema has every column the scan names. If that stops being true the
  // scan is covering less than it says.
  assert.deepEqual(r.absentTargets, [],
    `the scan names columns this schema does not have: ${r.absentTargets.join(", ")}`);
});

test("a clean result over nothing is not called clean", () => {
  // This database has a fabricated population, so it is a real clean.
  const populated = runIdentityScan(db);
  assert.ok(populated.fabricatedPeople > 0);
  assert.ok(populated.scanned > 0, "nothing was scanned, so no verdict is meaningful");
  assert.notEqual(populated.severity, "nothing_to_scan");

  // AND THE EMPTY CASE IS BUILT, not assumed. The first version of this test
  // asserted only the line above, which passes identically whether the empty
  // case is handled or not — a guard that cannot fail is worse than none,
  // because it is counted. Provenance is immutable by trigger, so the flip
  // happens with the trigger down, exactly as a pre-guard database would have
  // been written.
  const immutable = (db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'persons_provenance_immutable'"
  ).get() as { sql: string } | undefined)?.sql;
  assert.ok(immutable, "the provenance immutability guard is gone — a bigger finding than this test");
  // Exactly the rows that were fabricated, so the restore puts back what was
  // there rather than relabelling anybody who was genuinely real.
  const wereFabricated = (db.prepare(
    "SELECT id FROM persons WHERE provenance = 'fabricated'"
  ).all() as Array<{ id: string }>).map((r) => r.id);
  db.exec("DROP TRIGGER persons_provenance_immutable");
  try {
    db.prepare("UPDATE persons SET provenance = 'real' WHERE provenance = 'fabricated'").run();
    const empty = runIdentityScan(db);
    assert.equal(empty.fabricatedPeople, 0);
    assert.equal(empty.severity, "nothing_to_scan",
      "an environment with nothing fabricated in it reported a clean scan");
    assert.notEqual(empty.severity, populated.severity,
      "a populated clean and an empty one produce the same verdict — the word means nothing");
  } finally {
    const restore = db.prepare("UPDATE persons SET provenance = 'fabricated' WHERE id = ?");
    for (const id of wereFabricated) restore.run(id);
    db.exec(immutable!);
  }
});

test("a person with no stated provenance is contamination", () => {
  // The write guard requires one, so a null is a row that predates it — and the
  // scan cannot say which population it belongs to, which means it cannot say
  // it covered them.
  // The write guard REFUSES this insert, which is the correct behaviour and is
  // why the row has to be made the way a pre-guard database made it: with the
  // trigger absent. Dropping and restoring it is the only honest way to build
  // the state the branch exists for — the alternative was deleting the branch,
  // and deployments that predate the guard are exactly who this reports for.
  const trg = (db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'persons_provenance_required'"
  ).get() as { sql: string } | undefined)?.sql;
  assert.ok(trg, "the provenance write guard is gone — that is a bigger finding than this test");
  db.exec("DROP TRIGGER persons_provenance_required");
  try {
    db.prepare(
      `INSERT INTO persons (id, tenant_id, display_name, provenance)
       VALUES ('scan-unstated', ?, 'Unstated', NULL)`
    ).run(PLATFORM_TENANT_ID);
    const r = runIdentityScan(db);
    assert.ok(r.peopleWithoutProvenance >= 1);
    assert.equal(r.severity, "contaminated");
  } finally {
    db.prepare("DELETE FROM persons WHERE id = 'scan-unstated'").run();
    db.exec(trg!);
  }
});

test("the boundary states what a clean scan does not establish", () => {
  // A scan reported without its limits is read as a guarantee.
  assert.match(SCAN_BOUNDARY, /encrypted/i);
  assert.match(SCAN_BOUNDARY, /re-identification/i);
  assert.match(SCAN_BOUNDARY, /not mean|does not/i);
});

// ── The screen ──────────────────────────────────────────────────────────────

test("the screen is registered and does not carry a reset control", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { REVIEW_SCREENS } = await import("../src/components/clinical/ReviewPage");
  const entry = REVIEW_SCREENS.find((s) => s.href === "/review/demo-data");
  assert.ok(entry, "/review/demo-data is not in REVIEW_SCREENS — it would be unreachable");

  const page = fs.readFileSync(path.join(process.cwd(), "src/app/review/demo-data/page.tsx"), "utf8");
  const code = page.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  // requireReviewAccess admits reviewers and clinicians, and resetDemoData
  // deletes every row. A second copy of that control on a screen most of whose
  // readers cannot use it makes the environment easier to destroy and no easier
  // to verify.
  assert.ok(!code.includes("resetDemoEnvironment"),
    "the review screen wires up the destructive reset action");
  assert.ok(!code.includes("resetDemoData"), "the review screen calls resetDemoData directly");
  // And the scan it DOES run is the read-only one.
  assert.match(code, /runIdentityScan\(/);
});

test("a finding is never rendered as its value", () => {
  // The scan exists to find identifiers. A screen that prints them back has
  // republished the thing it was looking for.
  const rule = SCAN_RULES.find((r) => r.kind === "Government identifier shape")!;
  const shaped = rule.shape("Referred with 123-45-6789 on file");
  assert.ok(!shaped.includes("123-45-6789"), `the shape leaks the value: ${shaped}`);
  assert.match(shaped, /#/, "the shape does not redact the digits");
});
