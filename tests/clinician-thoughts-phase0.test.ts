// Clinician Thoughts — Phase 0, the architecture gate.
//
// The phase has four definitions of done, and three of them are checkable here:
//
//   "No code path can accidentally call a model provider directly."
//       — tests/ai-gateway.test.ts owns that one.
//   "Schema plan is mirrored for SQLite and Postgres."
//   "Feature flag names exist."
//
// plus the gate's own build items: the tables registered in the schema guards,
// and an audio retention default decided rather than left to a column's
// placeholder.
//
// The parity test is the one worth the effort. A Postgres mirror is written
// once, by hand, at the moment the SQLite schema is written — and then the two
// drift, silently, because nothing in a SQLite-backed test run ever reads the
// .sql file. §19 lists "Postgres schema parity" as a required database test for
// exactly this reason.

process.env.EMDR_DATA_DIR = `/tmp/steady-thoughts-p0-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "phase0-test-secret-at-least-32-characters-long";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "phase0-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { getDb, TENANT_SCOPED_TABLES, SCHEMA_SQL } from "../src/lib/db";
import { DEMO_DATA_TABLES } from "../src/lib/demo-reset";
import {
  THOUGHTS_FLAGS, thoughtsFlagEnabled, thoughtsSurfaceAvailable, thoughtsFlagRequires,
  DEFAULT_AUDIO_RETENTION, DEMO_AUDIO_RETENTION,
  type ThoughtsFlag,
} from "../src/lib/clinical/thoughts-flags";

const db = getDb();
const PG = fs.readFileSync(path.join(process.cwd(), "scripts/pg-schema.sql"), "utf8");

/** §6's seven tables. Named here rather than derived, so a table quietly
 *  dropped from the schema fails this file instead of shrinking its coverage. */
const TABLES = [
  "clinician_thoughts",
  "clinician_thought_transcripts",
  "clinical_memory_items",
  "clinical_threads",
  "clinical_thread_memberships",
  "clinical_inferences",
  "clinical_inference_evidence",
  "clinical_retrieval_documents",
] as const;

function sqliteColumns(table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .map((c) => c.name).sort();
}

/** Columns of one CREATE TABLE block in the Postgres file.
 *
 *  Paren depth is tracked because a multi-line CHECK constraint puts its
 *  continuation lines at the same indentation as a column, and reading the
 *  first word of each line turns `status IN ('capturing', …)` into a second
 *  column called "status". The first version did exactly that and reported
 *  drift where there was none — a false alarm is how a parity test gets
 *  disabled. Only a line beginning at depth zero starts a definition. */
function pgColumns(table: string): string[] {
  const m = PG.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`));
  if (!m) return [];
  const out: string[] = [];
  let depth = 0;
  for (const raw of m[1].split("\n")) {
    const line = raw.trim();
    const atTop = depth === 0;
    for (const ch of line) {
      if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
    }
    if (!atTop || !line || line.startsWith("--")) continue;
    // Split on "(" as well as whitespace: a table-level `UNIQUE(a, b)` has no
    // space before its paren, so a whitespace-only split yields the keyword and
    // the first key glued together and slips past the keyword filter below.
    const name = line.split(/[\s(]+/)[0].replace(/,$/, "");
    if (/^(PRIMARY|UNIQUE|CHECK|FOREIGN|CONSTRAINT|EXCLUDE)$/i.test(name)) continue;
    out.push(name);
  }
  return out.sort();
}

test("every §6 table exists after boot", () => {
  for (const t of TABLES) {
    assert.doesNotThrow(() => db.prepare(`SELECT 1 FROM ${t} LIMIT 1`).get(),
      `${t} is not in the booted schema`);
  }
});

test("SQLite and Postgres declare the same columns", () => {
  // Phase 0 DoD: "Schema plan is mirrored for SQLite and Postgres."
  for (const t of TABLES) {
    const sqlite = sqliteColumns(t);
    const pg = pgColumns(t);
    assert.ok(pg.length > 0, `${t} is missing from scripts/pg-schema.sql entirely`);
    assert.deepEqual(pg, sqlite,
      `${t} has drifted between the two schemas.\n  sqlite: ${sqlite.join(", ")}\n  pg:     ${pg.join(", ")}`);
  }
});

