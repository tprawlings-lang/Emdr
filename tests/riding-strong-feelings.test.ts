// Riding Strong Feelings (Handoff 10 2C; row CV10_D05, F02):
//
//   - four units built from live skills, each opening at the loosest gate
//     among its skills while every skill keeps its own gate — so a very hard
//     day still reaches "Move it out" and "Find the room";
//   - each unit ends with "Which of these do you want in your SOS plan?":
//     "Add" writes the chosen skills to the member's own plan by name, keeping
//     what is there; "Not now" adds nothing; either completes the unit;
//   - only the unit's own practices can be added, and never by the companion.

process.env.EMDR_DATA_DIR = `/tmp/steady-riding-${process.pid}-${Date.now()}`;
process.env.EMDR_SESSION_SECRET = "riding-strong-secret-at-least-32-characters";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "riding-strong-key";

import { strict as assert } from "node:assert";
import test from "node:test";

import { getDb, newId, PLATFORM_TENANT_ID } from "../src/lib/db";
import { todayISO } from "../src/lib/gating";
import { getPractice, practiceForMember } from "../src/lib/practices";
import { LESSONS } from "../src/lib/lessons";
import { enrollInProgram, memberPrograms, openUnit, programView } from "../src/lib/programs";
import { ActivityRefused, answerSosQuestion } from "../src/lib/program-activities";
import { addSosGroundingTools, SOS_TOOLS_MAX } from "../src/lib/sos";
import { RIDING_STRONG_FEELINGS } from "../src/lib/content/h10-programs";

const db = getDb();
const RSF = RIDING_STRONG_FEELINGS.id;
const U = RIDING_STRONG_FEELINGS.units.map((u) => u.id);

function member(activation = 2): string {
  const id = newId();
  db.prepare("INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, 'M', 'fabricated')").run(id, PLATFORM_TENANT_ID);
  db.prepare("INSERT INTO users (id, tenant_id, email, password_hash, role, name) VALUES (?, ?, ?, 'x', 'member', 'M')")
    .run(id, PLATFORM_TENANT_ID, `${id}@rsf.test`);
  db.prepare(`INSERT INTO checkins (id, user_id, checkin_date, activation, shutdown, harm_urge, feels_safe, dissociation,
      sleep_quality, substance_flag, recommended_action) VALUES (?, ?, ?, ?, 2, 0, 1, 1, 7, 0, 'processing_ok')`)
    .run(newId(), id, todayISO(), activation);
  return id;
}

const plan = (m: string) => {
  const row = db.prepare("SELECT grounding_tools_json, support_contact_name FROM safety_plans WHERE user_id = ?").get(m) as
    { grounding_tools_json: string; support_contact_name: string | null } | undefined;
  return row ? { tools: JSON.parse(row.grounding_tools_json) as string[], contact: row.support_contact_name } : null;
};

test("four units from live skills; each opens at the loosest gate among its skills", () => {
  assert.equal(RIDING_STRONG_FEELINGS.units.length, 4);
  for (const u of RIDING_STRONG_FEELINGS.units) {
    const skills = u.practiceIds.map((id) => getPractice(id));
    assert.ok(skills.every(Boolean), `${u.id}: a practice does not exist`);
    assert.ok(skills.every((p) => p!.type === "skill"), `${u.id}: not built from skills`);
    const loosestTier = Math.min(...skills.map((p) => p!.minTier ?? 0));
    const loosestCeiling = Math.max(...skills.map((p) => p!.maxActivation ?? 10));
    assert.deepEqual([u.minTier, u.maxActivation], [loosestTier, loosestCeiling], `${u.id}: gate is not its skills' loosest`);
    assert.equal(u.activity, "sos-add");
    assert.deepEqual(u.signoffRowIds, ["CV10_D05"]);
  }
  assert.ok(LESSONS.some((l) => l.id === RIDING_STRONG_FEELINGS.units[2].lessonId), "unit 3's lesson is missing");
});

test("offered to every member; on a very hard day the first two units open with the skills made for it", async () => {
  const hard = member(9);
  assert.ok((await memberPrograms(hard)).some((v) => v.program.id === RSF));
  await enrollInProgram(hard, RSF);
  assert.equal((await openUnit(hard, RSF, U[0])).ok, true);
  // Inside the unit, each skill keeps its own gate.
  assert.equal((await practiceForMember(hard, "skill-move-it-out")).state, "open");
  assert.equal((await practiceForMember(hard, "skill-stop")).state, "not_today");
});

test("'Add' puts the chosen skills in the SOS plan by name, keeping the rest of the plan, and completes the unit", async () => {
  const m = member();
  db.prepare("INSERT INTO safety_plans (user_id, grounding_tools_json, support_contact_name) VALUES (?, ?, ?)")
    .run(m, JSON.stringify(["Cold water", "Pause before reacting"]), "Sam");
  await enrollInProgram(m, RSF);
  const r = await answerSosQuestion(m, RSF, U[0], { add: true, practiceIds: ["skill-stop", "skill-move-it-out"] });
  assert.deepEqual(r.added, ["Move it out"], "a tool already there was added again");
  assert.deepEqual(plan(m), { tools: ["Cold water", "Pause before reacting", "Move it out"], contact: "Sam" });
  assert.equal((await programView(m, RSF))!.units[0].state, "done");
  const entries = db.prepare("SELECT COUNT(*) AS n FROM activity_entries WHERE user_id = ?").get(m) as { n: number };
  assert.equal(entries.n, 0, "the SOS answer was stored as a written entry");
});

test("a member with no plan yet gets one holding just these", async () => {
  const m = member();
  await enrollInProgram(m, RSF);
  await answerSosQuestion(m, RSF, U[0], { add: true, practiceIds: ["skill-move-it-out"] });
  assert.deepEqual(plan(m), { tools: ["Move it out"], contact: null });
});

test("'Not now' adds nothing and completes the unit", async () => {
  const m = member();
  await enrollInProgram(m, RSF);
  assert.deepEqual(await answerSosQuestion(m, RSF, U[0], { add: false, practiceIds: ["skill-stop"] }), { added: [] });
  assert.equal(plan(m), null);
  assert.equal((await programView(m, RSF))!.units[0].state, "done");
});

test("only the unit's own practices; not its lesson, not another unit's skill, and not nothing", async () => {
  const m = member();
  await enrollInProgram(m, RSF);
  await answerSosQuestion(m, RSF, U[0], { add: false, practiceIds: [] });
  await answerSosQuestion(m, RSF, U[1], { add: false, practiceIds: [] });
  const refused = (practiceIds: string[], code: string) =>
    assert.rejects(answerSosQuestion(m, RSF, U[2], { add: true, practiceIds }), (e: Error) => e instanceof ActivityRefused && e.code === code);
  await refused([], "pick_one");
  await refused(["coping-that-costs"], "not_on_list");
  await refused(["skill-stop"], "not_on_list");
  assert.equal((await programView(m, RSF))!.units[2].state, "open", "a refused answer completed the unit");
});

test("the plan never grows past what onboarding allows", async () => {
  const m = member();
  const full = Array.from({ length: SOS_TOOLS_MAX }, (_, i) => `tool ${i}`);
  db.prepare("INSERT INTO safety_plans (user_id, grounding_tools_json) VALUES (?, ?)").run(m, JSON.stringify(full));
  assert.deepEqual(await addSosGroundingTools(m, ["Move it out"]), []);
  assert.equal(plan(m)!.tools.length, SOS_TOOLS_MAX);
});
