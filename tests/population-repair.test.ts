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
  //
  // NAMED, not inferred. This asked about every instrument that was not the
  // outcome one, which was the same set right up until a measure arrived that
  // is neither: the house function check is taken on the outcome series' own
  // dates, throughout, and correctly failed a rule about intake.
  const marks = INTAKE_INSTRUMENTS.map(() => "?").join(",");
  const afterFirstCheckin = one(
    `SELECT COUNT(*) AS n FROM screenings s
      WHERE s.user_id IN ${MARKS} AND s.instrument IN (${marks})
        AND s.created_at > (SELECT MIN(k.created_at) FROM checkins k WHERE k.user_id = s.user_id)`,
    [...POP, ...INTAKE_INSTRUMENTS]);
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

test("a failed repair is written down, not only logged", () => {
  // THE FAILURE MODE THIS EXISTS FOR. The reconciliation is best-effort by
  // design — a bad dataset must never become no demonstration at all — so it
  // catches its own exception. It then said nothing, and on the deployed
  // instance that is precisely what happened: six manifest checks failing, the
  // repair having run and thrown, and no surface anywhere connecting the two.
  // Container logs are not a surface a presenter has.
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  db.prepare(
    `INSERT INTO demo_repair (id, attempted_at, status, detail) VALUES (1, ?, 'failed', 'boom')
     ON CONFLICT(id) DO UPDATE SET status = 'failed', detail = 'boom', attempted_at = excluded.attempted_at`,
  ).run(now);

  const row = runQualityChecks(db).find((r) => r.check === "Dataset repair");
  assert.ok(row, "the manifest does not report whether the repair worked");
  assert.equal(row!.pass, false, "a failed repair passes the manifest silently");
  assert.match(row!.actual, /failed/);
  assert.match(row!.actual, /boom/, "the reason the repair failed is not shown");

  db.prepare("UPDATE demo_repair SET status = 'ok', detail = NULL WHERE id = 1").run();
  assert.equal(runQualityChecks(db).find((r) => r.check === "Dataset repair")!.pass, true);
});

test("a member with history outside the window is told that, not that they are new", async () => {
  // §30.8: an absence has to say whether it is expected. A profile whose
  // observation window closed months ago was shown "There is nothing to show
  // yet. A pattern needs a few weeks of check-ins" — the sentence written for
  // somebody who has just arrived, given to somebody with months of check-ins.
  // On the deployed demonstration that is what a presenter saw when they
  // opened the first profile in the manifest.
  const { buildMemberProgress } = await import("../src/lib/member/progress");

  const withHistory = POP.find((id) =>
    one("SELECT COUNT(*) AS n FROM checkins WHERE user_id = ?", [id]) > 5 &&
    one(`SELECT COUNT(*) AS n FROM checkins WHERE user_id = ?
          AND checkin_date >= date((SELECT MAX(checkin_date) FROM checkins), '-30 days')`, [id]) === 0);
  assert.ok(withHistory, "no profile has history that falls outside a 30-day window");

  const tenantId = (db.prepare("SELECT tenant_id AS t FROM users WHERE id = ?")
    .get(withHistory!) as { t: string }).t;
  const env = await buildMemberProgress({ userId: withHistory!, tenantId, days: 30 }) as unknown as
    { status?: string; note?: string; message?: string; data?: unknown };
  const text = JSON.stringify(env);
  assert.match(text, /No check-ins in this period/,
    "a member with months of history is told there is nothing to show yet");
  assert.doesNotMatch(text, /nothing to show yet/,
    "the new-arrival sentence is still being shown to somebody who is not one");
});

