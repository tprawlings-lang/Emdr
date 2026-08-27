// Replay: rebuilding current-state tables from events (ADR 0010 step 4).
//
// ADR 0010 §3 is the whole point of this file:
//
//   > A test asserts that a full rebuild produces byte-identical projections to
//   > the incremental path. Without this test the spine is decorative — it is
//   > the difference between claiming replay and having it.
//
// So these tests exercise the real product paths — the same functions the web
// and mobile clients call — and then rebuild from the event log alone and
// demand the result match, column for column. A rebuild that is merely
// "close enough" is a rebuild nobody can trust to reconstruct a patient journey
// (Handoff E7) or to score a prediction against what was known at the time
// (D4/D6).
//
// Hermetic temp DB.
process.env.EMDR_DATA_DIR = `/tmp/steady-projections-${process.pid}-${Date.now()}`;
delete process.env.EMDR_DEMO;

import { strict as assert } from "node:assert";
import test from "node:test";
import { data } from "../src/lib/data";
import { newId } from "../src/lib/db";
import { ulid } from "../src/lib/ids";
import { provisionPerson, grantConsent, withdrawConsent } from "../src/lib/spine";
import { recordPracticeCompletion } from "../src/lib/practices";
import { markLessonRead } from "../src/lib/lessons";
import { submitCheckinMobile, startSessionMobile, finishSessionMobile } from "../src/lib/mobile/service";
import { readEvents } from "../src/lib/events";
import {
  verifyProjections, rebuildProjections, formatVerifyResult,
  PROJECTED_TABLES, dropShadowTables,
} from "../src/lib/projections";

const USER = "proj-user";

/** Fails with the full diff rather than a bare boolean — a replay check that
 *  says only "not identical" is one nobody can act on. */
async function assertIdentical(label: string, opts: { personId?: string } = {}) {
  const v = await verifyProjections(opts);
  assert.equal(v.identical, true, `${label}\n${formatVerifyResult(v)}`);
  return v;
}

test("setup: a member with consent, recorded through the real product paths", async () => {
  const c = await data();
  await c.run("INSERT INTO users (id, email, name, role, password_hash) VALUES (?, ?, ?, ?, ?)",
    [USER, "proj@test.local", "Projection", "member", "x"]);
  await provisionPerson({ userId: USER, name: "Projection", email: "proj@test.local", role: "member" });
  await grantConsent({ userId: USER, policyVersion: "wellness-ack-v1", scope: "wellness_acknowledgment" });

  const consents = await c.all("SELECT * FROM consents WHERE user_id = ?", [USER]);
  assert.equal(consents.length, 1);
});

test("a check-in replays byte-identically", async () => {
  await submitCheckinMobile(USER, {
    activation: 6, shutdown: 3, harm_urge: false, feels_safe: true,
    dissociation: 2, sleep_quality: 7, substance_flag: false, triggers: [],
  });
  await assertIdentical("check-in", { personId: USER });
});

test("a REPEAT check-in the same day updates the row rather than duplicating it", async () => {
  // The live write is an upsert on (user_id, checkin_date): the row keeps its
  // original id and created_at, and only the scores change. A replay that
  // treated the second event as a new row would silently double the member's
  // check-in history — the exact class of drift this test exists to catch.
  await submitCheckinMobile(USER, {
    activation: 2, shutdown: 8, harm_urge: false, feels_safe: true,
    dissociation: 5, sleep_quality: 4, substance_flag: false, triggers: [],
  });

  const c = await data();
  const rows = (await c.all(
    "SELECT * FROM checkins WHERE user_id = ?", [USER]
  )) as { activation: number }[];
  assert.equal(rows.length, 1, "still one row for the day");
  assert.equal(Number(rows[0].activation), 2, "and it carries the latest values");

  await assertIdentical("repeat check-in", { personId: USER });
});

test("practice completions and lesson reads replay byte-identically", async () => {
  await recordPracticeCompletion(USER, "coherent-5-5", 120);
  await recordPracticeCompletion(USER, "extended-exhale", 90);
  await markLessonRead(USER, "window-of-tolerance");
  // Idempotent per (user, lesson): the second read must not create a row, and
  // the replay must keep the FIRST read's timestamp.
  await markLessonRead(USER, "window-of-tolerance");

  const c = await data();
  const reads = await c.all("SELECT * FROM lesson_reads WHERE user_id = ?", [USER]);
  assert.equal(reads.length, 1, "a re-read does not add a row");

  await assertIdentical("practices and lessons", { personId: USER });
});

