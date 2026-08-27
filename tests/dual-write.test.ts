// Dual-write to the longitudinal spine (ADR 0010 step 2). Hermetic temp DB.
process.env.EMDR_DATA_DIR = `/tmp/steady-dualwrite-${process.pid}-${Date.now()}`;
delete process.env.EMDR_DEMO;

import { strict as assert } from "node:assert";
import test from "node:test";
import { data } from "../src/lib/data";
import { readEvents } from "../src/lib/events";
import { provisionPerson } from "../src/lib/spine";
import { recordPracticeCompletion } from "../src/lib/practices";
import { markLessonRead } from "../src/lib/lessons";
import { writeMemory } from "../src/lib/companion";
import { submitCheckinMobile, startSessionMobile } from "../src/lib/mobile/service";
import { PLATFORM_TENANT_ID } from "../src/lib/db";

const USER = "dw-user";

async function typesFor(personId: string): Promise<string[]> {
  return (await readEvents({ personId })).map((e) => e.event_type);
}

test("setup: a provisioned member has a person, account, role, and a registration event", async () => {
  const c = await data();
  await c.run("INSERT INTO users (id, email, name, role, password_hash) VALUES (?, ?, ?, ?, ?)",
    [USER, "dw@test.local", "Dual Write", "member", "x"]);
  await provisionPerson({ userId: USER, name: "Dual Write", email: "dw@test.local", role: "member" });

  const p = (await c.get("SELECT * FROM persons WHERE id = ?", [USER])) as { tenant_id: string };
  assert.ok(p, "person exists — the prerequisite for any event append");
  assert.equal(p.tenant_id, PLATFORM_TENANT_ID);
  assert.ok((await typesFor(USER)).includes("person.registered"));
});

test("practice completion dual-writes intervention.completed (shared web+mobile path)", async () => {
  const r = await recordPracticeCompletion(USER, "coherent-5-5", 120);
  assert.equal(r.ok, true);

  const ev = (await readEvents({ personId: USER, types: ["intervention.completed"] })).at(-1)!;
  assert.equal(ev.payload.interventionId, "coherent-5-5");
  assert.equal(ev.payload.interventionType, "breathwork");
  assert.equal(ev.payload.durationSec, 120);
  // The version field exists from the first event rather than appearing
  // mid-stream once interventions are versioned (ADR 0012 conflict 6).
  assert.equal(ev.payload.interventionVersion, "unversioned");

  // The current-state table still receives its row — both paths active.
  const c = await data();
  const n = (await c.get("SELECT COUNT(*) AS n FROM practice_completions WHERE user_id = ?", [USER])) as { n: number };
  assert.equal(Number(n.n), 1, "dual-write: projection row still written");
});

test("lesson read dual-writes lesson.read", async () => {
  await markLessonRead(USER, "window-of-tolerance");
  const ev = (await readEvents({ personId: USER, types: ["lesson.read"] })).at(-1)!;
  assert.equal(ev.payload.lessonId, "window-of-tolerance");
});

test("memory write records type/key/source but never the value", async () => {
  await writeMemory({
    userId: USER, type: "grounding_tool", key: "calm place",
    value: "a quiet beach at dawn", source: "user_message",
  });
  const ev = (await readEvents({ personId: USER, types: ["memory.recorded"] })).at(-1)!;
  assert.equal(ev.payload.memoryType, "grounding_tool");
  assert.equal(ev.payload.key, "calm place");
  assert.equal(ev.payload.source, "user_message");
  assert.equal(
    JSON.stringify(ev.payload).includes("quiet beach"), false,
    "the value stays encrypted in ai_memory_items — the event records only that it happened"
  );
});

test("check-in dual-writes with its routing decision and rule version", async () => {
  await submitCheckinMobile(USER, {
    activation: 3, shutdown: 2, harm_urge: false, feels_safe: true,
    dissociation: 1, sleep_quality: 7, substance_flag: false, triggers: [],
  });
  const ev = (await readEvents({ personId: USER, types: ["daily_checkin.completed"] })).at(-1)!;
  assert.equal(ev.payload.recommendedAction, "processing_ok");
  assert.equal(ev.payload.activation, 3);
  assert.equal(ev.payload.via, "mobile");
  assert.equal(ev.provenance.ruleVersion, "checkin-routing-v1",
    "the rule that produced the routing is recorded with it");
});

test("events carry both occurred_at and recorded_at, and sort in append order", async () => {
  const events = await readEvents({ personId: USER });
  assert.ok(events.length >= 5);
  const ids = events.map((e) => e.id);
  assert.deepEqual([...ids].sort(), ids, "ULID order == append order");
  for (const e of events) {
    assert.ok(e.occurred_at && e.recorded_at, "both timestamps present");
    assert.equal(e.tenant_id, PLATFORM_TENANT_ID);
    assert.equal(e.person_id, USER);
  }
});

test("a spine failure never breaks the product path", async () => {
  // appendEventSafe swallows errors by design during dual-write. An event for a
  // person who does not exist violates the FK; the product write must still win.
  const c = await data();
  await c.run("INSERT INTO users (id, email, name, role, password_hash) VALUES (?, ?, ?, ?, ?)",
    ["dw-orphan", "orphan@test.local", "Orphan", "member", "x"]);
  // Deliberately NOT provisioned — no person row exists.
  const r = await recordPracticeCompletion("dw-orphan", "coherent-5-5", 90);
  assert.equal(r.ok, true, "the product path succeeds even though the append fails");
  const n = (await c.get(
    "SELECT COUNT(*) AS n FROM practice_completions WHERE user_id = ?", ["dw-orphan"]
  )) as { n: number };
  assert.equal(Number(n.n), 1, "current-state row written");
  assert.equal((await readEvents({ personId: "dw-orphan" })).length, 0, "no event, no crash");
});