test("a dataset added to the generator later reaches a database that already has history", () => {
  // THE FAILURE THIS EXISTS FOR, and it happened twice.
  //
  // `generatePopulationHistory` short-circuits on "does the first profile have
  // a check-in". That is right for the six months of history it writes and
  // wrong for anything ADDED to the generator afterwards: a deployed database
  // already has check-ins, so the new rows never arrive. Plan versions were
  // written by the generator, verified locally, deployed — and the chart that
  // needed them was still empty on the live instance, because the only
  // database anybody looks at had been seeded before they existed.
  //
  // A reset fixes it and is the wrong tool: it deletes, it needs a human, and
  // it will be needed again for the next dataset. A later dataset gets its own
  // idempotent step instead.
  const first = popPersonId(MANIFEST[0]);
  assert.ok(one("SELECT COUNT(*) AS n FROM checkins WHERE user_id = ?", [first]) > 0,
    "the fixture is not in the state this guards — the person has no history");

  db.prepare(`DELETE FROM program_plans WHERE user_id IN ${MARKS}`).run(...POP);
  assert.equal(one(`SELECT COUNT(*) AS n FROM program_plans WHERE user_id IN ${MARKS}`, POP), 0);

  // The whole chain, exactly as a boot runs it. The history step will
  // short-circuit — that is the condition being reproduced — and the plan step
  // must not.
  populationChain(db);

  const plans = one(`SELECT COUNT(*) AS n FROM program_plans WHERE user_id IN ${MARKS}`, POP);
  assert.ok(plans >= MANIFEST.length,
    `only ${plans} plan versions for ${MANIFEST.length} people — a dataset added after the ` +
    "generator's own existence check cannot reach a database that already has history");

  // Append-only, and versioned: some people carry more than one.
  const revised = one(
    `SELECT COUNT(*) AS n FROM (SELECT user_id FROM program_plans WHERE user_id IN ${MARKS}
       GROUP BY user_id HAVING COUNT(*) > 1)`, POP);
  assert.ok(revised > 0, "nobody's plan was ever revised, so there is nothing to annotate");

  // And running it again writes nothing.
  populationChain(db);
  assert.equal(one(`SELECT COUNT(*) AS n FROM program_plans WHERE user_id IN ${MARKS}`, POP), plans,
    "the plan step is not idempotent");
});

test("the operational feeds survive the day rolling over", async () => {
  // THE BUG THIS GUARDS, found on the deployed instance the morning after the
  // per-boot reconciliation started running.
  //
  // A feed row's id comes from the site and the PERIOD INDEX, which does not
  // move. Its `period_start` comes from `demoEpoch()`, which advances every
  // day, because the dataset is authored relative to "now" so the
  // demonstration always looks current. On any later day the insert therefore
  // carried the same id and a different period_start: the conflict target did
  // not match, the insert proceeded, and the primary key rejected it. The
  // whole population chain aborted on the first site, every boot, for ever —
  // and the repair log read "UNIQUE constraint failed: capacity_slots.id".
  //
  // A bug that only appears after midnight is one no local run reproduces, so
  // the day is a parameter rather than the clock.
  const { seedOperationalFeeds } = await import("../src/lib/demo-population-seed");

  const before = one("SELECT COUNT(*) AS n FROM capacity_slots");
  assert.ok(before > 0, "there are no feeds to roll over");
  const firstStart = (db.prepare(
    "SELECT period_start AS p FROM capacity_slots ORDER BY id LIMIT 1").get() as { p: string }).p;

  // Tomorrow, and a week after that.
  for (const days of [1, 8]) {
    assert.doesNotThrow(
      () => seedOperationalFeeds(db, Date.now() + days * 86400000),
      `the feed seed threw ${days} day(s) later — every boot after midnight fails`);
  }

  assert.equal(one("SELECT COUNT(*) AS n FROM capacity_slots"), before,
    "the feed grew: a new row per day rather than the same rows re-dated");

  const afterStart = (db.prepare(
    "SELECT period_start AS p FROM capacity_slots ORDER BY id LIMIT 1").get() as { p: string }).p;
  assert.ok(afterStart > firstStart,
    `period_start stayed at ${afterStart} — the feed is not being re-dated, so it ages one ` +
    "day per day until the staleness rule refuses every site");

  // And the chain still completes, which is the thing that actually broke.
  assert.doesNotThrow(() => populationChain(db),
    "the population chain still aborts on the feed seed");
});