/** Everything checkModuleAccess asks for before a grounding session may start.
 *  Written as raw rows rather than by driving the onboarding flow: the subject
 *  here is replay, and the gate stack has its own tests. */
async function makeSessionEligible(userId: string) {
  const c = await data();
  await c.run(
    `INSERT INTO subscriptions (user_id, plan, status, price_cents, current_period_end)
     VALUES (?, 'premium', 'active', 3499, ?)`,
    [userId, "2099-01-01 00:00:00"]
  );
  await grantConsent({ userId, policyVersion: "v1.0-dev", scope: "care_program_full" });
  for (const [instrument, version] of [
    ["pc-ptsd-5", "2021"], ["pcl-5", "standard"], ["itq", "standard"],
    ["phq-9", "standard"], ["gad-7", "standard"], ["fitness-screener", "fit-v1-placeholder"],
  ]) {
    await c.run(
      `INSERT INTO screenings (id, user_id, instrument, instrument_version, total_score,
                               answers_json, risk_flags_json)
       VALUES (?, ?, ?, ?, 0, '[]', '[]')`,
      [newId(), userId, instrument, version]
    );
  }
  await c.run(
    "INSERT INTO user_profiles (user_id, profile_complete) VALUES (?, 1) ON CONFLICT(user_id) DO UPDATE SET profile_complete = 1",
    [userId]
  );
  await c.run(
    `INSERT INTO user_triggers (id, user_id, trigger_name, trigger_category, intensity_score, active)
     VALUES (?, ?, 'loud noise', 'sensory', 5, 1)`,
    [newId(), userId]
  );
  await c.run(
    `INSERT INTO safety_plans (user_id, grounding_tools_json, support_contact_name,
                               support_contact_method, stop_signs)
     VALUES (?, '["breathing"]', 'A friend', 'text', 'restlessness')`,
    [userId]
  );
}

test("a session's full lifecycle replays byte-identically", async () => {
  await makeSessionEligible(USER);
  const started = await startSessionMobile(USER, "calm-place", "the lake");
  assert.ok(started && "sessionId" in started, `session did not start: ${JSON.stringify(started)}`);
  const sessionId = (started as { sessionId: string }).sessionId;

  await finishSessionMobile(USER, {
    sessionId, outcome: "completed", preSuds: 6, postSuds: 3, peakSuds: 7,
    hardStopReason: null, sudsTrail: [6, 5, 4, 3],
  });

  const c = await data();
  const row = (await c.get(
    "SELECT status, pre_suds, post_suds, detail_json FROM therapy_sessions WHERE id = ?", [sessionId]
  )) as { status: string; detail_json: string };
  assert.equal(row.status, "completed");
  // detail_json accrues at BOTH start (the focus) and finish (the SUDS trail),
  // so the terminal event has to carry it or the replay loses half of it.
  assert.match(row.detail_json, /the lake/);
  assert.match(row.detail_json, /sudsTrail/);

  await assertIdentical("session lifecycle", { personId: USER });
});

test("a consent withdrawal closes the grant it belongs to", async () => {
  const c = await data();
  await grantConsent({ userId: USER, policyVersion: "voice-v1", scope: "voice_biometric" });
  await withdrawConsent({ userId: USER, scope: "voice_biometric" });

  const row = (await c.get(
    "SELECT granted_at, revoked_at FROM consents WHERE user_id = ? AND scope = 'voice_biometric'", [USER]
  )) as { granted_at: string; revoked_at: string | null };
  assert.ok(row.revoked_at, "the grant is revoked, not deleted");

  // The other consent must stay open — a withdrawal is scoped to one grant.
  const other = (await c.get(
    "SELECT revoked_at FROM consents WHERE user_id = ? AND scope = 'wellness_acknowledgment'", [USER]
  )) as { revoked_at: string | null };
  assert.equal(other.revoked_at, null);

  await assertIdentical("consent grant and withdrawal", { personId: USER });
});

