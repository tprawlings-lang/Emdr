// The deployed demonstration's dataset, and the onboarding that makes it one.
//
// TWO FAILURES, FOUND ON THE DEPLOYED INSTANCE, GUARDED HERE.
//
//   THE DATASET NEVER ARRIVED.  `seed()` returns the moment any user exists,
//   which is right for accounts and wrong for a dataset. The deployment keeps a
//   persistent disk, so it seeded while only the manifest existed and every
//   wave since shipped code onto data that could not exercise it: 240 profiles
//   with zero check-ins, zero measures, zero modules and zero accounts between
//   them.
//
//   THE PROFILES COULD NOT SIGN IN.  `/app/today` refuses a member on four
//   gates — membership, informed consent, the five-instrument screening
//   battery, a completed profile — and the 240 passed one. A presenter signing
//   in as any of them landed on the paywall.
//
// The repair for the first must be ADDITIVE: it runs unattended on every boot,
// and a rebuild-on-boot is a deployment that can destroy data while nobody is
// watching.

process.env.EMDR_DATA_DIR = `/tmp/steady-repair-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "repair-test-secret-at-least-32-characters-long";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "repair-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import type Database from "better-sqlite3";
import { getDb, populationChain } from "../src/lib/db";
import { runQualityChecks } from "../src/lib/demo-quality";
import { MANIFEST } from "../src/lib/demo-population-manifest";
import { popPersonId } from "../src/lib/demo-population-seed";
import { OUTCOME_INSTRUMENT, INTAKE_INSTRUMENTS } from "../src/lib/demo-population-generator";
import { subscriptionActive } from "../src/lib/billing";
import { hasConsent, screeningComplete } from "../src/lib/gating";
import { profileComplete } from "../src/lib/profile";

let db: Database.Database;
const POP = MANIFEST.map((r) => popPersonId(r));
const MARKS = `(${POP.map(() => "?").join(",")})`;
const one = (sql: string, params: unknown[] = []) =>
  Number((db.prepare(sql).get(...params) as { n: number }).n);

test("setup", () => {
  db = getDb();
  assert.equal(one(`SELECT COUNT(*) AS n FROM users WHERE id IN ${MARKS}`, POP), 240);
});

// ---------------------------------------------------------------------------
// Onboarding — the four gates
// ---------------------------------------------------------------------------

test("every one of the 240 can actually sign in and reach the product", async () => {
  // The gate list is /app/today's, in its order. This is the whole point of a
  // demonstration population: a profile a presenter cannot open is a row, not
  // a person.
  const blocked: string[] = [];
  for (const id of POP) {
    const failed = [
      !(await subscriptionActive(id)) && "membership",
      !(await hasConsent(id)) && "consent",
      !(await screeningComplete(id)) && "screening",
      !(await profileComplete(id)) && "profile",
    ].filter(Boolean);
    if (failed.length) blocked.push(`${id}: ${failed.join(", ")}`);
  }
  assert.deepEqual(blocked.slice(0, 5), [], `${blocked.length} of 240 cannot reach /app/today`);
});

test("the intake battery is complete, and dated at enrolment rather than today", () => {
  for (const instrument of INTAKE_INSTRUMENTS) {
    assert.equal(
      one(`SELECT COUNT(*) AS n FROM screenings WHERE user_id IN ${MARKS} AND instrument = ?`,
        [...POP, instrument]),
      240, `${instrument} is not on file for all 240`);
  }
  // An intake taken "today" for somebody who enrolled five months ago is a
  // person who signed up this morning with five months of history behind them.
  const afterFirstCheckin = one(
    `SELECT COUNT(*) AS n FROM screenings s
      WHERE s.user_id IN ${MARKS} AND s.instrument <> ?
        AND s.created_at > (SELECT MIN(k.created_at) FROM checkins k WHERE k.user_id = s.user_id)`,
    [...POP, OUTCOME_INSTRUMENT]);
  assert.equal(afterFirstCheckin, 0, "an intake instrument is dated after the person's first check-in");
});

test("an intake score sits on its own instrument's scale, not the outcome one", () => {
  // Drawing every instrument against the PHQ-9's ceiling would put a 19 on a
  // PC-PTSD-5 whose maximum is 5 — a number no clinician could read.
  const overscale = db.prepare(
    `SELECT instrument, MAX(total_score) AS worst FROM screenings
      WHERE user_id IN ${MARKS} GROUP BY instrument`).all(...POP) as
    { instrument: string; worst: number }[];
  const CEILING: Record<string, number> = {
    "phq-9": 27, "gad-7": 21, "pcl-5": 80, "itq": 24, "pc-ptsd-5": 5,
  };
  for (const r of overscale) {
    const max = CEILING[r.instrument];
    if (max === undefined) continue;
    assert.ok(r.worst <= max, `${r.instrument} scored ${r.worst} against a maximum of ${max}`);
  }
});

// ---------------------------------------------------------------------------
// The outcome instrument
// ---------------------------------------------------------------------------

test("a reported trend compares one instrument against itself", async () => {
  // THE DEFECT THIS CAUGHT, live on the deployed demonstration: a member whose
  // panel row read "5 → 16". Five was a PC-PTSD-5 total, whose maximum IS
  // five; sixteen was a PHQ-9. The queries took the first and last row of the
  // screenings table whatever they were, so the console reported the distance
  // between two different instruments as a change in that person.
  const { buildClinicianPanel } = await import("../src/lib/clinical/panel");
  const tenant = (db.prepare(
    "SELECT tenant_id AS t FROM users WHERE email = 'clinician.demo@steady.local'",
  ).get() as { t: string }).t;
  const env = await buildClinicianPanel(tenant) as unknown as {
    data?: { rows: Array<{ personId: string; baseline: number | null; latest: number | null }> };
    rows?: Array<{ personId: string; baseline: number | null; latest: number | null }>;
  };
  const rows = env.data?.rows ?? env.rows ?? [];
  assert.ok(rows.length > 0, "no panel rows to check");

  let checked = 0;
  for (const r of rows) {
    if (r.baseline === null) continue;
    const series = (db.prepare(
      `SELECT total_score AS s FROM screenings WHERE user_id = ? AND instrument = ?
        ORDER BY created_at`).all(r.personId, OUTCOME_INSTRUMENT) as { s: number }[]).map((x) => x.s);
    if (series.length === 0) continue;
    assert.equal(r.baseline, series[0],
      `the panel's baseline is not this person's first ${OUTCOME_INSTRUMENT}`);
    assert.equal(r.latest, series[series.length - 1],
      `the panel's latest is not this person's most recent ${OUTCOME_INSTRUMENT}`);
    checked += 1;
  }
  assert.ok(checked > 0, "no person had an outcome series — the guard tested nothing");
});

// ---------------------------------------------------------------------------
// The boot repair
// ---------------------------------------------------------------------------

test("a database in the deployed instance's shape repairs itself, additively", () => {
  // Reproduces exactly what was found on the deploy: the profiles are there,
  // none of their history is, and no account exists for any of them.
  const real = "repair-real-person";
  db.pragma("foreign_keys = OFF");
  const strip = db.transaction(() => {
    for (const t of ["checkins", "screenings", "practice_completions", "therapy_sessions",
      "longitudinal_events", "consents", "subscriptions", "user_profiles"]) {
      db.prepare(`DELETE FROM ${t} WHERE user_id IN ${MARKS}`.replace(
        "user_id", t === "longitudinal_events" ? "person_id" : "user_id")).run(...POP);
    }
    db.prepare(`DELETE FROM users WHERE id IN ${MARKS}`).run(...POP);
    // A REAL person, present throughout. The repair must not touch them.
    db.prepare(`INSERT INTO users (id, email, name, role, password_hash)
                VALUES (?, 'repair@real.example', 'A Person', 'member', 'x')`).run(real);
    db.prepare(`INSERT INTO persons (id, tenant_id, display_name, provenance)
                VALUES (?, '00000000000000000000000000000000', 'A Person', 'real')`).run(real);
    db.prepare(`INSERT INTO checkins (id, user_id, checkin_date, activation, shutdown, harm_urge,
                  feels_safe, dissociation, sleep_quality, substance_flag, recommended_action)
                VALUES ('repair-real-ci', ?, '2026-09-01', 4, 2, 0, 1, 1, 7, 0, 'steady')`).run(real);
  });
  strip();
  db.pragma("foreign_keys = ON");
  assert.equal(one(`SELECT COUNT(*) AS n FROM checkins WHERE user_id IN ${MARKS}`, POP), 0,
    "the strip did not reproduce the deployed shape");

  populationChain(db);

  assert.ok(one(`SELECT COUNT(*) AS n FROM checkins WHERE user_id IN ${MARKS}`, POP) > 1000,
    "the repair did not restore the population's history");
  assert.equal(one(`SELECT COUNT(*) AS n FROM users WHERE id IN ${MARKS}`, POP), 240,
    "the repair did not restore the 240 accounts");

  // THE PROPERTY THAT MATTERS MOST. This runs unattended on every boot.
  assert.equal(one("SELECT COUNT(*) AS n FROM checkins WHERE user_id = ?", [real]), 1,
    "the boot repair destroyed a real person's data");
  assert.equal(
    (db.prepare("SELECT provenance AS p FROM persons WHERE id = ?").get(real) as { p: string }).p,
    "real", "the repair relabelled a real person");

  const q = runQualityChecks(db);
  const failed = q.filter((r) => !r.pass);
  assert.deepEqual(failed.map((f) => f.check), [],
    `the repaired dataset does not pass its own manifest: ${JSON.stringify(failed)}`);
});

test("the repair writes nothing on a database that already has its population", () => {
  const before = ["checkins", "screenings", "practice_completions", "longitudinal_events",
    "users", "subscriptions", "user_profiles", "consents"]
    .map((t) => [t, one(`SELECT COUNT(*) AS n FROM ${t}`)] as const);
  populationChain(db);
  for (const [t, n] of before) {
    assert.equal(one(`SELECT COUNT(*) AS n FROM ${t}`), n, `the repair rewrote ${t}`);
  }
});
