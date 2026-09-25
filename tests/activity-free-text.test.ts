// What a member writes in a program (Handoff 10 §3.4; row CV10_A15).
//
//   - the crisis pre-filter runs before anything is saved, and on a match
//     nothing is saved;
//   - what is saved is encrypted at rest (enc1:);
//   - the spine and the audit log carry coded facts, never the words;
//   - delete overwrites the words;
//   - only what the unit offers, under today's gate, is accepted.

process.env.EMDR_DATA_DIR = `/tmp/steady-activity-text-${process.pid}-${Date.now()}`;
process.env.EMDR_SESSION_SECRET = "activity-text-secret-at-least-32-characters";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "activity-text-key";

import { strict as assert } from "node:assert";
import test from "node:test";

import { getDb, newId, PLATFORM_TENANT_ID } from "../src/lib/db";
import { todayISO } from "../src/lib/gating";
import { completeUnit, enrollInProgram, programView } from "../src/lib/programs";
import {
  ActivityRefused, deleteActivityEntry, memberEntries, plannedItems, saveActivityEntry, screenMemberText,
} from "../src/lib/program-activities";
import { MOVING_TOWARD } from "../src/lib/content/h10-programs";
import { detectRisk } from "../src/lib/companion";

const db = getDb();
const MT = MOVING_TOWARD.id;
const [U1, U2, U3] = MOVING_TOWARD.units.map((u) => u.id);
const CRISIS = "I want to kill myself";
const PRIVATE = "walk to the river with my sister";

function member(): string {
  const id = newId();
  db.prepare("INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, 'M', 'fabricated')").run(id, PLATFORM_TENANT_ID);
  db.prepare("INSERT INTO users (id, tenant_id, email, password_hash, role, name) VALUES (?, ?, ?, 'x', 'member', 'M')")
    .run(id, PLATFORM_TENANT_ID, `${id}@text.test`);
  db.prepare(`INSERT INTO checkins (id, user_id, checkin_date, activation, shutdown, harm_urge, feels_safe, dissociation,
      sleep_quality, substance_flag, recommended_action) VALUES (?, ?, ?, 2, 2, 0, 1, 1, 7, 0, 'processing_ok')`)
    .run(newId(), id, todayISO());
  return id;
}

const count = (sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { n: number }).n;

test("the pre-filter is the companion's own check", () => {
  assert.equal(detectRisk(CRISIS), true, "the fixture is not a crisis phrase — the test proves nothing");
});

test("crisis language saves nothing, raises the alert, and keeps the words out of every record", async () => {
  const m = member();
  await enrollInProgram(m, MT);
  const r = await saveActivityEntry(m, MT, U1, { kind: "values-pick", areas: ["Fun and rest"], other: CRISIS });
  assert.deepEqual(r, { ok: false, crisis: true });
  assert.equal(count("SELECT COUNT(*) AS n FROM activity_entries WHERE user_id = ?", m), 0, "something was saved");
  assert.equal(count("SELECT COUNT(*) AS n FROM program_unit_completions WHERE user_id = ?", m), 0, "the unit was marked done");
  assert.equal(count("SELECT COUNT(*) AS n FROM alerts WHERE user_id = ? AND alert_type = 'activity_risk_language'", m), 1);
  for (const [table, col] of [["alerts", "detail"], ["audit_log", "detail_json"], ["longitudinal_events", "payload"]] as const) {
    const rows = db.prepare(`SELECT ${col} AS v FROM ${table}`).all() as Array<{ v: string | null }>;
    assert.ok(!rows.some((r) => (r.v ?? "").includes("kill myself")), `the words reached ${table}`);
  }
});

test("a plan's own item is screened too", async () => {
  const m = member();
  await enrollInProgram(m, MT);
  await completeUnit(m, MT, U1);
  const r = await saveActivityEntry(m, MT, U2, { kind: "activity-plan", items: [{ text: CRISIS, own: true }] });
  assert.deepEqual(r, { ok: false, crisis: true });
});

test("what is saved is encrypted, and the spine carries only coded facts", async () => {
  const m = member();
  await enrollInProgram(m, MT);
  await completeUnit(m, MT, U1);
  const saved = await saveActivityEntry(m, MT, U2, { kind: "activity-plan", items: [{ text: PRIVATE, own: true, day: "Monday" }] });
  assert.ok(saved.ok);
  const row = db.prepare("SELECT payload_enc FROM activity_entries WHERE user_id = ?").get(m) as { payload_enc: string };
  assert.match(row.payload_enc, /^enc1:/);
  assert.ok(!row.payload_enc.includes("river"));
  const events = db.prepare("SELECT payload FROM longitudinal_events WHERE person_id = ? AND event_type = 'program.activity_recorded'").all(m) as Array<{ payload: string }>;
  assert.equal(events.length, 1);
  assert.ok(!events[0].payload.includes("river"), "the spine carries the words");
  assert.deepEqual(await plannedItems(m, MT), [PRIVATE]);
  assert.equal((await programView(m, MT))!.units[1].state, "done", "saving the activity completes its unit");
});

