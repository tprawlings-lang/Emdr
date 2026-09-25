// Steadier Sleep (Handoff 10 1C; §7 "sleep-entry.test.ts": any yes withholds
// unit 2 only; coded event only). Also the rest of the program's rules:
//
//   - the entry screen is asked on joining, and nothing opens until it is
//     answered; leaving clears it, so joining again asks again (the product
//     owner's choice, 25 September — decision clinical.sleep-entry-screen-retake);
//   - a withheld part is left out and skipped in the order;
//   - the getting-up time is the only thing "The bed is for sleep" stores, and
//     nothing computes a bedtime or a time-in-bed limit (CV10_C03);
//   - the gates are the signed night-practice levels (units 1, 3, 4 at the
//     grounding tier, any activation; unit 2 at stabilization, 7 or below);
//   - what a member writes here runs the crisis pre-filter like everywhere else.

process.env.EMDR_DATA_DIR = `/tmp/steady-sleep-entry-${process.pid}-${Date.now()}`;
process.env.EMDR_SESSION_SECRET = "sleep-entry-secret-at-least-32-characters";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "sleep-entry-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { getDb, newId, PLATFORM_TENANT_ID } from "../src/lib/db";
import { todayISO } from "../src/lib/gating";
import { AccessTier } from "../src/lib/safety/types";
import {
  completeUnit, enrollInProgram, entryLines, leaveProgram, openUnit, programView, ProgramRefused,
  scoreEntryScreen, unitStates,
} from "../src/lib/programs";
import { ActivityRefused, memberEntries, reflectOptions, saveActivityEntry } from "../src/lib/program-activities";
import { STEADIER_SLEEP } from "../src/lib/content/h10-programs";

const db = getDb();
const SS = STEADIER_SLEEP.id;
const [U1, U2, U3, U4] = STEADIER_SLEEP.units.map((u) => u.id);
const SCREEN = STEADIER_SLEEP.entryScreen!;
const NO = [false, false, false];
const CRISIS = "I want to kill myself";

function member(activation = 2): string {
  const id = newId();
  db.prepare("INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, 'M', 'fabricated')").run(id, PLATFORM_TENANT_ID);
  db.prepare("INSERT INTO users (id, tenant_id, email, password_hash, role, name) VALUES (?, ?, ?, 'x', 'member', 'M')")
    .run(id, PLATFORM_TENANT_ID, `${id}@sleep.test`);
  db.prepare(`INSERT INTO checkins (id, user_id, checkin_date, activation, shutdown, harm_urge, feels_safe, dissociation,
      sleep_quality, substance_flag, recommended_action) VALUES (?, ?, ?, ?, 2, 0, 1, 1, 7, 0, 'processing_ok')`)
    .run(newId(), id, todayISO(), activation);
  return id;
}

const ids = async (m: string) => (await programView(m, SS))!.units.map((u) => u.unit.id);
const count = (sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { n: number }).n;

// ── The screen, pure ─────────────────────────────────────────────────────────

test("the screen is the signed one: three questions, unit 2 the only part it withholds", () => {
  assert.equal(SCREEN.id, "sleep-entry-v1");
  assert.equal(SCREEN.questions.length, 3);
  assert.deepEqual(SCREEN.signoffRowIds, ["CV10_C04"]);
  assert.deepEqual(STEADIER_SLEEP.units.filter((u) => u.withheldByEntryScreen).map((u) => u.id), [U2]);
  // The pack's "If question 2 is Yes" — zero-based key 1.
  assert.deepEqual(Object.keys(SCREEN.ifYes), ["1"]);
  assert.match(SCREEN.questions[1], /driving/);
});

