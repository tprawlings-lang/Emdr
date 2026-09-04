// Return-to-Life goals (Clinical Intelligence Expansion, handoff 01).
//
// §14's acceptance criteria, and the three that carry the weight:
//
//   AI cannot invent a baseline, choose the goal, or silently advance progress.
//   Patient report and clinician observation display differently.
//   A completed life goal does not create a diagnosis/remission/treatment claim.
//
// The first is the one a passing screen can hide. A model candidate that moves
// a level looks exactly like a patient reporting progress — right number, right
// goal, right date — and the only thing separating them is which column the
// evidence was written into.

process.env.EMDR_DATA_DIR = `/tmp/steady-rtl-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "rtl-test-secret-at-least-32-characters-long";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "rtl-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";

import { getDb } from "../src/lib/db";
import type { TenantContext } from "../src/lib/repository";
import {
  createGoal, confirmGoal, recordObservation, decideObservation, refreshLevel,
  foldLevel, listGoals, getGoal, ladderFor, observationsFor,
  GOAL_LEVELS, GOAL_DOMAINS, EVIDENCE_LABEL, LEVEL_LABEL,
  BASELINE_NOTE, COMPLETION_NOTE, GoalError,
  type GoalLadderRung, type GoalObservation,
} from "../src/lib/clinical/return-to-life";

const db = getDb();
const T = { tenant: "tenant-rtl", clinician: "clin-rtl", patient: "pat-rtl", other: "pat-other" };
db.prepare("INSERT OR IGNORE INTO tenants (id, kind, name) VALUES (?, 'organization', ?)").run(T.tenant, T.tenant);
for (const id of [T.clinician, T.patient, T.other]) {
  db.prepare("INSERT OR IGNORE INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, 'X', 'fabricated')")
    .run(id, T.tenant);
}
const ctx: TenantContext = { tenantId: T.tenant, personId: T.clinician };
const NOW = "2026-09-04T10:00:00.000Z";

/** §8's worked example, which is also a good ladder: observable, one dimension,
 *  a baseline that describes rather than judges. */
const LADDER: GoalLadderRung[] = [
  { level: -2, description: "Cannot enter the store alone." },
  { level: -1, description: "Enters alone for a few items, leaves early if distress rises." },
  { level: 0, description: "Completes a normal grocery trip alone." },
  { level: 1, description: "Completes normal trips alone across different stores and times." },
  { level: 2, description: "Shops alone comfortably and can stay when plans change." },
];

async function aGoal(over: Partial<Parameters<typeof createGoal>[1]> = {}) {
  return createGoal(ctx, {
    personId: T.patient,
    title: "Grocery shopping alone",
    patientStatement: "I want to shop without needing someone with me.",
    whyItMatters: "I want my independence back.",
    domain: "daily_living",
    ladder: LADDER,
    ...over,
  });
}

async function anActiveGoal() {
  const g = await aGoal();
  return confirmGoal(ctx, g.id, NOW);
}

// ---------------------------------------------------------------------------
// The goal is patient-owned
// ---------------------------------------------------------------------------

test("a new goal is a draft, and creation cannot say otherwise", async () => {
  const g = await aGoal();
  assert.equal(g.status, "draft",
    "§12: model-drafted language is not patient-owned until confirmed, and the only way to be sure is for creation to have one outcome");
  assert.equal(g.confirmedByPersonId, null);
  // Nothing was asserted about where the person is.
  assert.equal(g.currentLevel, null,
    "the baseline is a DESCRIPTION on the ladder; setting a level at creation asserts an observation nobody made");
});

test("confirming records who confirmed it", async () => {
  const g = await anActiveGoal();
  assert.equal(g.status, "active");
  assert.equal(g.confirmedByPersonId, T.clinician);
  assert.ok(g.confirmedAt);
});

test("a goal cannot be confirmed twice", async () => {
  const g = await anActiveGoal();
  await assert.rejects(() => confirmGoal(ctx, g.id, NOW), GoalError);
});

test("the patient's own words are stored and returned intact", async () => {
  const g = await aGoal();
  assert.equal(g.patientStatement, "I want to shop without needing someone with me.");
  assert.equal(g.whyItMatters, "I want my independence back.");
  // §3: "patient meaning is stored... it should not be used as an AI outcome
  // score." It is a string on the goal, not a number anywhere.
  assert.equal(typeof g.whyItMatters, "string");
});

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------

test("a goal needs exactly five levels, one per rung", async () => {
  await assert.rejects(
    () => aGoal({ ladder: LADDER.slice(0, 4) }), GoalError,
    "four rungs is an incomplete ladder"
  );
  await assert.rejects(
    () => aGoal({ ladder: [...LADDER, { level: 0, description: "duplicate" }] as GoalLadderRung[] }),
    GoalError,
    "two descriptions of the same rung is two goals wearing one"
  );
});

test("every rung needs a description a person could recognise", async () => {
  await assert.rejects(
    () => aGoal({ ladder: LADDER.map((r) => (r.level === 0 ? { ...r, description: "   " } : r)) }),
    GoalError
  );
});

test("the ladder reads back in order, from baseline upward", async () => {
  const g = await aGoal();
  const rungs = await ladderFor(ctx, g.id);
  assert.deepEqual(rungs.map((r) => r.level), [...GOAL_LEVELS]);
  assert.equal(rungs[0].description, "Cannot enter the store alone.");
});

test("the ladder is described in plain language, not scoring language", () => {
  // §9: "show levels in plain language, not clinical scoring language." A
  // patient should not have to learn what -2 means to understand their own goal.
  for (const l of GOAL_LEVELS) {
    assert.ok(LEVEL_LABEL[l].length > 0);
    assert.ok(!/-?[0-9]/.test(LEVEL_LABEL[l]), `level ${l} is labelled with a number`);
  }
  assert.equal(LEVEL_LABEL[-2], "Where you are now");
});

test("the baseline says it is not a failure, and completion is not cure", () => {
  // §3 and §1, said once in the domain so every surface says it the same way.
  assert.match(BASELINE_NOTE, /not a failure/);
  assert.match(COMPLETION_NOTE, /not a statement about symptoms|not a statement about/);
  assert.match(COMPLETION_NOTE, /diagnosis/);
  assert.match(COMPLETION_NOTE, /caused/);
});

// ---------------------------------------------------------------------------
// Evidence classes stay separate
// ---------------------------------------------------------------------------

test("all four evidence classes have distinct clinician-facing wording", () => {
  const labels = Object.values(EVIDENCE_LABEL);
  assert.equal(new Set(labels).size, labels.length,
    "§14: patient report and clinician observation must display differently");
  assert.notEqual(EVIDENCE_LABEL.patient_reported, EVIDENCE_LABEL.clinician_observed);
  // And the model's is unmistakably a suggestion.
  assert.match(EVIDENCE_LABEL.model_candidate, /suggest/i);
});

test("a patient report and a clinician observation are both accepted, and stay distinguishable", async () => {
  const g = await anActiveGoal();
  const reported = await recordObservation(ctx, {
    goalId: g.id, personId: T.patient, observedLevel: -1,
    evidenceClass: "patient_reported", sourceType: "goal_checkin", sourceId: "c1",
    occurredAt: "2026-08-01T09:00:00.000Z",
  });
  const observed = await recordObservation(ctx, {
    goalId: g.id, personId: T.patient, observedLevel: 0,
    evidenceClass: "clinician_observed", sourceType: "clinician_note", sourceId: "n1",
    occurredAt: "2026-08-15T09:00:00.000Z",
  });
  assert.equal(reported.status, "accepted", "a patient's report is the report, not a proposal");
  assert.equal(observed.status, "accepted");
  assert.notEqual(reported.evidenceClass, observed.evidenceClass);
});

// ---------------------------------------------------------------------------
// A model candidate cannot move a level
// ---------------------------------------------------------------------------

test("a model candidate is written proposed, whatever the caller wants", async () => {
  const g = await anActiveGoal();
  const m = await recordObservation(ctx, {
    goalId: g.id, personId: T.patient, observedLevel: 2,
    evidenceClass: "model_candidate", sourceType: "thought_item", sourceId: "i1",
    occurredAt: "2026-08-20T09:00:00.000Z",
  });
  assert.equal(m.status, "proposed", "§7's hard boundary: proposes evidence only");
  assert.equal(m.decidedBy, null);
});

test("a proposed observation does not move the level", async () => {
  const g = await anActiveGoal();
  await recordObservation(ctx, {
    goalId: g.id, personId: T.patient, observedLevel: -1,
    evidenceClass: "patient_reported", sourceType: "goal_checkin", sourceId: "c1",
    occurredAt: "2026-08-01T09:00:00.000Z",
  });
  await refreshLevel(ctx, g.id, NOW);
  const model = await recordObservation(ctx, {
    goalId: g.id, personId: T.patient, observedLevel: 2,
    evidenceClass: "model_candidate", sourceType: "thought_item", sourceId: "i1",
    occurredAt: "2026-08-20T09:00:00.000Z",
  });
  const after = await refreshLevel(ctx, g.id, NOW);
  assert.equal(after.current, -1,
    "a model candidate that could advance a level is silent progress, which §14 forbids outright");

  // Until a person accepts it.
  await decideObservation(ctx, model.id, "accepted", NOW);
  const accepted = await refreshLevel(ctx, g.id, NOW);
  assert.equal(accepted.current, 2);
  assert.equal(accepted.changed, true);
});

test("a rejected observation never counts", async () => {
  const g = await anActiveGoal();
  const m = await recordObservation(ctx, {
    goalId: g.id, personId: T.patient, observedLevel: 2,
    evidenceClass: "model_candidate", sourceType: "thought_item", sourceId: "i2",
    occurredAt: "2026-08-20T09:00:00.000Z",
  });
  await decideObservation(ctx, m.id, "rejected", NOW);
  const { current } = await refreshLevel(ctx, g.id, NOW);
  assert.equal(current, null);
});

test("an observation can only be decided once", async () => {
  const g = await anActiveGoal();
  const m = await recordObservation(ctx, {
    goalId: g.id, personId: T.patient, observedLevel: 1,
    evidenceClass: "model_candidate", sourceType: "x", sourceId: "y",
    occurredAt: NOW,
  });
  await decideObservation(ctx, m.id, "accepted", NOW);
  await assert.rejects(() => decideObservation(ctx, m.id, "rejected", NOW), GoalError);
});

// ---------------------------------------------------------------------------
// The level is derived
// ---------------------------------------------------------------------------

test("the level is the most recent accepted observation, not the best one", () => {
  const obs = (over: Partial<GoalObservation>): GoalObservation => ({
    id: "o", goalId: "g", personId: T.patient, observedLevel: 0,
    evidenceClass: "patient_reported", sourceType: "s", sourceId: "s",
    occurredAt: NOW, note: null, status: "accepted", decidedBy: null,
    decidedAt: null, createdAt: NOW, ...over,
  });
  const level = foldLevel([
    obs({ id: "a", observedLevel: 0, occurredAt: "2026-06-01T00:00:00.000Z" }),
    obs({ id: "b", observedLevel: -1, occurredAt: "2026-08-01T00:00:00.000Z" }),
  ]);
  // Progress is not monotonic. A person who managed the shop in June and could
  // not in August is at where they are now, and a fold taking the maximum would
  // describe a recovery that is not happening.
  assert.equal(level, -1);
});

test("no caller can set a level directly", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync("src/lib/clinical/return-to-life.ts", "utf8");
  // §3's rule holds because there is no other path. Counting every mention of
  // the column would count its type declaration and its mapper too, so this
  // looks at WRITES: the creation null, and the fold's update.
  const updates = [...src.matchAll(/\.update\(\s*"return_to_life_goals",\s*\{([^}]*)\}/g)]
    .map((m) => m[1]);
  const levelUpdates = updates.filter((u) => u.includes("current_level"));
  assert.equal(levelUpdates.length, 1, `expected one write path, found ${levelUpdates.length}`);
  assert.match(levelUpdates[0], /current_level:\s*current/,
    "the only write must be the fold's own result, not a caller's number");
  // And creation asserts nothing.
  assert.ok(/current_level:\s*null/.test(src));
});

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

test("evidence cannot be attached to a draft or an archived goal", async () => {
  const draft = await aGoal();
  await assert.rejects(
    () => recordObservation(ctx, {
      goalId: draft.id, personId: T.patient, observedLevel: 0,
      evidenceClass: "patient_reported", sourceType: "c", sourceId: "c",
      occurredAt: NOW,
    }),
    GoalError,
    "a goal nobody has agreed to must not acquire a progress record"
  );
});

test("another tenant's goal is not found, not forbidden", async () => {
  const g = await anActiveGoal();
  const other: TenantContext = { tenantId: "tenant-elsewhere", personId: "someone" };
  db.prepare("INSERT OR IGNORE INTO tenants (id, kind, name) VALUES ('tenant-elsewhere','organization','x')").run();
  assert.equal(await getGoal(other, g.id), null, "§14: cross-tenant attacks fail");
  assert.equal((await observationsFor(other, g.id)).length, 0);
});

test("goals list by person and status", async () => {
  const g = await anActiveGoal();
  const active = await listGoals(ctx, T.patient, ["active"]);
  assert.ok(active.some((x) => x.id === g.id));
  assert.equal((await listGoals(ctx, T.other, ["active"])).length, 0,
    "another person's goals must not appear");
});

test("every domain in §5's taxonomy is available, including patient-defined", () => {
  assert.equal(GOAL_DOMAINS.length, 8);
  // §5: "never force a goal into an incorrect category." A closed list with no
  // escape does exactly that.
  assert.ok(GOAL_DOMAINS.includes("other"));
});