test("ratings are stored and not shown back in the member's own view (CV10_B03)", async () => {
  const m = member();
  await enrollInProgram(m, MT);
  await completeUnit(m, MT, U1);
  await saveActivityEntry(m, MT, U2, { kind: "activity-plan", items: [{ text: "drink a glass of water" }] });
  const r = await saveActivityEntry(m, MT, U3, { kind: "activity-reflect", planItem: "drink a glass of water", outcome: "did", mastery: 7, enjoyment: 4 });
  assert.ok(r.ok);
  const ev = db.prepare("SELECT payload FROM longitudinal_events WHERE person_id = ? AND event_type = 'program.activity_recorded' ORDER BY rowid DESC").get(m) as { payload: string };
  assert.deepEqual(JSON.parse(ev.payload).ratings, { mastery: 7, enjoyment: 4 }, "the coded copy for clinician analytics");
  const mine = (await memberEntries(m, MT)).find((e) => e.kind === "activity-reflect")!;
  assert.ok(!mine.summary.some((s) => /\d/.test(s)), "a rating was shown back to the member");
});

test("'not this time' never takes a reason", async () => {
  const m = member();
  await enrollInProgram(m, MT);
  await completeUnit(m, MT, U1);
  await saveActivityEntry(m, MT, U2, { kind: "activity-plan", items: [{ text: "pay one bill" }] });
  await saveActivityEntry(m, MT, U3, {
    kind: "activity-reflect", planItem: "pay one bill", outcome: "not", notThisTime: "smaller", noticed: "because I was tired", mastery: 2,
  });
  const e = (await memberEntries(m, MT)).find((x) => x.kind === "activity-reflect")!;
  assert.deepEqual(e.summary, ["pay one bill", "Not this time"], "a reason or a rating was kept on 'not this time'");
});

test("only what the unit offers is accepted", async () => {
  const m = member();
  await enrollInProgram(m, MT);
  await assert.rejects(saveActivityEntry(m, MT, U1, { kind: "values-pick", areas: ["Something invented"] }), ActivityRefused);
  await assert.rejects(saveActivityEntry(m, MT, U1, {
    kind: "values-pick", areas: ["People I care about", "Fun and rest", "Work or learning", "Home and daily life"],
  }), ActivityRefused, "more than three areas");
  await assert.rejects(saveActivityEntry(m, MT, U1, { kind: "activity-plan", items: [{ text: "x", own: true }] }), ActivityRefused, "wrong activity for the unit");
  await saveActivityEntry(m, MT, U1, { kind: "values-pick", areas: ["Fun and rest"] });
  await assert.rejects(saveActivityEntry(m, MT, U2, { kind: "activity-plan", items: [{ text: "rob a bank" }] }), ActivityRefused, "not on the menu");
  await assert.rejects(saveActivityEntry(m, MT, U3, { kind: "activity-reflect", planItem: "not planned", outcome: "did" }), Error);
});

test("delete overwrites the words and hides the entry; the unit stays done", async () => {
  const m = member();
  await enrollInProgram(m, MT);
  const saved = await saveActivityEntry(m, MT, U1, { kind: "values-pick", areas: ["Fun and rest"], other: PRIVATE });
  assert.ok(saved.ok);
  assert.equal(await deleteActivityEntry(m, saved.id), true);
  assert.equal(await deleteActivityEntry(member(), saved.id), false, "another member deleted it");
  const row = db.prepare("SELECT payload_enc, deleted_at FROM activity_entries WHERE id = ?").get(saved.id) as { payload_enc: string; deleted_at: string | null };
  assert.ok(row.deleted_at);
  const { decryptField } = await import("../src/lib/crypto");
  assert.equal(decryptField(row.payload_enc), "{}", "the words are still there under the delete");
  assert.deepEqual(await memberEntries(m, MT), []);
  assert.equal((await programView(m, MT))!.units[0].state, "done");
});

test("screening reports without the words", async () => {
  const m = member();
  const r = await screenMemberText(m, ["an ordinary sentence"], "test");
  assert.deepEqual(r, { ok: true });
});