test("any yes withholds; all no does not; the answers must fit the questions", () => {
  assert.deepEqual(scoreEntryScreen(SCREEN, NO), { withheld: false, noteKeys: [] });
  assert.deepEqual(scoreEntryScreen(SCREEN, [true, false, false]), { withheld: true, noteKeys: [] });
  assert.deepEqual(scoreEntryScreen(SCREEN, [false, false, true]), { withheld: true, noteKeys: [] });
  assert.deepEqual(scoreEntryScreen(SCREEN, [false, true, false]), { withheld: true, noteKeys: [1] });
  for (const bad of [[], [false, false], [false, false, false, false], [false, "no", false], [0, 0, 0], [null, false, false]]) {
    assert.equal(scoreEntryScreen(SCREEN, bad), null, JSON.stringify(bad));
  }
});

test("what is said: nothing on all no; the any-yes line, then the driving line only on question 2", () => {
  assert.deepEqual(entryLines(SCREEN, false, []), []);
  assert.deepEqual(entryLines(SCREEN, true, []), [SCREEN.anyYes]);
  assert.deepEqual(entryLines(SCREEN, true, [1]), [SCREEN.anyYes, SCREEN.ifYes[1]]);
});

test("a withheld unit is left out and skipped in the order", () => {
  const gate = { tier: AccessTier.STEADY, activation: 2, imagery: true };
  const withheld = (u: { withheldByEntryScreen?: boolean }) => Boolean(u.withheldByEntryScreen);
  const run = (done: string[]) => unitStates(STEADIER_SLEEP, new Set(done), gate, () => "live", withheld)
    .map((u) => [u.unit.id, u.state]);
  assert.deepEqual(run([]), [[U1, "open"], [U3, "after_previous"], [U4, "after_previous"]]);
  assert.deepEqual(run([U1]), [[U1, "done"], [U3, "open"], [U4, "after_previous"]], "unit 3 waits on unit 2");
});

test("the gates are the signed night-practice levels", () => {
  assert.deepEqual(STEADIER_SLEEP.units.map((u) => [u.minTier, u.maxActivation]), [
    [AccessTier.GROUNDING_ONLY, 10], [AccessTier.STABILIZATION, 7], [AccessTier.GROUNDING_ONLY, 10], [AccessTier.GROUNDING_ONLY, 10],
  ]);
  // At activation 8 the part that asks a member to get up at night is not
  // today; the rest stand as they are.
  const high = { tier: AccessTier.STEADY, activation: 8, imagery: true };
  const s = unitStates(STEADIER_SLEEP, new Set([U1]), high, () => "live").map((u) => u.state);
  assert.deepEqual(s, ["done", "not_today", "after_previous", "after_previous"]);
});

// ── Through the store ────────────────────────────────────────────────────────

test("joining without the answers is refused and writes nothing", async () => {
  const m = member();
  await assert.rejects(enrollInProgram(m, SS), (e: Error) => e instanceof ProgramRefused && e.message === "entry_screen");
  await assert.rejects(enrollInProgram(m, SS, [true]), ProgramRefused);
  assert.equal(count("SELECT COUNT(*) AS n FROM program_enrollments WHERE user_id = ?", m), 0);
  assert.equal(count("SELECT COUNT(*) AS n FROM program_entry_screens WHERE user_id = ?", m), 0);
  assert.deepEqual(await openUnit(m, SS, U1), { ok: false, reason: "not_joined" });
});

test("any yes withholds unit 2 only, and the rest runs without it", async () => {
  const m = member();
  await enrollInProgram(m, SS, [true, false, false]);
  const v = (await programView(m, SS))!;
  assert.deepEqual(v.entry && v.entry.answered && v.entry.lines, [SCREEN.anyYes]);
  assert.deepEqual(await ids(m), [U1, U3, U4]);
  assert.deepEqual(await openUnit(m, SS, U2), { ok: false, reason: "absent" });
  await assert.rejects(completeUnit(m, SS, U2), ProgramRefused);
  await completeUnit(m, SS, U1);
  assert.equal((await openUnit(m, SS, U3)).ok, true, "unit 3 should follow unit 1 when unit 2 is withheld");
  await completeUnit(m, SS, U3);
  await completeUnit(m, SS, U4);
  const done = (await programView(m, SS))!;
  assert.equal(done.finished, true, "finishing should not wait on a withheld part");
});

