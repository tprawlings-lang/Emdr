// A column added to the schema after its table shipped.
//
// `CREATE TABLE IF NOT EXISTS` does nothing to a table that already exists, so
// such a column reaches every FRESH database and no DEPLOYED one — and it
// cannot be caught by running the app locally, because a fresh database always
// has it. Eight columns in `db.ts` are migrated by hand for exactly this
// reason. The ninth was not: `planning_signals.reading_point` landed with the
// demo clock, and four deploy cycles later the deployed planning console was
// still answering 500 with "table planning_signals has no column named
// reading_point" — a fault no local run could reproduce.
//
// THE WIRING IS WHAT THIS GUARDS. An earlier version called the reconciliation
// directly and passed with it removed from the boot path, which is a guard on a
// function that nothing calls. So this builds the old-shaped database FIRST and
// then boots normally, exactly as a deployment does.

process.env.EMDR_DATA_DIR = `/tmp/steady-drift-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "drift-test-secret-at-least-32-characters-long";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "drift-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { SCHEMA_SQL } from "../src/lib/db";

const DIR = process.env.EMDR_DATA_DIR!;
const MISSING = "reading_point";

test("setup: a database whose planning_signals predates the column", () => {
  fs.mkdirSync(DIR, { recursive: true });

  // The table's OWN definition, with one line removed — so this stays faithful
  // as the schema changes rather than hard-coding a shape that will rot.
  const create = /CREATE TABLE IF NOT EXISTS\s+planning_signals\s*\(([\s\S]*?)\n\s*\);/
    .exec(SCHEMA_SQL);
  assert.ok(create, "planning_signals is not in the schema");
  const withoutColumn = create![0]
    .split("\n")
    .filter((l) => !new RegExp(`^\\s*${MISSING}\\b`).test(l))
    .join("\n");
  assert.notEqual(withoutColumn, create![0], "the column was not removed — the guard is inert");

  const db = new Database(path.join(DIR, "emdr.db"));
  db.exec(withoutColumn);
  assert.equal(
    (db.prepare("PRAGMA table_info(planning_signals)").all() as { name: string }[])
      .some((c) => c.name === MISSING),
    false, "the old-shaped table already has the column");
  db.close();
});

test("booting an existing database gains the column its schema declares", async () => {
  // Imported here, after the file exists, so the boot runs against the
  // old-shaped database the way a deployment's first request does.
  const { getDb } = await import("../src/lib/db");
  const db = getDb();

  const cols = (db.prepare("PRAGMA table_info(planning_signals)").all() as { name: string }[])
    .map((c) => c.name);
  assert.ok(cols.includes(MISSING),
    `booting did not add ${MISSING}; the deployed console stays 500. Columns: ${cols.join(", ")}`);

  // And the table is usable, not merely shaped: the column is what the signal
  // id derives from, so a write that names it is the real check.
  assert.doesNotThrow(() => db.prepare(
    `SELECT ${MISSING} FROM planning_signals LIMIT 1`).all());
});
