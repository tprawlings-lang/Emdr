// The agent behaviour layer (handoff 07 — the reserved tail of the calendar).
//
// The generator WRITES rows. This layer LIVES days: for the last fortnight of
// the calendar it asks each fabricated person what they want to do and puts
// that through the product's own machinery — the check-in routing rule and the
// safety gate engine — recording what came back, including the refusals.
//
// So the properties worth guarding are not "the numbers look plausible". They
// are:
//
//   THE LEASH      An agent acts only for a fabricated person. Ever.
//   THE REAL GATE  The decisions are the product's own, not a copy that
//                  happens to agree today.
//   THE TRACE      A restriction the engine issued is written down, and a
//                  configuration that was never about the person is not
//                  written down as though it were.
//   THE TAIL       The agents write inside their own window and nowhere else.
//   REPLAYABILITY  A second run changes nothing.

process.env.EMDR_DATA_DIR = `/tmp/steady-agents-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "agent-test-secret-at-least-32-characters-long";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "agent-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { getDb } from "../src/lib/db";
import { runAgents } from "../src/lib/agents/runner";
import { intentFor } from "../src/lib/agents/policy";
import { evaluateCheckin } from "../src/lib/gating";
import { evaluateAccess } from "../src/lib/safety/engine";
import { AccessTier } from "../src/lib/safety/types";
import { MANIFEST, seedFor } from "../src/lib/demo-population-manifest";
import { popPersonId } from "../src/lib/demo-population-seed";
import { accessProfileFor } from "../src/lib/demo-population-disparity";
import {
  AGENT_HORIZON, CALENDAR_DAYS, GENERATED_DAYS, demoEpoch, exposureDaysFor, generatedDaysFor,
} from "../src/lib/demo-population-calendar";

const src = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const dayDate = (day: number) =>
  new Date(demoEpoch().getTime() + day * 86400000).toISOString().slice(0, 10);

let db: Database.Database;
const POP = MANIFEST.map((r) => popPersonId(r));
const MARKS = `(${POP.map(() => "?").join(",")})`;
const AGENT_OPENS = dayDate(GENERATED_DAYS);

const all = <T>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...params) as T[];
const one = (sql: string, params: unknown[] = []) =>
  Number((db.prepare(sql).get(...params) as { n: number }).n);

test("setup: a seeded population whose tail has been lived", () => {
  db = getDb();
  // Scoped to the manifest's 240. The demonstration database holds other
  // fabricated people too — the login accounts, the replay scenarios — and
  // this layer has nothing to do with them.
  assert.equal(
    one(`SELECT COUNT(*) AS n FROM persons WHERE provenance = 'fabricated' AND id IN ${MARKS}`, POP),
    240);
  assert.ok(
    one("SELECT COUNT(*) AS n FROM checkins WHERE id LIKE 'agent-checkin-%'") > 0,
    "the agents ran at boot",
  );
});

// ---------------------------------------------------------------------------
// The leash
// ---------------------------------------------------------------------------

test("an agent will not act for a person who is not fabricated", () => {
  // THE ONE RULE THAT CANNOT BEND. Everything an agent writes is fiction, and
  // fiction in a real person's record is the harm this whole boundary exists
  // to prevent. The database triggers stop it too; this is the guard at the
  // gate, and a locked door is not a reason to leave the gate open.
  const victim = popPersonId(MANIFEST[0]);
  const before = one("SELECT COUNT(*) AS n FROM checkins WHERE user_id = ?", [victim]);

  // Flip one person to 'real' by the only route that exists — the immutability
  // trigger refuses an UPDATE, so this reaches around it deliberately, which is
  // the point: even if provenance were somehow wrong, the agent still refuses.
  db.exec("DROP TRIGGER IF EXISTS persons_provenance_immutable");
  db.prepare("UPDATE persons SET provenance = 'real' WHERE id = ?").run(victim);

  try {
    const out = runAgents(db);
    assert.equal(out.skippedNotFabricated, 1, "the agent acted for a real person");
    assert.equal(
      one("SELECT COUNT(*) AS n FROM checkins WHERE user_id = ?", [victim]), before,
      "not one row was written for them",
    );
  } finally {
    db.prepare("UPDATE persons SET provenance = 'fabricated' WHERE id = ?").run(victim);
  }
});

test("the leash is checked before anything is written, not after", () => {
  // A guard that runs after the inserts is not a guard, it is a report. The
  // provenance read has to precede the day loop in the source.
  const text = src("src/lib/agents/runner.ts");
  const check = text.indexOf('p.provenance !== "fabricated"');
  const firstWrite = text.indexOf("liveOneDay({");
  assert.ok(check > 0 && firstWrite > 0);
  assert.ok(check < firstWrite, "the provenance check does not precede the writes");
});

// ---------------------------------------------------------------------------
// The real gate, not a copy of it
// ---------------------------------------------------------------------------

test("every agent check-in carries the routing the product's own rule returns", () => {
  // If somebody forks a relaxed routing path for the demo, this population
  // routes differently and the guard fails on the same commit — rather than
  // the demo quietly showing a safer product than the one that ships.
  const rows = all<{
    id: string; recommended_action: string; activation: number; shutdown: number;
    harm_urge: number; feels_safe: number; dissociation: number; sleep_quality: number;
    substance_flag: number;
  }>(`SELECT id, recommended_action, activation, shutdown, harm_urge, feels_safe,
             dissociation, sleep_quality, substance_flag
        FROM checkins WHERE id LIKE 'agent-checkin-%'`);
  assert.ok(rows.length > 100, `only ${rows.length} agent check-ins to check`);

  for (const r of rows) {
    const expected = evaluateCheckin({
      activation: r.activation, shutdown: r.shutdown,
      harm_urge: !!r.harm_urge, feels_safe: !!r.feels_safe,
      dissociation: r.dissociation, sleep_quality: r.sleep_quality,
      substance_flag: !!r.substance_flag,
    });
    assert.equal(r.recommended_action, expected,
      `${r.id} stored "${r.recommended_action}" where the routing rule says "${expected}"`);
  }
});

test("a recorded restriction matches what the gate engine returns for that day", () => {
  // The stored tier is re-derived from the stored check-in through the real
  // engine. A restriction the agents invented, or one they recorded at the
  // wrong ceiling, fails here.
  const events = all<{ person_id: string; payload: string; occurred_at: string }>(
    `SELECT person_id, payload, occurred_at FROM longitudinal_events
      WHERE id LIKE 'agent-restricted-%'`);
  assert.ok(events.length > 0, "no restrictions were recorded at all");

  for (const e of events) {
    const p = JSON.parse(e.payload) as { tier: string; rules: string[] };
    const date = e.occurred_at.slice(0, 10);
    const c = db.prepare(
      `SELECT activation, shutdown, harm_urge, feels_safe, dissociation, sleep_quality,
              substance_flag FROM checkins WHERE user_id = ? AND checkin_date = ?`,
    ).get(e.person_id, date) as Record<string, number> | undefined;
    assert.ok(c, `a restriction on ${date} with no check-in behind it`);
    const decision = evaluateAccess({
      nowMs: new Date(`${date}T09:00:00Z`).getTime(),
      dailyCheckin: {
        activation: c!.activation, shutdown: c!.shutdown, dissociation: c!.dissociation,
        sleepQuality: c!.sleep_quality, harmUrge: !!c!.harm_urge,
        feelsSafe: !!c!.feels_safe, substanceFlag: !!c!.substance_flag,
      },
    });
    assert.equal(p.tier, decision.tierLabel, `stored tier disagrees with the engine on ${date}`);
    assert.ok(decision.tier < AccessTier.STEADY, "a restriction was recorded for an open day");
    assert.deepEqual(p.rules, decision.hits.map((h) => h.id));
  }
});

test("every day the gate lowered the ceiling left a trace", () => {
  // The failure this exists for: for a while only the handful of restricted
  // days where the person ALSO happened to request a session were written
  // down. Twenty-five restricted days were recorded as three, and a clinician
  // could not see that the engine had sent somebody to crisis resources.
  const restricted = all<{ person_id: string; checkin_date: string } & Record<string, number>>(
    `SELECT user_id AS person_id, checkin_date, activation, shutdown, harm_urge, feels_safe,
            dissociation, sleep_quality, substance_flag
       FROM checkins WHERE id LIKE 'agent-checkin-%'`,
  ).filter((c) => evaluateAccess({
    nowMs: new Date(`${c.checkin_date}T09:00:00Z`).getTime(),
    dailyCheckin: {
      activation: c.activation, shutdown: c.shutdown, dissociation: c.dissociation,
      sleepQuality: c.sleep_quality, harmUrge: !!c.harm_urge,
      feelsSafe: !!c.feels_safe, substanceFlag: !!c.substance_flag,
    },
  }).tier < AccessTier.STEADY);

  assert.ok(restricted.length > 0, "no restricted day in the whole population to check");
  const recorded = one(
    `SELECT COUNT(*) AS n FROM longitudinal_events WHERE id LIKE 'agent-restricted-%'`);
  assert.equal(recorded, restricted.length,
    `the engine restricted ${restricted.length} days and ${recorded} were written down`);
});

test("a session blocked by configuration is not recorded as a safety refusal", () => {
  // Autonomous stimulation is off in beta, so most session requests get no
  // further — with no rule fired and nothing about the person decided. Logging
  // those as refusals put seventeen events on the console that read as safety
  // and were not, and would have landed on the clinical panel as somebody's
  // latest safety state.
  const refusals = all<{ payload: string }>(
    `SELECT payload FROM longitudinal_events WHERE id LIKE 'agent-refused-%'`);
  for (const r of refusals) {
    const p = JSON.parse(r.payload) as { rules: string[]; memberReason: string | null };
    assert.ok(p.rules.length > 0,
      "a refusal was recorded with no rule behind it — that is a configuration, not a decision");
    assert.ok(p.memberReason, "a refusal a member could not be given a reason for");
  }
});

test("the run reports the configuration blocks separately, and does not hide them", () => {
  const out = runAgents(db);
  assert.ok(out.sessionsUnavailable > 0, "nothing was blocked by the beta configuration");
  assert.ok(out.sessionsUnavailable > out.sessionsRefused,
    "expected most requests to stop at the configuration in beta");
  assert.equal(
    out.sessionsRefused,
    Object.values(out.refusalsByTier).reduce((a, b) => a + b, 0),
    "the refusal total and its breakdown disagree",
  );
});

// ---------------------------------------------------------------------------
// The tail
// ---------------------------------------------------------------------------

test("agents write only inside the reserved tail, and never past today", () => {
  const early = one(
    `SELECT COUNT(*) AS n FROM checkins WHERE id LIKE 'agent-%' AND checkin_date < ?`,
    [AGENT_OPENS]);
  assert.equal(early, 0, "an agent wrote into the generator's half of the calendar");

  const last = dayDate(CALENDAR_DAYS);
  assert.equal(
    one(`SELECT COUNT(*) AS n FROM checkins WHERE id LIKE 'agent-%' AND checkin_date > ?`, [last]),
    0, "an agent wrote a check-in in the future");
  assert.equal(
    one(`SELECT COUNT(*) AS n FROM longitudinal_events
          WHERE id LIKE 'agent-%' AND substr(occurred_at, 1, 10) > ?`, [last]),
    0, "an agent wrote an event in the future");
});

test("the reserved tail is the fortnight the generator did not write", () => {
  assert.equal(GENERATED_DAYS + AGENT_HORIZON, CALENDAR_DAYS);
  const overlap = one(
    `SELECT COUNT(*) AS n FROM checkins
      WHERE id NOT LIKE 'agent-%' AND checkin_date >= ? AND user_id IN ${MARKS}`,
    [AGENT_OPENS, ...POP]);
  assert.equal(overlap, 0, "the generator wrote inside the agents' window");
});

test("the agents write no measures — the schedule belongs to the generator", () => {
  // Both writing measures pushed people past p14's ceiling of eight. The seam
  // is owned by one side, and this says which.
  assert.equal(one("SELECT COUNT(*) AS n FROM screenings WHERE id LIKE 'agent-%'"), 0);
});

// ---------------------------------------------------------------------------
// The floor
// ---------------------------------------------------------------------------

test("nobody in the population ends the calendar with no check-in at all", () => {
  // p14's per-person range scales with exposure and bottoms out at one,
  // because a person enrolled for three weeks with nothing recorded is a
  // defect rather than a rounding result. Somebody who enrols in the last
  // fortnight can hit it: the generator's start drag consumes their whole
  // generated window, and a probabilistic show-up rate can then hand them a
  // silent agent window too. The tail owes them that floor.
  const counts = new Map<string, number>();
  for (const r of all<{ id: string; n: number }>(
    `SELECT user_id AS id, COUNT(*) AS n FROM checkins WHERE user_id IN ${MARKS} GROUP BY user_id`,
    POP,
  )) counts.set(r.id, Number(r.n));
  const ghosts = MANIFEST.filter((row) => (counts.get(popPersonId(row)) ?? 0) === 0);
  assert.deepEqual(ghosts.map((g) => g.id), [], "profiles with no check-in anywhere");
});

test("the floor covers a person whose generated window produced nothing", () => {
  // The first version fired only when the generated window was ZERO days long.
  // ST-MW-043 has three generated days and the generator's start drag consumes
  // all three, so it wrote nothing and the floor never fired. The length of
  // the window and the number of rows in it are not the same number, and the
  // difference between them is the whole case.
  //
  // Behavioural, not a source match: written against the table, so a reformat
  // of the runner does not fail it and a reversion to the old condition does.
  const shortchanged = MANIFEST.filter((row) => {
    if (generatedDaysFor(row) === 0) return false; // the case that always worked
    return one(
      `SELECT COUNT(*) AS n FROM checkins WHERE user_id = ? AND checkin_date < ?`,
      [popPersonId(row), AGENT_OPENS]) === 0;
  });
  assert.ok(shortchanged.length > 0,
    "no profile has a non-empty generated window the generator left empty — " +
    "the case this guard exists for is no longer in the population");

  for (const row of shortchanged) {
    assert.ok(
      one("SELECT COUNT(*) AS n FROM checkins WHERE user_id = ?", [popPersonId(row)]) > 0,
      `${row.id} has a generated window, no generated check-in, and no floor either`);
  }
});

test("the floor fills a handful of people, not a population", () => {
  // A floor is also the shape a masked defect takes. If the generator ever
  // regresses, this number rises — and it is reported rather than silent
  // precisely so that it can be seen to rise.
  const out = runAgents(db);
  assert.ok(out.checkInFloorPeople <= 5,
    `the floor filled ${out.checkInFloorPeople} people — that is the generator, not the tail`);
  assert.ok(out.checkInFloorDays >= out.checkInFloorPeople);
});

// ---------------------------------------------------------------------------
// Replayability
// ---------------------------------------------------------------------------

test("a second run writes nothing new", () => {
  const before = {
    checkins: one("SELECT COUNT(*) AS n FROM checkins"),
    events: one("SELECT COUNT(*) AS n FROM longitudinal_events"),
    practice: one("SELECT COUNT(*) AS n FROM practice_completions"),
    sessions: one("SELECT COUNT(*) AS n FROM therapy_sessions"),
  };
  runAgents(db);
  assert.deepEqual({
    checkins: one("SELECT COUNT(*) AS n FROM checkins"),
    events: one("SELECT COUNT(*) AS n FROM longitudinal_events"),
    practice: one("SELECT COUNT(*) AS n FROM practice_completions"),
    sessions: one("SELECT COUNT(*) AS n FROM therapy_sessions"),
  }, before, "a re-run changed the database — the demonstration is not replayable");
});

test("the same day for the same person always produces the same intent", () => {
  // The counters are only comparable across runs if the decisions are. A
  // random draw here would make every reset a different population wearing the
  // same names.
  for (const row of MANIFEST.slice(0, 20)) {
    const exposure = exposureDaysFor(row);
    const access = accessProfileFor(row);
    for (const day of [0, 3, 11]) {
      assert.deepEqual(
        intentFor(row, day, exposure, seedFor(row), access),
        intentFor(row, day, exposure, seedFor(row), access),
        `${row.id} day ${day} drew twice and got two answers`,
      );
    }
  }
});

test("the population does not check in every day — it is people, not a cron job", () => {
  const out = runAgents(db);
  assert.ok(out.quietDays > out.checkIns,
    "everybody showed up every day, which is not a population");
  assert.ok(out.checkIns > 0);
  assert.equal(out.people, POP.length);
});
