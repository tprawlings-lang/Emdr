// Programs (Handoff 10 §3.2, §7 "programs.test.ts"): unlock order, re-gating
// per unit, leave and re-join, no counts in the view, and a rebuild from the
// spine that reproduces the rows.

process.env.EMDR_DATA_DIR = `/tmp/steady-programs-${process.pid}-${Date.now()}`;
process.env.EMDR_SESSION_SECRET = "programs-secret-at-least-32-characters-long";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "programs-key";

import { strict as assert } from "node:assert";
import test from "node:test";

import { getDb, newId, PLATFORM_TENANT_ID } from "../src/lib/db";
import { todayISO } from "../src/lib/gating";
import { AccessTier } from "../src/lib/safety/types";
import {
  completeUnit, enrollInProgram, leaveProgram, memberPrograms, menuFor, openUnit, programView,
  ProgramRefused, unitAllowed, unitStates, PROGRAMS,
} from "../src/lib/programs";
import { MOVING_TOWARD } from "../src/lib/content/h10-programs";
import { verifyProjections } from "../src/lib/projections";

const db = getDb();
const MT = MOVING_TOWARD.id;
const [U1, U2, U3, U4] = MOVING_TOWARD.units.map((u) => u.id);

function member(checkin?: { activation: number }): string {
  const id = newId();
  db.prepare("INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, 'M', 'fabricated')").run(id, PLATFORM_TENANT_ID);
  db.prepare("INSERT INTO users (id, tenant_id, email, password_hash, role, name) VALUES (?, ?, ?, 'x', 'member', 'M')")
    .run(id, PLATFORM_TENANT_ID, `${id}@programs.test`);
  if (checkin) {
    db.prepare(`INSERT INTO checkins (id, user_id, checkin_date, activation, shutdown, harm_urge, feels_safe, dissociation,
        sleep_quality, substance_flag, recommended_action) VALUES (?, ?, ?, ?, 2, 0, 1, 1, 7, 0, 'processing_ok')`)
      .run(newId(), id, todayISO(), checkin.activation);
  }
  return id;
}

// ── Pure rules ───────────────────────────────────────────────────────────────

test("a unit opens only under its own gate; unknown activation reads as 10", () => {
  const u = MOVING_TOWARD.units[0]; // stabilization, ceiling 6
  assert.equal(unitAllowed(u, { tier: AccessTier.STABILIZATION, activation: 6, imagery: true }), true);
  assert.equal(unitAllowed(u, { tier: AccessTier.GROUNDING_ONLY, activation: 2, imagery: true }), false);
  assert.equal(unitAllowed(u, { tier: AccessTier.STEADY, activation: 7, imagery: true }), false);
  assert.equal(unitAllowed(u, { tier: AccessTier.STEADY, activation: null, imagery: true }), false);
  assert.equal(unitAllowed(u, null), false);
});

test("units open in order, one after another", () => {
  const gate = { tier: AccessTier.STEADY, activation: 2, imagery: true };
  const states = (done: string[]) =>
    unitStates(MOVING_TOWARD, new Set(done), gate, () => "live").map((u) => u.state);
  assert.deepEqual(states([]), ["open", "after_previous", "after_previous", "after_previous"]);
  assert.deepEqual(states([U1]), ["done", "open", "after_previous", "after_previous"]);
  // The rule is the handoff's, literally: unit N+1 opens when unit N is done.
  // (A unit cannot be completed out of order through the store — see below —
  // so this shape only arises from hand-written rows.)
  assert.deepEqual(states([U1, U3]), ["done", "open", "done", "open"]);
});

test("a unit below today's gate says not today, the others stand as they are", () => {
  const stabilization = { tier: AccessTier.STABILIZATION, activation: 3, imagery: true };
  const s = unitStates(MOVING_TOWARD, new Set([U1, U2]), stabilization, () => "live").map((u) => u.state);
  assert.deepEqual(s, ["done", "done", "not_today", "after_previous"], "unit 3 needs the cautious tier");
});

test("an unsigned unit ends the visible program there", () => {
  const s = unitStates(MOVING_TOWARD, new Set(), null, (u) => (u.id === U3 ? null : "live"));
  assert.deepEqual(s.map((u) => u.unit.id), [U1, U2]);
});

test("at the stabilization tier the menu is Gentle only (CV10_B02)", () => {
  const cats = MOVING_TOWARD.units[1].copy!.categories!;
  assert.deepEqual(menuFor(cats, { tier: AccessTier.STABILIZATION, activation: 3, imagery: true }).map((c) => c.name), ["Gentle"]);
  assert.equal(menuFor(cats, { tier: AccessTier.CAUTIOUS, activation: 3, imagery: true }).length, 4);
  assert.deepEqual(menuFor(cats, null).map((c) => c.name), ["Gentle"], "an unreadable gate is the gentlest menu");
});

