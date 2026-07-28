// Mobile-API ↔ web memory/database parity (hermetic temp DB). Locks the
// cross-device continuity behavior: calm place persists + reads back, a
// calm-place session writes the durable memory slot, and check-in "triggers
// today" persist. Env set BEFORE imports so the data layer opens the temp DB.
process.env.EMDR_DATA_DIR = `/tmp/steady-mobile-parity-${process.pid}-${Date.now()}`;
delete process.env.EMDR_DEMO;

import { strict as assert } from "node:assert";
import test from "node:test";
import { data } from "../src/lib/data";
import { getSavedCalmPlace } from "../src/lib/session-focus";
import { saveCalmPlaceMobile, savedProfileMobile } from "../src/lib/mobile/onboarding";
import { submitCheckinMobile } from "../src/lib/mobile/service";

const USER = "parity-user";

test("setup member", async () => {
  const c = await data();
  await c.run("INSERT INTO users (id, email, name, role, password_hash) VALUES (?, ?, ?, ?, ?)", [
    USER, "parity@test.local", "Parity Tester", "member", "x",
  ]);
});

test("saveCalmPlaceMobile persists to the same slot getSavedCalmPlace reads", async () => {
  await saveCalmPlaceMobile(USER, "the beach");
  assert.equal(await getSavedCalmPlace(USER), "the beach");
  const saved = await savedProfileMobile(USER);
  assert.equal(saved.calmPlace, "the beach");
});

test("updating the calm place replaces the slot (upsert, not duplicate)", async () => {
  // writeMemory upserts by (user, type, key), so a new value replaces the old —
  // updates actually take effect (this is the mechanism the session-start path
  // and Settings both use).
  await saveCalmPlaceMobile(USER, "a quiet forest");
  assert.equal(await getSavedCalmPlace(USER), "a quiet forest");
});

test("savedProfileMobile coerces trigger intensity (null stays null, float rounds) — iOS decode safety", async () => {
  const c = await data();
  // A trigger with NO intensity (nullable column) and one with a float.
  await c.run("INSERT INTO user_triggers (id, user_id, trigger_name, trigger_category, common_responses_json) VALUES (?, ?, ?, ?, '[]')", [
    "trg-null", USER, "loud noises", "environmental",
  ]);
  await c.run("INSERT INTO user_triggers (id, user_id, trigger_name, trigger_category, intensity_score, common_responses_json) VALUES (?, ?, ?, ?, ?, '[]')", [
    "trg-float", USER, "crowds", "environmental", 6.7,
  ]);
  const saved = await savedProfileMobile(USER);
  const byName = Object.fromEntries(saved.triggers.map((t) => [t.name, t.intensity]));
  assert.equal(byName["loud noises"], null); // null → null (not a decode-breaking value)
  assert.equal(byName["crowds"], 7); // float → rounded integer
});

test("check-in persists 'triggers today' instead of an empty array", async () => {
  await submitCheckinMobile(USER, {
    activation: 3, shutdown: 1, harm_urge: false, feels_safe: true,
    dissociation: 1, sleep_quality: 6, substance_flag: false,
    triggers: ["trig-a", "trig-b"],
  });
  const c = await data();
  const row = (await c.get("SELECT triggers_json FROM checkins WHERE user_id = ?", [USER])) as { triggers_json: string };
  assert.deepEqual(JSON.parse(row.triggers_json), ["trig-a", "trig-b"]);
});