test("all no keeps all four parts, in order", async () => {
  const m = member();
  await enrollInProgram(m, SS, NO);
  assert.deepEqual(await ids(m), [U1, U2, U3, U4]);
  const v = (await programView(m, SS))!;
  assert.deepEqual(v.entry && v.entry.answered && v.entry.lines, []);
  await completeUnit(m, SS, U1);
  assert.equal((await openUnit(m, SS, U2)).ok, true);
  assert.deepEqual(await openUnit(m, SS, U3), { ok: false, reason: "after_previous" });
});

test("question 2 adds the driving line", async () => {
  const m = member();
  await enrollInProgram(m, SS, [false, true, false]);
  const v = (await programView(m, SS))!;
  assert.deepEqual(v.entry && v.entry.answered && v.entry.lines, [SCREEN.anyYes, SCREEN.ifYes[1]]);
});

test("coded event only: the spine and the audit log say which screen and whether it withheld, nothing more", async () => {
  const m = member();
  await enrollInProgram(m, SS, [false, true, true]);
  const ev = db.prepare("SELECT payload FROM longitudinal_events WHERE person_id = ? AND event_type = 'program.entry_screened'").all(m) as Array<{ payload: string }>;
  assert.equal(ev.length, 1);
  assert.deepEqual(JSON.parse(ev[0].payload), { programId: SS, screenId: "sleep-entry-v1", withheld: true });
  const au = db.prepare("SELECT detail_json FROM audit_log WHERE actor_id = ? AND event_type = 'program_entry_screened'").all(m) as Array<{ detail_json: string }>;
  assert.equal(au.length, 1);
  assert.deepEqual(JSON.parse(au[0].detail_json), { screenId: "sleep-entry-v1", withheld: true });
  // The row holds a code, not the answers.
  const cols = (db.prepare("PRAGMA table_info(program_entry_screens)").all() as Array<{ name: string }>).map((c) => c.name).sort();
  assert.deepEqual(cols, ["cleared_at", "created_at", "id", "note_keys", "program_id", "screen_id", "tenant_id", "user_id", "withheld"]);
  // And no question's words reach any record.
  for (const [table, col] of [["longitudinal_events", "payload"], ["audit_log", "detail_json"], ["alerts", "detail"]] as const) {
    const rows = db.prepare(`SELECT ${col} AS v FROM ${table}`).all() as Array<{ v: string | null }>;
    assert.ok(!rows.some((r) => /seizure|snore|driving/i.test(r.v ?? "")), `a question reached ${table}`);
  }
});

test("leaving clears the answers, and joining again asks again", async () => {
  const m = member();
  await enrollInProgram(m, SS, [true, false, false]);
  await completeUnit(m, SS, U1);
  await leaveProgram(m, SS);
  const left = (await programView(m, SS))!;
  assert.equal(left.entry?.answered, false, "the answers outlived leaving");
  await assert.rejects(enrollInProgram(m, SS), ProgramRefused, "joining again did not ask again");
  // The recorded risk of this choice: a different answer the second time
  // brings unit 2 back. The test pins the behaviour the product owner chose.
  await enrollInProgram(m, SS, NO);
  assert.deepEqual(await ids(m), [U1, U2, U3, U4]);
  assert.equal((await programView(m, SS))!.units[0].state, "done", "leaving lost what was done");
  assert.equal(count("SELECT COUNT(*) AS n FROM program_entry_screens WHERE user_id = ? AND cleared_at IS NULL", m), 1);
  assert.equal(count("SELECT COUNT(*) AS n FROM program_entry_screens WHERE user_id = ?", m), 2, "the earlier answer should be kept, cleared");
});

