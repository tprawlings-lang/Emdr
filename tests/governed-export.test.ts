// Governed export (§29.1's export rule, §30.4's POST /exports, §31.4's export
// row).
//
// An export is the only thing in this product that leaves it. A file gets
// copied, emailed, pasted into a deck, and outlives every screen it came from
// — so the guarantees have to be in the file and in the record, not in the UI
// that produced them.
//
// §31.4 names six: filter parity, cohort version, suppression, purpose, audit
// event, signed file. Each is checked here against behaviour rather than
// against source, because five of the six are only real if they survive a
// round trip.

process.env.EMDR_DATA_DIR = `/tmp/steady-export-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "export-test-secret-at-least-32-characters-long";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "export-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { createExport, hashFilter, verifySignature, listExports, ExportRefused } from "../src/lib/intelligence/export";
import { SMALL_CELL } from "../src/components/charts/aggregate";
import { data } from "../src/lib/data";
import { getDb, PLATFORM_TENANT_ID } from "../src/lib/db";

// export_jobs.tenant_id is a real foreign key, so this has to be a tenant that
// exists. The platform tenant is the one guaranteed to — a hand-written zero
// UUID looks like the NIL_ULID and is not it, which is the shape of bug this
// constant exists to stop.
const TENANT = PLATFORM_TENANT_ID;

async function anyUser(): Promise<string> {
  getDb();
  const c = await data();
  const row = (await c.get("SELECT id FROM users LIMIT 1", [])) as { id: string };
  return row.id;
}

function base(rows: Record<string, string | number | null>[], purpose: string, userId: string) {
  return {
    tenantId: TENANT,
    requestedBy: userId,
    requestedByRole: "admin",
    surface: "test/surface",
    cohortVersion: "cohort.vTest",
    filter: { scope: "all", period: "2026" },
    countColumns: ["people"],
    rows,
    purpose,
  };
}

test("a purpose is required, and must say something", async () => {
  const u = await anyUser();
  for (const bad of ["", "   ", "data", "report", "for a thing"]) {
    await assert.rejects(
      () => createExport(base([{ site: "North", people: 40 }], bad, u)),
      ExportRefused,
      `"${bad}" was accepted as a purpose`,
    );
  }
  // A real sentence passes.
  const ok = await createExport(base([{ site: "North", people: 40 }], "Quarterly access review with the site lead", u));
  assert.ok(ok.id);
});

test("an export with no rows is refused rather than produced empty", async () => {
  const u = await anyUser();
  await assert.rejects(
    () => createExport(base([], "Quarterly access review with the site lead", u)),
    ExportRefused,
  );
});

test("small cells are suppressed IN THE FILE, not only on screen", async () => {
  const u = await anyUser();
  const r = await createExport(base(
    [
      { site: "North", people: 400 },
      { site: "Tiny", people: SMALL_CELL - 1 },
    ],
    "Quarterly access review with the site lead",
    u,
  ));

  assert.equal(r.suppressedCells, 1, "the small cell was not suppressed");
  assert.match(r.csv, new RegExp(`under ${SMALL_CELL}`), "the file has no suppression marker");
  // The actual count must not appear anywhere in the file.
  assert.doesNotMatch(r.csv, new RegExp(`,${SMALL_CELL - 1}(\\n|$)`, "m"), "the suppressed count leaked into the file");
  // The large one is untouched.
  assert.match(r.csv, /North,400/);
});

test("the file carries its own provenance, because it will be separated from the page", async () => {
  const u = await anyUser();
  const r = await createExport(base([{ site: "North", people: 40 }], "Quarterly access review with the site lead", u));
  for (const line of [
    /# Cohort version: cohort\.vTest/,
    /# Filter hash: [0-9a-f]{16}/,
    /# Purpose: Quarterly access review/,
    /# Suppression: counts below 11/,
    /FABRICATED DEMONSTRATION DATA/,
  ]) {
    assert.match(r.csv, line, `the file header is missing ${line}`);
  }
});

test("filter parity: the same filter hashes the same, whatever the key order", () => {
  assert.equal(
    hashFilter({ scope: "all", period: "2026" }),
    hashFilter({ period: "2026", scope: "all" }),
    "key order changes the hash, so parity cannot be checked",
  );
  assert.notEqual(
    hashFilter({ scope: "all", period: "2026" }),
    hashFilter({ scope: "north", period: "2026" }),
    "a different filter produces the same hash",
  );
});

test("the file is signed, and a tampered file fails verification", async () => {
  const u = await anyUser();
  const r = await createExport(base([{ site: "North", people: 40 }], "Quarterly access review with the site lead", u));

  assert.ok(verifySignature(r.contentHash, r.signature), "a freshly signed export does not verify");
  // One byte different in the content means a different hash, and the old
  // signature must not cover it.
  const tampered = r.contentHash.slice(0, -1) + (r.contentHash.endsWith("0") ? "1" : "0");
  assert.equal(verifySignature(tampered, r.signature), false, "a tampered content hash still verifies");
});

test("an audit event is written before the file exists", async () => {
  const u = await anyUser();
  const c = await data();
  const before = (await c.get(
    "SELECT COUNT(*) AS n FROM audit_log WHERE event_type = 'export_created'", [],
  )) as { n: number };

  const r = await createExport(base([{ site: "North", people: 40 }], "Quarterly access review with the site lead", u));

  const after = (await c.all(
    "SELECT detail_json FROM audit_log WHERE event_type = 'export_created' ORDER BY id DESC LIMIT 1", [],
  )) as { detail_json: string }[];
  const count = (await c.get(
    "SELECT COUNT(*) AS n FROM audit_log WHERE event_type = 'export_created'", [],
  )) as { n: number };

  assert.equal(Number(count.n), Number(before.n) + 1, "no audit event was appended");
  const detail = JSON.parse(after[0].detail_json);
  assert.equal(detail.exportId, r.id);
  assert.equal(detail.filterHash, r.filterHash, "the audit event does not record the filter");
  assert.ok(detail.purpose.length > 0, "the audit event does not record the purpose");
  assert.equal(detail.contentHash, r.contentHash, "the audit event cannot be tied to the file");
});

test("the export history is the disclosure log", async () => {
  const u = await anyUser();
  await createExport(base([{ site: "North", people: 40 }], "Board pack for the March review meeting", u));
  const history = await listExports(TENANT);
  assert.ok(history.length > 0, "nothing is recorded");
  const latest = history[0];
  assert.match(latest.purpose, /Board pack/);
  assert.ok(latest.filterHash.length === 16, "the recorded filter hash is not usable for parity");
  assert.ok(latest.contentHash.length === 64, "the recorded content hash is not a sha256");
});

test("without a signing key an export is refused, not produced unsigned", async () => {
  const u = await anyUser();
  const saved = process.env.EMDR_SESSION_SECRET;
  delete process.env.EMDR_SESSION_SECRET;
  try {
    await assert.rejects(
      () => createExport(base([{ site: "North", people: 40 }], "Quarterly access review with the site lead", u)),
      ExportRefused,
      "an unsigned file was produced — it could not be checked against what was released",
    );
  } finally {
    process.env.EMDR_SESSION_SECRET = saved;
  }
});

// ---------------------------------------------------------------------------
// The read side
// ---------------------------------------------------------------------------
//
// An export id is a URL. It gets pasted into a ticket, kept in a bookmark, and
// fetched again by whoever holds it long after the console that made it was
// closed — so the scope check at CREATE time protects nothing on its own.
//
// These are source checks rather than behavioural ones, and that is a real
// limitation: the route handler reads cookies through next/headers and cannot
// be called outside a request. What can still be pinned is the ORDER, which is
// where this class of bug actually lives — a tenant check written after the
// manifest is built reads as present and denies nothing.

test("the download route checks tenant scope, and does it before it builds anything", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "src", "app", "api", "exports", "[id]", "route.ts"), "utf8",
  );

  assert.match(src, /resolveOrgTenant|resolvePayerTenant/,
    "the download route does not resolve the caller's scope, so holding an id is enough to " +
    "read any tenant's purpose, cohort and filter");
  assert.match(src, /inScope\.includes\(String\(row\.tenant_id\)\)/,
    "the download route does not compare the export's tenant against the caller's scope");

  const check = src.indexOf("inScope.includes");
  const manifest = src.indexOf("const manifest");
  // The CALL, not the import at the top of the file — an import always sorts
  // first and would make this assertion vacuous.
  const verify = src.indexOf("verifySignature(String(row.content_hash)");
  assert.ok(check > 0 && check < manifest,
    "the tenant check runs after the manifest is built — a check that denies nothing is not a check");
  assert.ok(check < verify,
    "the tenant check runs after the signature check, so an out-of-scope caller can still " +
    "learn whether an export verifies");

  // Denied, but recorded. A fetch from outside the caller's scope is exactly
  // the event a disclosure log exists to hold.
  assert.match(src, /export_out_of_scope/, "an out-of-scope fetch is denied silently");
  // And denied as not-found: "forbidden" would confirm the export exists.
  assert.doesNotMatch(src, /status: 403/,
    "the route answers forbidden, which confirms which export ids are real");
});

test("every path through the download route is audited", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "src", "app", "api", "exports", "[id]", "route.ts"), "utf8",
  );
  // Three outcomes reach a real record: served, out of scope, unverifiable.
  // Only the first is a disclosure, and all three are events.
  for (const type of ["export_downloaded", "export_out_of_scope", "export_signature_invalid"]) {
    assert.match(src, new RegExp(type), `the route has no audit event for ${type}`);
  }
  // A file downloaded five times by three people is a different disclosure
  // from one downloaded once, and the creation record cannot tell them apart.
  assert.ok(
    src.indexOf("export_downloaded") < src.indexOf("const manifest"),
    "the download is audited after the manifest is built, so a failure mid-build serves nothing " +
    "and records nothing",
  );
});
