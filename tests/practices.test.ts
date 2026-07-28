// Practices core — the shared Prepare & Regulate content service. Hermetic temp
// DB. Env set BEFORE imports.
process.env.EMDR_DATA_DIR = `/tmp/steady-practices-${process.pid}-${Date.now()}`;
delete process.env.EMDR_DEMO;

import { strict as assert } from "node:assert";
import test from "node:test";
import { data } from "../src/lib/data";
import {
  BREATHWORK, MEDITATIONS, listPractices, getPractice, recordPracticeCompletion, practiceCompletionCount,
} from "../src/lib/practices";

const USER = "practices-user";

test("setup member", async () => {
  const c = await data();
  await c.run("INSERT INTO users (id, email, name, role, password_hash) VALUES (?, ?, ?, ?, ?)", [
    USER, "practices@test.local", "Practices Tester", "member", "x",
  ]);
});

test("breathwork catalog is internally consistent", () => {
  assert.ok(BREATHWORK.length >= 4);
  for (const p of BREATHWORK) {
    assert.equal(p.type, "breathwork");
    assert.ok(p.phases && p.phases.length > 0, `${p.id} has phases`);
    const anyHold = p.phases!.some((ph) => ph.label === "hold");
    assert.equal(p.hasHold, anyHold, `${p.id} hasHold matches its phases`);
    assert.ok(p.durationSec > 0 && p.intensity >= 1 && p.intensity <= 3);
  }
  // At least one no-hold option must always exist (roadmap §9).
  assert.ok(BREATHWORK.some((p) => !p.hasHold), "a no-breath-hold variant exists");
});

test("meditation catalog is internally consistent (roadmap F2)", () => {
  assert.ok(MEDITATIONS.length >= 5);
  const ids = new Set<string>();
  for (const p of MEDITATIONS) {
    assert.equal(p.type, "meditation");
    assert.equal(p.hasHold, false, `${p.id} is not a breath-hold practice`);
    assert.ok(!p.phases, `${p.id} has no breath phases`);
    assert.ok(p.segments && p.segments.length >= 5, `${p.id} has a real script`);
    for (const s of p.segments!) {
      assert.ok(s.text.length > 10 && s.seconds > 0, `${p.id} segment well-formed`);
    }
    // durationSec is the on-screen pacing: the sum of its segments.
    const scripted = p.segments!.reduce((n, s) => n + s.seconds, 0);
    assert.equal(p.durationSec, scripted, `${p.id} durationSec equals script length`);
    assert.ok(!ids.has(p.id), `unique id ${p.id}`);
    ids.add(p.id);
  }
  // A gentle, orienting entry point must always exist.
  assert.ok(MEDITATIONS.some((p) => p.intensity === 1), "an intensity-1 meditation exists");
});

test("listPractices('meditation'): gentlest (intensity 1) first", async () => {
  const list = await listPractices(USER, "meditation");
  assert.ok(list.length >= 5);
  assert.equal(list[0].intensity, 1);
  assert.ok(list.every((p) => p.type === "meditation"));
});

test("recordPracticeCompletion works for a meditation too", async () => {
  const c = await data();
  const u = "meditation-user";
  await c.run("INSERT INTO users (id, email, name, role, password_hash) VALUES (?, ?, ?, ?, ?)", [
    u, "med@test.local", "Med Tester", "member", "x",
  ]);
  const med = MEDITATIONS[0];
  assert.equal((await recordPracticeCompletion(u, med.id, 120)).ok, true);
  assert.equal(await practiceCompletionCount(u), 1);
});

test("listPractices: normal day → gentlest (intensity 1) first", async () => {
  const list = await listPractices(USER, "breathwork");
  assert.equal(list[0].intensity, 1);
});

test("listPractices: elevated check-in → no-hold patterns come first (titration)", async () => {
  const c = await data();
  const today = new Date().toISOString().slice(0, 10);
  await c.run(
    `INSERT INTO checkins (id, user_id, checkin_date, activation, shutdown, harm_urge, feels_safe,
       dissociation, sleep_quality, substance_flag, recommended_action)
     VALUES (?, ?, ?, 5, 2, 0, 1, 6, 4, 0, 'stabilization')`,
    ["ci-1", USER, today]
  );
  const list = await listPractices(USER, "breathwork");
  // The first hold pattern must not appear before all the no-hold ones.
  const firstHold = list.findIndex((p) => p.hasHold);
  const lastNoHold = list.map((p) => p.hasHold).lastIndexOf(false);
  assert.ok(firstHold > lastNoHold, "no-hold patterns are surfaced before holds");
});

test("recordPracticeCompletion logs a completion; unknown practice → not ok", async () => {
  assert.equal((await recordPracticeCompletion(USER, "does-not-exist", 60)).ok, false);
  assert.equal((await recordPracticeCompletion(USER, "box-4", 90)).ok, true);
  assert.equal(await practiceCompletionCount(USER), 1);
  assert.ok(getPractice("box-4"));
});