test("a joined member with no live answer is asked before anything opens", async () => {
  const m = member();
  db.prepare("INSERT INTO program_enrollments (id, user_id, program_id, status) VALUES (?, ?, ?, 'active')").run(newId(), m, SS);
  assert.deepEqual(await openUnit(m, SS, U1), { ok: false, reason: "entry_screen" });
  await enrollInProgram(m, SS, NO);
  assert.equal((await openUnit(m, SS, U1)).ok, true);
});

// ── The activities ───────────────────────────────────────────────────────────

test("the wind-down plan takes two or three from the list or their own, and screens their own", async () => {
  const m = member();
  await enrollInProgram(m, SS, NO);
  const plan = (picks: string[], own?: string) => saveActivityEntry(m, SS, U1, { kind: "wind-down-plan", picks, own });
  await assert.rejects(plan(["Dim the lights"]), (e: Error) => e instanceof ActivityRefused && e.code === "pick_two_or_three");
  await assert.rejects(plan(["Dim the lights", "A warm shower", "Write tomorrow's to-do list", "Put the phone across the room"]), ActivityRefused);
  await assert.rejects(plan(["Dim the lights", "Count sheep"]), (e: Error) => e instanceof ActivityRefused && e.code === "not_on_menu");
  await assert.rejects(plan(["Dim the lights", "Your own: ____"]), ActivityRefused, "the write-your-own marker is not an item");
  assert.deepEqual(await plan(["Dim the lights"], CRISIS), { ok: false, crisis: true });
  assert.equal(count("SELECT COUNT(*) AS n FROM activity_entries WHERE user_id = ?", m), 0);
  const ok = await plan(["Dim the lights"], "herbal tea");
  assert.ok(ok.ok);
  assert.equal((await programView(m, SS))!.units[0].state, "done");
});

test("the sleep window stores the getting-up time and nothing else (CV10_C03)", async () => {
  const m = member();
  await enrollInProgram(m, SS, NO);
  await completeUnit(m, SS, U1);
  for (const bad of ["7am", "24:00", "07:60", "7:00", ""]) {
    await assert.rejects(saveActivityEntry(m, SS, U2, { kind: "sleep-window", wakeTime: bad }), ActivityRefused, bad);
  }
  const extra = { kind: "sleep-window", wakeTime: "06:45", bedtime: "23:00", timeInBedMinutes: 360 } as unknown as Parameters<typeof saveActivityEntry>[3];
  const saved = await saveActivityEntry(m, SS, U2, extra);
  assert.ok(saved.ok);
  const { decryptField } = await import("../src/lib/crypto");
  const row = db.prepare("SELECT payload_enc FROM activity_entries WHERE id = ?").get(saved.id) as { payload_enc: string };
  assert.deepEqual(JSON.parse(decryptField(row.payload_enc)), { kind: "sleep-window", wakeTime: "06:45" }, "something besides the getting-up time was kept");
  assert.deepEqual((await memberEntries(m, SS)).find((e) => e.kind === "sleep-window")!.summary, ["06:45"]);
});

test("no code computes or suggests a bedtime or a time-in-bed limit (CV10_C03)", () => {
  const FORBIDDEN = /bed\s*time|time\W*in\W*bed|sleep\W*(restriction|compression|efficiency)|window\W*(start|end|length|minutes|hours)/i;
  const files = [
    "src/lib/programs.ts", "src/lib/program-activities.ts", "src/lib/program-actions.ts", "src/lib/mobile/programs.ts",
    ...walk("src/app/app/programs"), ...walk("src/app/api/mobile/v1/programs"), ...walk("src/app/api/mobile/v1/activity-entries"),
  ];
  // Comments may say what is excluded; code may not do it.
  const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ").replace(/\{\/\*[\s\S]*?\*\/\}/g, " ");
  const hits = files.filter((f) => FORBIDDEN.test(code(fs.readFileSync(path.join(process.cwd(), f), "utf8"))));
  assert.deepEqual(hits, []);
  // The one content string that says "Bedtime" is the signed note that it can move.
  const sleepCopy = JSON.stringify(STEADIER_SLEEP);
  assert.deepEqual(sleepCopy.match(/bed\s*time/gi), ["Bedtime"]);
  assert.match(STEADIER_SLEEP.units[1].copy!.note!, /^This is your anchor\. Bedtime can move around/);
});

