// The Course landing counts the RECORD, not the cache (17 September handoff, P4).
//
// The first version read `intervention_instances` directly and reported
// "Nothing has been recorded as given to this person yet" beside a link to a
// screen that read "24 exposures across 6 interventions, with 20 observations
// of what followed". Both were looking at the same person. The landing was
// right about the table and wrong about the person: that table is a derived
// cache which the Responses screen rebuilds from sessions and practices on
// every read, so it was empty for anybody whose Responses screen nobody had
// opened yet — which is most people, most of the time.
//
// That is why this file talks to a database instead of to the source. A
// source-level check that the sync is called would pass an implementation that
// called it AFTER counting, and the whole defect was an ordering one.

process.env.EMDR_DATA_DIR = `/tmp/steady-course-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "course-status-secret-at-least-32-chars-long";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "course-status-key";

import { strict as assert } from "node:assert";
import test from "node:test";

import { getDb, newId, PLATFORM_TENANT_ID } from "../src/lib/db";
import type { TenantContext } from "../src/lib/repository";
import { MODULES } from "../src/lib/modules";
import { recordCheckin } from "../src/lib/spine";
import { courseReadings } from "../src/lib/clinical/course-status";

const db = getDb();
function person(role: string, name: string): string {
  const id = newId();
  db.prepare(
    "INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, ?, 'fabricated')"
  ).run(id, PLATFORM_TENANT_ID, name);
  db.prepare(
    "INSERT INTO users (id, tenant_id, email, password_hash, role, name) VALUES (?, ?, ?, 'x', ?, ?)"
  ).run(id, PLATFORM_TENANT_ID, `${id}@course.test`, role, name);
  return id;
}

const clinician = person("clinician", "Dr Vale");
const ctx: TenantContext = { tenantId: PLATFORM_TENANT_ID, personId: clinician };
const AS_OF = "2026-09-18T09:00:00.000Z";

const line = (rs: Awaited<ReturnType<typeof courseReadings>>, slug: string) =>
  rs.find((r) => r.slug === slug)!;

test("a person with nothing on file gets four sentences and no zeroes", async () => {
  const empty = person("member", "Nobody Yet");
  const rs = await courseReadings(ctx, empty, { asOf: AS_OF });
  assert.equal(rs.length, 4);
  for (const r of rs) {
    assert.equal(r.recorded, false, `${r.label}: "${r.said}" claims a record that is not there`);
    assert.doesNotMatch(r.said, /\b0\b/, `${r.label}: "${r.said}" reports a zero`);
  }
});

test("a session on file is counted as an exposure on the first read", async () => {
  // THE LOAD-BEARING TEST. The exposure exists as a therapy session and has
  // never been reconstructed into the instance table, which is exactly the
  // state every person is in until somebody opens their Responses screen.
  const member = person("member", "Rosa");
  db.prepare(
    `INSERT INTO therapy_sessions (id, user_id, module_id, status, pre_suds, post_suds, started_at, ended_at)
     VALUES (?, ?, ?, 'completed', 5, 3, ?, ?)`
  ).run(newId(), member, MODULES[0].id, "2026-09-10T10:00:00Z", "2026-09-10T10:45:00Z");

  const first = await courseReadings(ctx, member, { asOf: AS_OF });
  const responses = line(first, "/responses");
  assert.equal(responses.recorded, true,
    `the landing says "${responses.said}" for a person with a session on file`);
  assert.match(responses.said, /1 exposure recorded/);
});

test("the count does not grow when the same record is read twice", async () => {
  // The reconstruction is idempotent on its source ids; a landing that
  // accumulated would report a number that went up every time somebody looked.
  const member = person("member", "Read Twice");
  db.prepare(
    `INSERT INTO therapy_sessions (id, user_id, module_id, status, pre_suds, post_suds, started_at, ended_at)
     VALUES (?, ?, ?, 'completed', 6, 4, ?, ?)`
  ).run(newId(), member, MODULES[0].id, "2026-09-11T10:00:00Z", "2026-09-11T10:40:00Z");

  const a = line(await courseReadings(ctx, member, { asOf: AS_OF }), "/responses");
  const b = line(await courseReadings(ctx, member, { asOf: AS_OF }), "/responses");
  assert.equal(a.said, b.said, "reading the landing twice changed what it says");
});

test("instruments are counted distinctly, and dated from the newest reading", async () => {
  const member = person("member", "Scored");
  const insert = db.prepare(
    `INSERT INTO screenings (id, user_id, instrument, instrument_version, total_score, answers_json, created_at)
     VALUES (?, ?, ?, '1', ?, '[]', ?)`
  );
  insert.run(newId(), member, "phq-9", 11, "2026-03-03T09:00:00Z");
  insert.run(newId(), member, "phq-9", 8, "2026-08-29T12:00:00Z");
  insert.run(newId(), member, "gad-7", 9, "2026-03-03T09:00:00Z");

  const m = line(await courseReadings(ctx, member, { asOf: AS_OF }), "/measures");
  assert.match(m.said, /2 instruments on file/, `two instruments, three readings: "${m.said}"`);
  assert.match(m.said, /nothing scored in the 20 days since 2026-08-29/);
});

test("the four readings keep their order, so the row does not shuffle between people", async () => {
  const member = person("member", "Ordered");
  const rs = await courseReadings(ctx, member, { asOf: AS_OF });
  assert.deepEqual(rs.map((r) => r.slug), ["/measures", "/goals", "/responses", "/trajectory"]);
});

test("a domain with readings but nothing to compare is not counted as read", async () => {
  // The trajectory policy spends its length on this distinction: "not enough to
  // compare" is a statement about the record. A landing that folded those
  // domains into a count of what was read would turn missing evidence into a
  // finding, on the one screen that is meant to be a summary of the record.
  const member = person("member", "Two Readings");
  const insert = db.prepare(
    `INSERT INTO screenings (id, user_id, instrument, instrument_version, total_score, answers_json, created_at)
     VALUES (?, ?, ?, '1', ?, '[]', ?)`
  );
  insert.run(newId(), member, "phq-9", 14, "2026-09-01T09:00:00Z");

  // Check-ins open the activation, dissociation and sleep domains. Two of them,
  // months back, is enough for the domain to EXIST and nowhere near enough for
  // it to be compared — which is the case this is about.
  for (const day of ["2026-05-02", "2026-05-09"]) {
    await recordCheckin({
      userId: member, checkinId: newId(), checkinDate: day,
      occurredAt: `${day}T09:00:00.000Z`,
      activation: 3, shutdown: 2, dissociation: 1, sleepQuality: 6,
      harmUrge: false, feelsSafe: true, substanceFlag: false,
      recommendedAction: "processing ok",
    });
  }

  const t = line(await courseReadings(ctx, member, { asOf: AS_OF }), "/trajectory");
  assert.match(t.said, /none with enough comparable readings/,
    `domains exist and none can be compared, and the landing says "${t.said}"`);
  assert.equal(t.recorded, false,
    `one reading is not a comparison, and the landing says "${t.said}"`);
});
