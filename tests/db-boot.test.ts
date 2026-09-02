// Opening the database is all-or-nothing.
//
// THE BUG THIS EXISTS FOR, found on the deployed instance and invisible from
// inside the application.
//
// `getDb()` assigned the module-level handle on the line that OPENS the file,
// before any of the boot path had run. So a failure in any later step —
// migrations, seeding, the identity spine, the threshold seed, the population
// reconciliation — turned into a permanent, silent one: the request that hit
// it returned a 500, and every request afterwards took `if (db) return db` and
// received a database that worked. Nothing looked broken. Meanwhile every step
// AFTER the failing one never ran again for the life of the process.
//
// It masked two separate mysteries at once on the deployed demonstration. The
// planning thresholds were never seeded, so `/review/planning` answered 500 on
// an empty `policy_thresholds` — which is p34's required behaviour, arrived at
// for the wrong reason. And the population reconciliation never ran, so a
// dataset that had been stale for several waves stayed stale and its repair
// log stayed empty, reporting "no attempt recorded" because no attempt was
// ever made.
//
// The property: a boot that fails is RETRIED by the next caller, never cached.

process.env.EMDR_DATA_DIR = `/tmp/steady-boot-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "boot-test-secret-at-least-32-characters-long";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "boot-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { getDb, lastPopulationRepair } from "../src/lib/db";

const DIR = process.env.EMDR_DATA_DIR!;
const FILE = path.join(DIR, "emdr.db");

test("a boot that fails part-way is not cached as a working database", () => {
  fs.mkdirSync(DIR, { recursive: true });
  // A file that is not a database. The handle opens; the first pragma throws.
  // Chosen because it fails AFTER the line that used to publish the handle,
  // which is the whole point — a failure before it was never the problem.
  fs.writeFileSync(FILE, "not a sqlite database at all");

  assert.throws(() => getDb(), /not a database/i,
    "a corrupt database file booted without complaint");

  // The fault is removed. Under the old code the module had already published
  // the broken handle, so this call returned it and every query after it
  // failed — while the process reported itself healthy.
  fs.rmSync(FILE);
  const db = getDb();
  const persons = db.prepare("SELECT COUNT(*) AS n FROM persons").get() as { n: number };
  assert.ok(Number(persons.n) > 0, "the retry returned a database with no schema behind it");
});

test("the retry runs the WHOLE boot path, not the part before the failure", () => {
  const db = getDb();

  // The two steps that sit at the end of the boot path, and the two that were
  // silently skipped on the deployed instance. Checking the tail is what makes
  // this a guard on completeness rather than on merely having a connection.
  const thresholds = db.prepare("SELECT COUNT(*) AS n FROM policy_thresholds").get() as { n: number };
  assert.ok(Number(thresholds.n) > 0,
    "policy_thresholds is empty, so every planning rule refuses and the console answers 500");

  const repair = lastPopulationRepair(db);
  assert.ok(repair, "the population reconciliation left no record — it did not run");
  assert.equal(repair!.status, "ok",
    `the reconciliation did not complete: ${repair!.status} ${repair!.detail ?? ""}`);
});
