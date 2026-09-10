// A deployed database must be able to reach every state the machine defines.
//
// THIS IS THE BUG IT GUARDS, and it stranded a clinician's words. §8.1 sends a
// thought whose transcript succeeded and whose organization failed to
// `review_transcript_only`, and §17.4 writes the copy: "Your transcript is
// safe. Steady could not organize it yet." The schema in db.ts has always
// listed that state.
//
// A database CREATED BEFORE IT WAS ADDED had not, because CREATE TABLE IF NOT
// EXISTS is a no-op on an existing table and SQLite cannot alter a CHECK in
// place. So the transition threw, the caller's catch swallowed it, and the
// thought sat in `processing` behind a spinner forever — the precise outcome
// the state exists to prevent.
//
// It was invisible for two reasons worth naming. The fixture extractor always
// succeeds, so no demo ever took the failing branch. And the existing drift
// test checks COLUMNS, which is the drift that had bitten before; a CHECK
// constraint is drift too, and nothing was looking at it.
//
// So this builds the old-shaped table first and boots normally, exactly as a
// deployment does — the same shape as db-schema-drift.test.ts, for the same
// reason its own comment gives: a guard that calls the migration directly
// passes with the migration removed from the boot path.

process.env.EMDR_DATA_DIR = `/tmp/steady-statusdrift-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "statusdrift-test-secret-at-least-32-characters";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "statusdrift-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const DIR = process.env.EMDR_DATA_DIR as string;
fs.mkdirSync(DIR, { recursive: true });

// The table as it existed before `review_transcript_only` was a state, written
// straight to disk so the boot below sees a genuinely old database.
const OLD_TABLE = `
  CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS persons (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, display_name TEXT,
    provenance TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS clinician_thoughts (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    person_id TEXT NOT NULL REFERENCES persons(id),
    clinician_person_id TEXT NOT NULL REFERENCES persons(id),
    status TEXT NOT NULL CHECK (
      status IN ('capturing','processing','review','saved','discarded','failed')
    ),
    audio_storage_key TEXT,
    audio_retention_policy TEXT NOT NULL DEFAULT 'delete_after_verified_transcript',
    audio_deleted_at TEXT,
    current_transcript_id TEXT,
    source_session_id TEXT,
    recorded_at TEXT NOT NULL,
    saved_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

// emdr.db, which is the name db.ts actually opens. The first version of this
// test wrote to "steady.db"; the app never saw it, created a fresh database
// alongside, and every assertion passed against a table the test had not
// touched. A fixture the code under test ignores is a test of nothing.
const DB_PATH = path.join(DIR, "emdr.db");
{
  const old = new Database(DB_PATH);
  old.exec(OLD_TABLE);
  old.prepare("INSERT INTO tenants (id, kind, name) VALUES ('t1','organization','T')").run();
  for (const id of ["p1", "c1"]) {
    old.prepare("INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES (?, 't1', 'X', 'fabricated')").run(id);
  }
  // A thought written under the OLD constraint, so the migration has to carry
  // real rows across rather than only succeeding on an empty table.
  old.prepare(
    `INSERT INTO clinician_thoughts
       (id, tenant_id, person_id, clinician_person_id, status, recorded_at)
     VALUES ('th-old','t1','p1','c1','processing','2026-01-01T00:00:00.000Z')`
  ).run();
  old.close();
}

// Boot normally. This is the wiring the guard is really about — a guard that
// called the migration directly would pass with it removed from the boot path.
import { getDb } from "../src/lib/db";
import { THOUGHT_STATUSES } from "../src/lib/clinical/thoughts";

const db = getDb();

test("the deployed table admits every state the machine can produce", () => {
  const sql = (db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='clinician_thoughts'"
  ).get() as { sql: string }).sql;

  const missing = THOUGHT_STATUSES.filter((s) => !sql.includes(`'${s}'`));
  assert.deepEqual(missing, [],
    `the deployed CHECK constraint cannot hold: ${missing.join(", ")}. ` +
    "A state the machine can reach and the table refuses strands the thought there.");
});

test("the migration carried the existing rows across", () => {
  const row = db.prepare("SELECT id, status FROM clinician_thoughts WHERE id = 'th-old'").get() as
    | { id: string; status: string } | undefined;
  assert.ok(row, "a rebuild that drops rows is a rebuild that loses clinical records");
  assert.equal(row.status, "processing");
});

test("a thought can actually reach review_transcript_only on this database", () => {
  // The end-to-end version: not "the constraint contains the word" but "the
  // write succeeds", which is what the clinician's path depends on.
  db.prepare("UPDATE clinician_thoughts SET status = 'review_transcript_only' WHERE id = 'th-old'").run();
  const after = db.prepare("SELECT status FROM clinician_thoughts WHERE id = 'th-old'").get() as { status: string };
  assert.equal(after.status, "review_transcript_only");
});

test("the index survived the rebuild", () => {
  const idx = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_thoughts_person_time'"
  ).get();
  assert.ok(idx, "dropping the table drops its indexes; a rebuild that forgets them leaves the read path slow and nobody notices until it is");
});
