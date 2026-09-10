process.env.EMDR_DATA_DIR = `/tmp/steady-qaexport-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET ??= "qa-export-test-placeholder-secret";

// The QA report (handoff 07 Wave 8, p9's "Export QA report").
//
// p9: "A manifest of counts, hashes and failed checks, labelled fabricated on
// every page." What the console said it needed was not an export but a RELEASE
// PATH — handoff 09 Package 5 made an export a job with a lifecycle, a
// signature and a rechecked download, so the work was putting the checks
// through that door rather than building a second one.
//
// THE GUARDS ARE ABOUT IT STILL BEING THAT DOOR. It would be easy, and wrong,
// for this to become a quiet second export implementation that skips the parts
// that make an export governed — the stated purpose, the signature, the audit
// event before the file exists. Each of those is checked below by breaking it.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { getDb } from "../src/lib/db";
import { resetDemoData } from "../src/lib/demo-reset";
import {
  QA_EXPORT_SURFACE, exportQaReport, qaRows, qaSummary,
} from "../src/lib/demo/qa-export";
import { PROJECTED_TABLES } from "../src/lib/projections";

const ROOT = path.join(__dirname, "..");
const code = (rel: string) =>
  fs.readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");

const db = getDb();
resetDemoData(db);

// A SEEDED ACCOUNT, not an invented id. `export_jobs.requested_by` references
// `users(id)`, so a made-up actor fails on the foreign key — which is the
// constraint doing its job: an export attributed to nobody is an export nobody
// can be asked about.
const ADMIN = (() => {
  const row = db.prepare(
    "SELECT id, role FROM users WHERE role = 'demo_admin' LIMIT 1"
  ).get() as { id: string; role: string } | undefined;
  if (!row) throw new Error("no demo administrator in the seeded environment");
  return row;
})();
const PURPOSE = "Attaching to the deploy ticket for the September release check";

// ---------------------------------------------------------------------------
// A manifest of counts, hashes and failed checks
// ---------------------------------------------------------------------------

test("the report carries counts, hashes and every check — not only the failures", () => {
  // p9 asks for "failed checks" and it would be easy to read that as a report
  // OF the failures. A file that lists only what went wrong cannot be used to
  // show that anything went right, which is the more common reason somebody
  // attaches one to a ticket.
  const rows = qaRows(db);
  const sections = new Set(rows.map((r) => r.section));
  assert.deepEqual(
    [...sections].sort(),
    ["data quality", "data scenarios", "environment", "projection hashes"],
    "the report is missing a section"
  );

  // The hashes p9 names: the baseline, and one per projected table.
  assert.ok(rows.some((r) => r.item === "Baseline hash" && r.actual.length === 64),
    "the report carries no baseline hash");
  for (const t of PROJECTED_TABLES) {
    assert.ok(rows.some((r) => r.section === "projection hashes" && r.item === t),
      `the report has no hash row for ${t}`);
  }

  // And passing checks are rows, not omissions.
  assert.ok(rows.some((r) => r.result === "pass"), "no passing check is reported");
  const s = qaSummary(rows);
  assert.ok(s.total > 10, `only ${s.total} graded checks; the manifest is not being read`);
});

test("the rebuild outcome is the first row a reader hits", () => {
  // Checks computed against a database whose rebuild failed are checks about
  // the wrong database. The preflight gate orders it first for this reason and
  // the file does the same, so somebody working down from the top reaches it
  // before they start interpreting counts.
  const rows = qaRows(db);
  assert.equal(rows[0].section, "environment");
  assert.equal(rows[0].item, "Last rebuild");
});

test("an applied data bundle is reported, so two reports can be compared", () => {
  // What would be wrong is a report describing a population as the published
  // one while it carries three days of fabricated safety gates.
  const rows = qaRows(db);
  const scenarios = rows.filter((r) => r.section === "data scenarios");
  assert.ok(scenarios.length > 0, "the report never mentions data bundles");
  // With none applied it says so rather than omitting the section — an absent
  // section reads as "not checked".
  assert.equal(scenarios[0].actual, "none");
  // And a bundle is INFO, never a failure: applying one is legitimate.
  for (const r of scenarios) assert.equal(r.result, "info");
});

test("an unrecorded projection hash is a failure in the report, not an absence", () => {
  // The same rule the preflight gate follows. A report that counts "I do not
  // know" as fine is a report somebody will quote as evidence the dataset was
  // right.
  const src = code("src/lib/demo/qa-export.ts");
  assert.match(
    src, /result: c\.verdict === "matches" \? "pass" : "fail"/,
    "a projection row that is merely not-recorded is graded as a pass"
  );
});

// ---------------------------------------------------------------------------
// Released through the governed path, not around it
// ---------------------------------------------------------------------------

test("the report goes through createExport rather than writing its own file", async () => {
  const src = code("src/lib/demo/qa-export.ts");
  assert.match(src, /await createExport\(/, "the QA report does not use the governed export path");
  // No second implementation: no signing, no hashing, no CSV assembly here.
  for (const forbidden of ["createHmac", "createHash", "join(\",\")", "INSERT INTO"]) {
    assert.ok(!src.includes(forbidden),
      `the QA report does "${forbidden}" itself; it must use the governed path, not copy it`);
  }
});

test("a released report is signed, hashed, and refuses without a purpose", async () => {
  const refused = await exportQaReport({
    db, requestedBy: ADMIN.id, requestedByRole: ADMIN.role, purpose: "qa",
  });
  assert.equal(refused.ok, false, "a one-word purpose produced a file");
  assert.match(
    (refused as { reason: string }).reason, /purpose/i,
    "the refusal does not say what was wrong"
  );

  const out = await exportQaReport({
    db, requestedBy: ADMIN.id, requestedByRole: ADMIN.role, purpose: PURPOSE,
  });
  assert.ok(out.ok, "a well-formed request was refused");
  const r = (out as { result: { csv: string; signature: string; contentHash: string; rowCount: number } }).result;
  assert.equal(r.contentHash.length, 64, "no content hash");
  assert.ok(r.signature.length > 0, "no signature");
  assert.ok(r.rowCount > 10, "the file has almost no rows in it");

  // p9: "labelled fabricated on every page."
  assert.match(r.csv, /FABRICATED DEMONSTRATION DATA/, "the file is not labelled fabricated");
  // And the provenance travels IN the file, because a CSV separated from the
  // page it came from is the normal case.
  assert.match(r.csv, /# Purpose: /, "the file does not carry its purpose");
  assert.match(r.csv, new RegExp(`# Surface: ${QA_EXPORT_SURFACE}`), "the file does not name its surface");
});