test("every patient-bound table is tenant-scoped", () => {
  // §6.2: "Every durable patient-bound row carries tenant_id and person_id."
  // The join table is the stated exception and is checked as one rather than
  // skipped, so removing its exemption fails rather than silently passing.
  for (const t of TABLES) {
    const cols = sqliteColumns(t);
    if (t === "clinical_inference_evidence") {
      assert.ok(!cols.includes("tenant_id"),
        "the join table grew a tenant_id nothing sets — the RLS loop would count a protection that is not enforced");
      assert.ok(!TENANT_SCOPED_TABLES.includes(t as never));
      continue;
    }
    assert.ok(cols.includes("tenant_id"), `${t} has no tenant_id`);
    assert.ok(cols.includes("person_id"), `${t} has no person_id`);
    // The repository's scoping and the schema guard both work off this list, so
    // a table missing from it is a table nothing is checking.
    assert.ok((TENANT_SCOPED_TABLES as readonly string[]).includes(t),
      `${t} is not in TENANT_SCOPED_TABLES`);
  }
});

test("the Postgres RLS loop covers the new tables without an edit", () => {
  // It enumerates the catalog for any table with a tenant_id column rather than
  // reading a hardcoded list. This asserts the mechanism, because a mirror that
  // needed a second hand-kept list would drift in a second way.
  assert.match(PG, /a\.attname = 'tenant_id'/,
    "the policy loop no longer selects tables by their tenant_id column");
});

test("a reset clears the clinician thinking layer", () => {
  // A reset that left recorded thoughts behind would leave the environment
  // holding clinical text about fabricated people who no longer exist.
  for (const t of TABLES) {
    assert.ok((DEMO_DATA_TABLES as readonly string[]).includes(t),
      `${t} survives a demo reset`);
  }
  // And in an order that does not orphan: each table must be listed before
  // anything it references.
  const order = (t: string) => (DEMO_DATA_TABLES as readonly string[]).indexOf(t);
  const references: Array<[string, string]> = [
    ["clinical_inference_evidence", "clinical_inferences"],
    ["clinical_thread_memberships", "clinical_threads"],
    ["clinical_thread_memberships", "clinical_memory_items"],
    ["clinician_thought_transcripts", "clinician_thoughts"],
  ];
  for (const [child, parent] of references) {
    assert.ok(order(child) < order(parent),
      `${child} is cleared after ${parent}, which orphans it`);
  }
});

test("statement class is a constrained column, not a phrasing", () => {
  // §4's rule, and ADR 0014's central decision: a hypothesis is a different
  // KIND of record from an observation, so nothing downstream can promote one
  // by rewording it.
  const sql = SCHEMA_SQL;
  assert.match(sql, /statement_class TEXT NOT NULL CHECK/);
  for (const c of ["clinician_observation", "patient_report", "clinician_hypothesis", "clinician_uncertainty"]) {
    assert.ok(sql.includes(c), `the statement_class check does not allow ${c}`);
  }
  // Enforced by the database, not by intention.
  assert.throws(() => {
    db.prepare(
      `INSERT INTO clinical_memory_items
         (id, tenant_id, person_id, item_type, statement_class, display_text, status)
       VALUES ('t1', 't', 'p', 'observation', 'fact', 'x', 'candidate')`
    ).run();
  }, /CHECK constraint failed|FOREIGN KEY/,
    "a statement class outside the four was accepted");
});

test("a model may propose and only a person may accept", () => {
  // Phase 3's definition of done is "no auto-link in v1", and it is a schema
  // property: proposal and decision are different columns, so an accepted
  // membership always names who accepted it.
  const cols = sqliteColumns("clinical_thread_memberships");
  assert.ok(cols.includes("proposed_by"));
  assert.ok(cols.includes("decided_by"));
  assert.match(SCHEMA_SQL, /proposed_by TEXT NOT NULL CHECK \(proposed_by IN \('clinician','model','system'\)\)/);
});

// ── Feature flags (§22) ─────────────────────────────────────────────────────

test("the six flag names exist, and outside demo every one defaults off", () => {
  assert.equal(THOUGHTS_FLAGS.length, 6);
  const demo = process.env.EMDR_DEMO;
  delete process.env.EMDR_DEMO;
  try {
    for (const f of THOUGHTS_FLAGS) {
      delete process.env[f];
      assert.equal(thoughtsFlagEnabled(f), false, `${f} is on with nothing set`);
    }
  } finally { if (demo) process.env.EMDR_DEMO = demo; }
});

/** The phases that actually exist. This list is the test's whole point: it is
 *  updated when a phase LANDS, so a flag turned on ahead of its
 *  implementation fails here rather than in front of a reviewer. */
const BUILT: ThoughtsFlag[] = ["CLINICIAN_THOUGHTS_CAPTURE", "CLINICIAN_THOUGHTS_EXTRACTION"];

