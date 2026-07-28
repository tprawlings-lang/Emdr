// Psychoeducation lessons core (roadmap F11). Hermetic temp DB.
process.env.EMDR_DATA_DIR = `/tmp/steady-lessons-${process.pid}-${Date.now()}`;
delete process.env.EMDR_DEMO;

import { strict as assert } from "node:assert";
import test from "node:test";
import { data } from "../src/lib/data";
import { LESSONS, getLesson, lessonsForModule, markLessonRead, readLessonIds } from "../src/lib/lessons";
import { getModule } from "../src/lib/modules";

const USER = "lessons-user";

test("setup member", async () => {
  const c = await data();
  await c.run("INSERT INTO users (id, email, name, role, password_hash) VALUES (?, ?, ?, ?, ?)", [
    USER, "lessons@test.local", "Lessons Tester", "member", "x",
  ]);
});

test("catalog: at least 6 lessons, each well-formed and module-linked to real modules", () => {
  assert.ok(LESSONS.length >= 6);
  const ids = new Set<string>();
  for (const l of LESSONS) {
    assert.ok(l.title && l.summary && l.body.length > 100, `${l.id} has content`);
    assert.ok(l.readMinutes >= 2 && l.readMinutes <= 6);
    assert.ok(!ids.has(l.id), `unique id ${l.id}`);
    ids.add(l.id);
    for (const m of l.relatedModuleIds) assert.ok(getModule(m), `${l.id} links a real module: ${m}`);
  }
});

test("lessonsForModule returns lessons tagged to that module", () => {
  const forCalm = lessonsForModule("calm-place");
  assert.ok(forCalm.length >= 1);
  assert.ok(forCalm.every((l) => l.relatedModuleIds.includes("calm-place")));
});

test("markLessonRead is idempotent; unknown lesson → not ok", async () => {
  assert.equal((await markLessonRead(USER, "nope")).ok, false);
  assert.equal((await markLessonRead(USER, "window-of-tolerance")).ok, true);
  assert.equal((await markLessonRead(USER, "window-of-tolerance")).ok, true); // again — no duplicate
  const read = await readLessonIds(USER);
  assert.deepEqual(read, ["window-of-tolerance"]);
  assert.ok(getLesson("window-of-tolerance"));
});
