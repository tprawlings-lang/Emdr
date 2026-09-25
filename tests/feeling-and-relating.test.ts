// Feeling and Relating (Handoff 10 2A; rows CV10_D01 to D03, F02):
//
//   - offered on the trauma path; on the complex trauma readiness path only
//     once that path's clinician review is recorded — nothing records one yet,
//     so there it is not offered (the product owner's choice, 25 September),
//     and a member on both paths is held by the one that needs review;
//   - units 1 to 4 at the stabilization tier, ceiling 6; 5 to 8 at the
//     cautious tier, ceiling 5; no imagery;
//   - units 5 to 7 ask about relationships now, and open by saying so;
//   - never named as the method it is informed by;
//   - what a member writes is screened, and a skill pick is one of the unit's.

process.env.EMDR_DATA_DIR = `/tmp/steady-feeling-relating-${process.pid}-${Date.now()}`;
process.env.EMDR_SESSION_SECRET = "feeling-relating-secret-at-least-32-chars";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "feeling-relating-key";

import { strict as assert } from "node:assert";
import test from "node:test";

import { getDb, newId, PLATFORM_TENANT_ID } from "../src/lib/db";
import { todayISO } from "../src/lib/gating";
import { AccessTier } from "../src/lib/safety/types";
import { addMemberTrack } from "../src/lib/tracks";
import { getPractice } from "../src/lib/practices";
import {
  completeUnit, enrollInProgram, memberPrograms, openUnit, programAllowedOnPaths, programView, ProgramRefused,
} from "../src/lib/programs";
import { ActivityRefused, memberEntries, saveActivityEntry } from "../src/lib/program-activities";
import { FEELING_AND_RELATING } from "../src/lib/content/h10-programs";

const db = getDb();
const FR = FEELING_AND_RELATING.id;
const U = FEELING_AND_RELATING.units.map((u) => u.id);
const OPENING = "This unit is about relationships in your life right now. There's no need to go back over past events.";
const CRISIS = "I want to kill myself";

function member(activation = 2): string {
  const id = newId();
  db.prepare("INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, 'M', 'fabricated')").run(id, PLATFORM_TENANT_ID);
  db.prepare("INSERT INTO users (id, tenant_id, email, password_hash, role, name) VALUES (?, ?, ?, 'x', 'member', 'M')")
    .run(id, PLATFORM_TENANT_ID, `${id}@fr.test`);
  db.prepare(`INSERT INTO checkins (id, user_id, checkin_date, activation, shutdown, harm_urge, feels_safe, dissociation,
      sleep_quality, substance_flag, recommended_action) VALUES (?, ?, ?, ?, 2, 0, 1, 1, 7, 0, 'processing_ok')`)
    .run(newId(), id, todayISO(), activation);
  return id;
}

async function onPaths(paths: string[], activation = 2): Promise<string> {
  const m = member(activation);
  for (const p of paths) await addMemberTrack(m, p);
  return m;
}

/** Walk a member to a unit by completing the ones before it. */
async function reach(m: string, index: number): Promise<void> {
  await enrollInProgram(m, FR);
  for (const id of U.slice(0, index)) await completeUnit(m, FR, id);
}

// ── Which paths ──────────────────────────────────────────────────────────────

test("the path rule: trauma path yes; complex path only once reviewed; the complex path holds even beside the trauma path", () => {
  const none = new Set<string>();
  const reviewed = new Set(["complex_readiness"]);
  const allowed = (paths: string[], r: ReadonlySet<string>) => programAllowedOnPaths(FEELING_AND_RELATING, paths, r);
  assert.equal(allowed([], none), false, "no path");
  assert.equal(allowed(["depression_adjunct"], none), false, "a path it is not offered on");
  assert.equal(allowed(["ptsd_trauma"], none), true);
  assert.equal(allowed(["complex_readiness"], none), false, "complex path, not reviewed");
  assert.equal(allowed(["complex_readiness"], reviewed), true, "complex path, reviewed");
  assert.equal(allowed(["ptsd_trauma", "complex_readiness"], none), false, "the trauma path let a member past the complex path's review");
  assert.equal(allowed(["ptsd_trauma", "complex_readiness"], reviewed), true);
  assert.equal(programAllowedOnPaths({}, [], none), true, "a program with no paths is for everyone");
});

test("through the store: shown on the trauma path, and nowhere else today", async () => {
  const has = async (m: string) => (await memberPrograms(m)).some((v) => v.program.id === FR);
  assert.equal(await has(await onPaths(["ptsd_trauma"])), true);
  assert.equal(await has(await onPaths([])), false);
  assert.equal(await has(await onPaths(["anxiety_panic"])), false);
  const complex = await onPaths(["complex_readiness"]);
  assert.equal(await has(complex), false, "no review can be recorded yet, so the complex path must not see it");
  assert.equal(await programView(complex, FR), null);
  await assert.rejects(enrollInProgram(complex, FR), ProgramRefused, "a hidden program could be joined");
  assert.equal(await has(await onPaths(["ptsd_trauma", "complex_readiness"])), false);
});

test("leaving the path closes the program; what was done is kept", async () => {
  const m = await onPaths(["ptsd_trauma"]);
  await reach(m, 1);
  const { archiveMemberTrack } = await import("../src/lib/tracks");
  await archiveMemberTrack(m, "ptsd_trauma");
  assert.deepEqual(await openUnit(m, FR, U[1]), { ok: false, reason: "absent" });
  await addMemberTrack(m, "ptsd_trauma");
  assert.equal((await programView(m, FR))!.units[0].state, "done");
});