test("demo enables exactly the phases that are built", () => {
  // The same reasoning that turned on resourcing BLS in demo: a reviewer who
  // cannot run the workflow cannot give feedback on it, and unusable-by-default
  // is not a safety property when the data is fabricated.
  //
  // The rule is a BICONDITIONAL, and both halves matter. A built phase left
  // dark is the flagship workstream a clinical reviewer cannot exercise. An
  // unbuilt phase turned on is a surface with nothing behind it, and the
  // reviewer concludes "this is broken" rather than "this is not finished".
  process.env.EMDR_DEMO = "1";
  for (const f of THOUGHTS_FLAGS) delete process.env[f];

  for (const f of BUILT) {
    assert.equal(thoughtsFlagEnabled(f), true,
      `${f} is dark in the one environment built for clinical review, and the phase behind it exists`);
  }
  for (const f of THOUGHTS_FLAGS.filter((x) => !BUILT.includes(x))) {
    assert.equal(thoughtsFlagEnabled(f), false,
      `${f} is on in demo, but the phase behind it is not built`);
  }
});

test("an explicit 0 forces a flag off, even in demo", () => {
  // How the refusal path gets demonstrated: a presenter showing what a
  // clinician sees when the feature is not available to them.
  process.env.EMDR_DEMO = "1";
  process.env.CLINICIAN_THOUGHTS_CAPTURE = "0";
  assert.equal(thoughtsFlagEnabled("CLINICIAN_THOUGHTS_CAPTURE"), false,
    "demo overrides an explicit off, so the refusal path cannot be shown");
  assert.equal(thoughtsSurfaceAvailable("CLINICIAN_THOUGHTS_CAPTURE"), false);
  delete process.env.CLINICIAN_THOUGHTS_CAPTURE;
});

test("a downstream surface cannot open over a closed one", () => {
  // §22: "Do not expose a disabled downstream surface just because data for it
  // already exists." A rollout is exactly when somebody enables the interesting
  // flag first.
  for (const f of THOUGHTS_FLAGS) delete process.env[f];
  // Closed EXPLICITLY, not by absence. Demo turns capture on by default now, so
  // an unset flag is no longer a closed one — and a fixture that means to close
  // something has to say so, or it silently stops testing what it says.
  process.env.CLINICIAN_THOUGHTS_CAPTURE = "0";
  process.env.CLINICIAN_SESSION_PREP = "1";
  assert.equal(thoughtsSurfaceAvailable("CLINICIAN_SESSION_PREP"), false,
    "Session Prep opened with extraction and capture both off");

  process.env.CLINICIAN_THOUGHTS_EXTRACTION = "1";
  assert.equal(thoughtsSurfaceAvailable("CLINICIAN_SESSION_PREP"), false,
    "Session Prep opened with capture off");

  process.env.CLINICIAN_THOUGHTS_CAPTURE = "1";
  assert.equal(thoughtsSurfaceAvailable("CLINICIAN_SESSION_PREP"), true);

  // Capture is the root and rests on nothing.
  assert.equal(thoughtsFlagRequires("CLINICIAN_THOUGHTS_CAPTURE"), null);
  for (const f of THOUGHTS_FLAGS) delete process.env[f];
});

test("a flag is read at call time, not at module load", () => {
  // A flag captured into a constant when the module first loads cannot be
  // turned off without a redeploy. This codebase has shipped that bug before.
  const f: ThoughtsFlag = "CLINICIAN_THREADS";
  delete process.env[f];
  assert.equal(thoughtsFlagEnabled(f), false);
  process.env[f] = "1";
  assert.equal(thoughtsFlagEnabled(f), true, "the flag was captured at load");
  delete process.env[f];
  assert.equal(thoughtsFlagEnabled(f), false);
});

test("audio defaults to deletion, in demo and production alike", () => {
  // The decision Phase 0 asks for. "Keep it" as a default means an
  // organization acquires an audio archive of its clinicians by never making a
  // decision.
  assert.equal(DEFAULT_AUDIO_RETENTION, "delete_after_verified_transcript");
  assert.equal(DEMO_AUDIO_RETENTION, "delete_after_verified_transcript",
    "demo retention differs from production, which teaches a reviewer the wrong thing");
  // And the column agrees, rather than defaulting to the spec's placeholder.
  assert.match(SCHEMA_SQL,
    /audio_retention_policy TEXT NOT NULL DEFAULT 'delete_after_verified_transcript'/);
  assert.match(PG,
    /audio_retention_policy text NOT NULL DEFAULT 'delete_after_verified_transcript'/);
});