function walk(dir: string): string[] {
  const abs = path.join(process.cwd(), dir);
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(path.join(dir, d.name)) : /\.tsx?$/.test(d.name) ? [path.join(dir, d.name)] : []);
}

test("'Which parts helped most?' offers the earlier parts' items, without a withheld part", async () => {
  const withheldMember = member();
  await enrollInProgram(withheldMember, SS, [true, false, false]);
  await saveActivityEntry(withheldMember, SS, U1, { kind: "wind-down-plan", picks: ["Dim the lights", "A warm shower"], own: "herbal tea" });
  await completeUnit(withheldMember, SS, U3);
  const offered = await reflectOptions(withheldMember, SS, U4);
  assert.deepEqual(offered.slice(0, 3), ["Dim the lights", "A warm shower", "herbal tea"], "their own picks come first");
  assert.ok(!offered.includes("Put the phone across the room"), "an item they did not pick was offered");
  assert.ok(!STEADIER_SLEEP.units[1].list!.some((h) => offered.includes(h)), "a withheld part's habits were offered");
  assert.ok(offered.includes("After a bad dream") && offered.includes("Back to rest"));

  const fullMember = member();
  await enrollInProgram(fullMember, SS, NO);
  await completeUnit(fullMember, SS, U1);
  await completeUnit(fullMember, SS, U2);
  await completeUnit(fullMember, SS, U3);
  const all = await reflectOptions(fullMember, SS, U4);
  assert.ok(STEADIER_SLEEP.units[1].list!.every((h) => all.includes(h)), "unit 2's habits are missing");
  assert.ok(all.includes("Dim the lights"), "with no plan saved, the list itself is offered");
  assert.ok(!all.some((o) => o.endsWith(": ____")));

  const r = (helped: string[], keepDoing?: string) => saveActivityEntry(withheldMember, SS, U4, { kind: "sleep-reflect", helped, keepDoing });
  await assert.rejects(r(["Sleeping pills"]), (e: Error) => e instanceof ActivityRefused && e.code === "not_on_list");
  assert.deepEqual(await r(["A warm shower"], CRISIS), { ok: false, crisis: true });
  const ok = await r(["A warm shower", "After a bad dream"], "the shower");
  assert.ok(ok.ok);
  assert.equal((await programView(withheldMember, SS))!.finished, true);
});

test("'When nights are rough' has nothing to fill in, and is done with one tap", async () => {
  const m = member();
  await enrollInProgram(m, SS, [true, false, false]);
  await completeUnit(m, SS, U1);
  assert.equal(STEADIER_SLEEP.units[2].activity, "none");
  await completeUnit(m, SS, U3);
  assert.equal((await programView(m, SS))!.units.find((u) => u.unit.id === U3)!.state, "done");
});

test("the program is not shown while its entry screen's row is sent back", async () => {
  const { SAFETY_CONFIG_VERSION } = await import("../src/lib/safety/governance");
  // The latest verdict wins (same second: insertion order), so the last line
  // of this test restores the signed standing for anything after it.
  const sign = (verdict: "agree" | "needs_change") =>
    db.prepare("INSERT INTO autonomous_signoffs (id, rule_id, config_version, verdict) VALUES (?, 'CV10_C04', ?, ?)")
      .run(newId(), SAFETY_CONFIG_VERSION, verdict);
  const m = member();
  assert.ok(await programView(m, SS));
  sign("needs_change");
  assert.equal(await programView(m, SS), null, "a program whose safety questions are not signed was shown");
  await assert.rejects(enrollInProgram(m, SS, NO), ProgramRefused);
  sign("agree");
  assert.ok(await programView(m, SS));
});