test("releasing the report writes an audit event before the file exists", async () => {
  const before = (db.prepare(
    "SELECT COUNT(*) AS n FROM audit_log WHERE event_type = 'export_created'"
  ).get() as { n: number }).n;

  await exportQaReport({
    db, requestedBy: ADMIN.id, requestedByRole: ADMIN.role,
    purpose: "Second release for the audit-event guard in the test suite",
  });

  const after = (db.prepare(
    "SELECT COUNT(*) AS n FROM audit_log WHERE event_type = 'export_created'"
  ).get() as { n: number }).n;
  assert.equal(after, before + 1, "releasing a QA report recorded no disclosure");
});

test("no column of the report is a count of people, and that is declared", () => {
  // `createExport` cannot suppress a column it has not been told is a count of
  // people, so the type requires every caller to name them — including naming
  // none, which is a declaration rather than an omission.
  const src = code("src/lib/demo/qa-export.ts");
  assert.match(src, /countColumns: \[\]/, "the QA export does not declare its count columns");

  // And the claim is true: every value in the report is text.
  for (const r of qaRows(db)) {
    for (const v of [r.section, r.item, r.expected, r.actual, r.result]) {
      assert.equal(typeof v, "string", `${r.item} carries a non-text value`);
    }
  }
});

// ---------------------------------------------------------------------------
// It exports a broken environment on purpose
// ---------------------------------------------------------------------------