test("every projected table is covered, and the whole database replays identically", async () => {
  const v = await assertIdentical("full database");
  // A vacuous pass is the failure mode that matters here: a verifier comparing
  // zero rows reports success forever.
  for (const t of ["checkins", "therapy_sessions", "practice_completions", "lesson_reads", "consents"]) {
    assert.ok((v.compared[t] ?? 0) > 0, `${t} had no rows to compare — the check would be vacuous`);
  }
  assert.equal(v.rebuild.gaps.length, 0, formatVerifyResult(v));
  assert.ok(v.rebuild.applied > 0);
});

test("the rebuild never touches the live tables", async () => {
  const c = await data();
  const before = await c.all("SELECT * FROM checkins ORDER BY id", []);
  await rebuildProjections();
  const after = await c.all("SELECT * FROM checkins ORDER BY id", []);
  assert.deepEqual(after, before,
    "a replay reads events and writes shadow tables — it must never mutate live data");
});

test("point-in-time replay does not leak the future (Handoff D4/D6)", async () => {
  const c = await data();
  // Two reads a day apart. `recorded_at` is what the system KNEW and when, so
  // it is the axis a point-in-time reconstruction cuts on — set explicitly here
  // because both events would otherwise land in the same second.
  const yesterday = "2026-03-01 09:00:00";
  const today = "2026-03-02 09:00:00";
  for (const [lesson, at] of [["window-of-tolerance-pit", yesterday], ["dual-awareness-pit", today]] as const) {
    await c.run(
      `INSERT INTO longitudinal_events
         (id, tenant_id, person_id, event_type, payload_version, payload,
          actor_id, actor_type, occurred_at, recorded_at)
       VALUES (?, '00000000000000000000000000', ?, 'lesson.read', 2, ?, ?, 'patient', ?, ?)`,
      [ulid(Date.parse(at + "Z")), USER,
       JSON.stringify({ projectionId: `pit-${lesson}`, lessonId: lesson }), USER, at, at]
    );
  }

  // As of yesterday, the system had not yet learned about today's read.
  const asOf = await rebuildProjections({ personId: USER, asOf: yesterday });
  const seenThen = (await c.all(
    "SELECT lesson_id FROM spine_rebuild_lesson_reads WHERE lesson_id LIKE '%-pit'", []
  )) as { lesson_id: string }[];
  assert.deepEqual(seenThen.map((r) => r.lesson_id), ["window-of-tolerance-pit"],
    "a replay as of yesterday must not contain a fact recorded today");

  // Replaying the full history brings it back — the cut hid it, nothing lost it.
  const full = await rebuildProjections({ personId: USER });
  assert.ok(full.events > asOf.events, "the full replay genuinely sees more");
  const seenNow = (await c.all(
    "SELECT lesson_id FROM spine_rebuild_lesson_reads WHERE lesson_id LIKE '%-pit' ORDER BY lesson_id", []
  )) as { lesson_id: string }[];
  assert.deepEqual(seenNow.map((r) => r.lesson_id), ["dual-awareness-pit", "window-of-tolerance-pit"]);
});

test("an event with no projectionId is reported as a gap, never guessed at", async () => {
  const c = await data();
  // A payload_version 1 event: written before the current-state key was carried.
  await c.run(
    `INSERT INTO longitudinal_events
       (id, tenant_id, person_id, event_type, payload_version, payload, actor_id, actor_type)
     VALUES (?, '00000000000000000000000000', ?, 'lesson.read', 1, ?, ?, 'patient')`,
    [ulid(), USER, JSON.stringify({ lessonId: "window-of-tolerance" }), USER]
  );

  const r = await rebuildProjections({ personId: USER });
  assert.equal(r.gaps.length, 1, "the unprojectable event is counted");
  assert.equal(r.gaps[0].payloadVersion, 1);
  assert.match(r.gaps[0].reason, /projectionId/);

  // And it does not silently corrupt the rebuild with an invented row.
  const built = await c.all(
    `SELECT * FROM spine_rebuild_lesson_reads WHERE lesson_id = 'window-of-tolerance'`, []
  );
  assert.equal(built.length, 1, "still exactly one row for that lesson — no phantom row");
});

test("cleanup: shadow tables are removable and named apart from the live schema", async () => {
  const c = await data();
  for (const t of PROJECTED_TABLES) {
    assert.ok(!t.startsWith("spine_rebuild_"), "a shadow name can never collide with a live table");
  }
  await dropShadowTables();
  const left = (await c.all(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'spine_rebuild_%'", []
  )) as { name: string }[];
  assert.equal(left.length, 0);
});