// ── Through the store ────────────────────────────────────────────────────────

test("the signed program is listed", async () => {
  const views = await memberPrograms(member({ activation: 2 }));
  // A member on no care path sees every program that is not offered by path
  // (Feeling and Relating is: tests/feeling-and-relating.test.ts).
  assert.deepEqual(views.map((v) => v.program.id), PROGRAMS.filter((p) => !p.paths).map((p) => p.id));
  assert.equal(views[0].visibility, "live");
});

test("nothing opens until the member joins", async () => {
  const m = member({ activation: 2 });
  assert.deepEqual(await openUnit(m, MT, U1), { ok: false, reason: "not_joined" });
  await assert.rejects(completeUnit(m, MT, U1), ProgramRefused);
});

test("units complete in order, idempotently, and out-of-order is refused", async () => {
  const m = member({ activation: 2 });
  await enrollInProgram(m, MT);
  await assert.rejects(completeUnit(m, MT, U2), ProgramRefused, "unit 2 before unit 1");
  await completeUnit(m, MT, U1);
  await completeUnit(m, MT, U1);
  const n = db.prepare("SELECT COUNT(*) AS n FROM program_unit_completions WHERE user_id = ?").get(m) as { n: number };
  assert.equal(n.n, 1);
  assert.equal((await programView(m, MT))!.next!.id, U2);
});

test("leaving keeps what was done, and joining again picks it up on the same row", async () => {
  const m = member({ activation: 2 });
  await enrollInProgram(m, MT);
  await completeUnit(m, MT, U1);
  const first = db.prepare("SELECT id, created_at FROM program_enrollments WHERE user_id = ?").get(m) as { id: string; created_at: string };
  await leaveProgram(m, MT);
  assert.equal((await programView(m, MT))!.enrollment, "left");
  assert.deepEqual(await openUnit(m, MT, U2), { ok: false, reason: "not_joined" });
  await enrollInProgram(m, MT);
  const rows = db.prepare("SELECT id, created_at, status FROM program_enrollments WHERE user_id = ?").all(m) as Array<{ id: string; created_at: string; status: string }>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, first.id);
  assert.equal(rows[0].created_at, first.created_at, "joining again rewrote when they first joined");
  const v = (await programView(m, MT))!;
  assert.equal(v.units[0].state, "done");
  assert.equal(v.next!.id, U2);
});

test("with no check-in, every unit is not today — and grounding is still where it was", async () => {
  const m = member();
  await enrollInProgram(m, MT);
  assert.deepEqual(await openUnit(m, MT, U1), { ok: false, reason: "not_today" });
});

test("the view model carries no count, total, streak or date gap", async () => {
  const m = member({ activation: 2 });
  await enrollInProgram(m, MT);
  const v = (await programView(m, MT))!;
  // `entry` is the entry screen's standing: answered or not, and the signed
  // words to say — never a count (Steadier Sleep, 1C).
  assert.deepEqual(Object.keys(v).sort(), ["enrollment", "entry", "finished", "next", "program", "units", "visibility"]);
  for (const u of v.units) assert.deepEqual(Object.keys(u).sort(), ["state", "unit", "visibility"]);
});

test("a program is finished only when every unit is done", async () => {
  const m = member({ activation: 2 });
  await enrollInProgram(m, MT);
  for (const u of [U1, U2, U3]) await completeUnit(m, MT, u);
  assert.equal((await programView(m, MT))!.finished, false);
  await completeUnit(m, MT, U4);
  const v = (await programView(m, MT))!;
  assert.equal(v.finished, true);
  assert.equal(v.next, null);
});

test("a rebuild from the spine reproduces the program rows", async () => {
  const m = member({ activation: 2 });
  await enrollInProgram(m, MT);
  await completeUnit(m, MT, U1);
  await leaveProgram(m, MT);
  await enrollInProgram(m, MT);
  const result = await verifyProjections({ personId: m });
  const programDiffs = result.diffs.filter((d) => d.table.startsWith("program_"));
  assert.deepEqual(programDiffs, [], "the rebuilt program rows differ from the live ones");
  assert.ok((result.compared.program_enrollments ?? 0) > 0, "enrolments were not compared");
  assert.ok((result.compared.program_unit_completions ?? 0) > 0, "completions were not compared");
});