test("a failing environment still produces a report", async () => {
  // The one control on the console that does not refuse on a failing manifest.
  // Withholding it when the checks fail would remove the artifact at the exact
  // moment it is the thing being asked for.
  const row = db.prepare("SELECT id FROM checkins LIMIT 1").get() as { id: string };
  db.prepare("DELETE FROM checkins WHERE id = ?").run(row.id);

  const rows = qaRows(db);
  const s = qaSummary(rows);
  assert.ok(s.failed > 0, "breaking the dataset produced no failing check");

  const out = await exportQaReport({
    db, requestedBy: ADMIN.id, requestedByRole: ADMIN.role,
    purpose: "Reporting the broken dataset to the team that owns the deploy",
  });
  assert.ok(out.ok, "a failing environment could not produce a QA report");
  assert.match(
    (out as { result: { csv: string } }).result.csv, /fail/,
    "the report of a broken environment contains no failure"
  );

  resetDemoData(db);
});

// ---------------------------------------------------------------------------
// The second door, and why it is narrow
// ---------------------------------------------------------------------------

test("the QA route serves only QA reports, and only to a demo administrator", () => {
  // An id is a URL: it gets pasted into a ticket and fetched by whoever has
  // it. Without the surface check, a demo administrator holding ANY export id
  // could read an organization's purpose, cohort and filter through a door
  // that never meant to offer them.
  const route = code("src/app/api/demo/qa-report/[id]/route.ts");
  assert.match(route, /await requireDemoAdmin\(\)/, "the QA route has no role guard");
  assert.match(
    route, /String\(row\.surface\) !== QA_EXPORT_SURFACE/,
    "the QA route will serve any export job, not only a QA report"
  );
  assert.match(route, /verifySignature\(/, "the QA route serves an unverified record");
  assert.match(route, /type: "export_downloaded"/, "a QA download is not audited");
  // Not found rather than forbidden: "forbidden" confirms the export exists.
  assert.doesNotMatch(route, /status: 403/, "the route answers forbidden, confirming an id exists");
});

test("the console offers the report and shows what it has released", () => {
  const page = code("src/app/admin/demo/page.tsx");
  assert.match(page, /exportDemoQaReport/, "the console has no QA export control");
  assert.match(page, /qaHistory\.length > 0/, "the console never shows what it has released");
  assert.match(page, /api\/demo\/qa-report/, "the console links to no manifest");
  // Scoped to QA reports, or the panel would list every platform-tenant export.
  assert.match(page, /e\.surface === QA_EXPORT_SURFACE/, "the history is not scoped to QA reports");

  const at = page.indexOf("const PENDING");
  assert.ok(at > 0);
  assert.ok(!page.slice(at).includes('control: "Export QA report"'),
    "the console still lists the QA export as not built");
});

test("p9's six controls are all built, and the not-built panel says so honestly", () => {
  // The console keeps a list of what it lacks. A screen that keeps a record of
  // what it USED to lack is a screen nobody trusts to be current, so the rows
  // are removed as they are built rather than struck through.
  const page = code("src/app/admin/demo/page.tsx");
  const at = page.indexOf("const PENDING");
  assert.ok(at > 0, "the console no longer declares its pending controls");
  const list = page.slice(at);
  const remaining = [...list.matchAll(/control: "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    remaining, [],
    `these controls are still declared unbuilt: ${remaining.join(", ")}`
  );

  // AND THE PANEL DOES NOT LIE WHEN IT IS EMPTY. Its title and footnote said
  // "three are built" while listing nothing — a heading over an empty list
  // reads as broken, and a stale count reads as wrong. It keeps its place
  // because the next gap needs somewhere to be written down.
  assert.match(page, /PENDING\.length === 0 \?/, "the empty panel renders a bare heading");
  assert.ok(!page.includes("three are built"), "the panel still claims a stale count");
});