// ── The signed shape ─────────────────────────────────────────────────────────

test("eight units, gated as signed (CV10_D02)", () => {
  assert.equal(FEELING_AND_RELATING.units.length, 8);
  assert.deepEqual(FEELING_AND_RELATING.units.map((u) => [u.minTier, u.maxActivation]), [
    ...Array(4).fill([AccessTier.STABILIZATION, 6]), ...Array(4).fill([AccessTier.CAUTIOUS, 5]),
  ]);
  assert.deepEqual([...FEELING_AND_RELATING.signoffRowIds].sort(), ["CV10_D01", "CV10_D02", "CV10_F02"]);
  for (const u of FEELING_AND_RELATING.units) assert.deepEqual([...u.signoffRowIds].sort(), ["CV10_D02", "CV10_D03"]);
});

test("no imagery: every practice a unit offers exists and uses none", () => {
  for (const u of FEELING_AND_RELATING.units) {
    for (const id of u.practiceIds) {
      const p = getPractice(id);
      assert.ok(p, `${u.id}: ${id} does not exist`);
      assert.notEqual(p.imagery, true, `${u.id}: ${id} uses imagery`);
    }
  }
});

test("units 5 to 7 are about relationships now, and open by saying so (CV10_D03)", () => {
  const withOpening = FEELING_AND_RELATING.units.filter((u) => u.text?.[0] === OPENING).map((u) => u.id);
  assert.deepEqual(withOpening, U.slice(4, 7));
  // Nothing asks a member to recount the past.
  const PAST = /\b(remember when|what happened (to you|back then)|as a child|growing up|your past|that time when)\b/i;
  for (const u of FEELING_AND_RELATING.units) assert.doesNotMatch(u.copy?.prompt ?? "", PAST, u.id);
});

test("never named as the method it is informed by", () => {
  const copy = JSON.stringify({ ...FEELING_AND_RELATING, signoffRowIds: [], units: FEELING_AND_RELATING.units.map((u) => ({ ...u, signoffRowIds: [] })) });
  assert.doesNotMatch(copy, /STAIR|Cloitre|skills training in affective/i);
});

// ── Gates, through the store ─────────────────────────────────────────────────

test("above 5, the later units are not today while the early ones stay open", async () => {
  const m = await onPaths(["ptsd_trauma"], 6);
  await reach(m, 4);
  assert.deepEqual(await openUnit(m, FR, U[4]), { ok: false, reason: "not_today" });
  const calm = await onPaths(["ptsd_trauma"], 5);
  await reach(calm, 4);
  assert.equal((await openUnit(calm, FR, U[4])).ok, true);
  const high = await onPaths(["ptsd_trauma"], 7);
  await enrollInProgram(high, FR);
  assert.deepEqual(await openUnit(high, FR, U[0]), { ok: false, reason: "not_today" }, "unit 1's ceiling is 6");
});

// ── The activities ───────────────────────────────────────────────────────────

test("a written reflection needs words, is screened, and is the member's own", async () => {
  const m = await onPaths(["ptsd_trauma"]);
  await enrollInProgram(m, FR);
  await assert.rejects(saveActivityEntry(m, FR, U[0], { kind: "reflect-text", text: "   " }),
    (e: Error) => e instanceof ActivityRefused && e.code === "write_something");
  assert.deepEqual(await saveActivityEntry(m, FR, U[0], { kind: "reflect-text", text: CRISIS }), { ok: false, crisis: true });
  assert.equal((await programView(m, FR))!.units[0].state, "open", "the crisis text completed the unit");
  const ok = await saveActivityEntry(m, FR, U[0], { kind: "reflect-text", text: "tired, then relieved, then annoyed" });
  assert.ok(ok.ok);
  assert.deepEqual((await memberEntries(m, FR))[0].summary, ["tired, then relieved, then annoyed"]);
});

test("feeling words: one or two, typed, screened", async () => {
  const m = await onPaths(["ptsd_trauma"]);
  await reach(m, 1);
  const save = (words: string[]) => saveActivityEntry(m, FR, U[1], { kind: "feeling-words", words });
  await assert.rejects(save([]), (e: Error) => e instanceof ActivityRefused && e.code === "one_or_two_words");
  await assert.rejects(save(["sad", "tired", "flat"]), ActivityRefused);
  assert.deepEqual(await save(["sad", CRISIS]), { ok: false, crisis: true });
  const ok = await save(["uneasy", "hopeful"]);
  assert.ok(ok.ok);
});

test("the skill pick is one of the unit's own, shown back by its title", async () => {
  const m = await onPaths(["ptsd_trauma"]);
  await reach(m, 3);
  await assert.rejects(saveActivityEntry(m, FR, U[3], { kind: "skill-pick", practiceId: "skill-values-check" }),
    (e: Error) => e instanceof ActivityRefused && e.code === "pick_one");
  const ok = await saveActivityEntry(m, FR, U[3], { kind: "skill-pick", practiceId: "skill-ride-the-urge" });
  assert.ok(ok.ok);
  assert.deepEqual((await memberEntries(m, FR)).find((e) => e.kind === "skill-pick")!.summary, ["Ride the urge"]);
});

test("a reflection on a relationship is screened too", async () => {
  const m = await onPaths(["ptsd_trauma"]);
  await reach(m, 5);
  assert.deepEqual(await saveActivityEntry(m, FR, U[5], { kind: "reflect-text", text: CRISIS }), { ok: false, crisis: true });
  const ok = await saveActivityEntry(m, FR, U[5], { kind: "reflect-text", text: "Ask my brother to call on Sunday." });
  assert.ok(ok.ok);
});
