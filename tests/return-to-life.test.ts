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

// ---------------------------------------------------------------------------
// Phase 2 — evidence capture, and Session Prep
// ---------------------------------------------------------------------------

test("the three inlets keep their sources distinct", async () => {
  const {
    recordGoalCheckin, recordClinicianObservation, proposeModelEvidence,
  } = await import("../src/lib/clinical/return-goal-evidence");
  const g = await anActiveGoal();

  const patient = await recordGoalCheckin(ctx, {
    goalId: g.id, personId: T.patient, level: -1, at: "2026-08-01T09:00:00.000Z", checkinId: "chk1",
  });
  const clinician = await recordClinicianObservation(ctx, {
    goalId: g.id, personId: T.patient, level: 0, at: "2026-08-10T09:00:00.000Z", sourceId: "note1",
  });
  const model = await proposeModelEvidence(ctx, {
    goalId: g.id, personId: T.patient, level: 2,
    sourceType: "thought_item", sourceId: "item1", at: "2026-08-20T09:00:00.000Z",
  });

  // §14: patient report and clinician observation display differently, which
  // requires them to BE different in the record first.
  assert.equal(patient.evidenceClass, "patient_reported");
  assert.equal(clinician.evidenceClass, "clinician_observed");
  assert.equal(model.evidenceClass, "model_candidate");
  assert.equal(patient.status, "accepted", "a patient's report is the report, not a proposal");
  assert.equal(clinician.status, "accepted");
  assert.equal(model.status, "proposed");

  // And the model's guess has not moved anything.
  const { current } = await refreshLevel(ctx, g.id, NOW);
  assert.equal(current, 0, "the clinician's observation is the latest accepted one");
});

test("proposing model evidence does not even touch the level", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync("src/lib/clinical/return-goal-evidence.ts", "utf8");
  const fn = src.slice(
    src.indexOf("export async function proposeModelEvidence"),
    src.indexOf("async function emitAndRefresh")
  );
  // Comments stripped first: the function's own comment says "Deliberately NO
  // refreshLevel", which a naive match reads as a call. A guard that cannot
  // tell code from prose about the code is checking the wrong thing.
  const code = fn.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/refreshLevel\s*\(/.test(code),
    "a refresh here would be harmless today and exactly the line somebody later 'fixes' into an auto-accept");
});

test("Session Prep shows what moved, what stalled, and what is waiting", async () => {
  const { goalContextFor, STALL_DAYS } = await import("../src/lib/clinical/return-goal-evidence");
  const {
    recordGoalCheckin, proposeModelEvidence,
  } = await import("../src/lib/clinical/return-goal-evidence");

  const moved = await anActiveGoal();
  await recordGoalCheckin(ctx, {
    goalId: moved.id, personId: T.patient, level: 0,
    at: "2026-09-01T09:00:00.000Z", checkinId: "m1",
  });

  const stalled = await anActiveGoal();
  await recordGoalCheckin(ctx, {
    goalId: stalled.id, personId: T.patient, level: -1,
    at: "2026-05-01T09:00:00.000Z", checkinId: "s1",
  });

  const waiting = await anActiveGoal();
  await proposeModelEvidence(ctx, {
    goalId: waiting.id, personId: T.patient, level: 1,
    sourceType: "thought_item", sourceId: "w1", at: "2026-09-02T09:00:00.000Z",
  });

  const ctxs = await goalContextFor(ctx, T.patient, {
    since: "2026-08-01T00:00:00.000Z", now: new Date("2026-09-04T10:00:00.000Z"),
  });
  const byId = new Map(ctxs.map((c) => [c.goal.id, c]));

  assert.equal(byId.get(moved.id)?.movement, "moved");
  assert.equal(byId.get(stalled.id)?.movement, "stalled");
  assert.ok((byId.get(stalled.id)?.quietDays ?? 0) >= STALL_DAYS);
  // Something waiting on the clinician outranks describing a state they cannot
  // yet act on.
  assert.equal(byId.get(waiting.id)?.movement, "awaiting_review");
  assert.equal(byId.get(waiting.id)?.pendingCount, 1);

  // Every line cites the observations behind it.
  for (const c of ctxs) {
    if (c.citations.length === 0) continue;
    assert.ok(c.citations.every((id) => typeof id === "string" && id.length > 0));
  }
});

test("a goal with no evidence is not described as stalled progress", async () => {
  const { goalContextFor, goalLine } = await import("../src/lib/clinical/return-goal-evidence");
  const fresh = await anActiveGoal();
  const ctxs = await goalContextFor(ctx, T.patient, { now: new Date(NOW) });
  const c = ctxs.find((x) => x.goal.id === fresh.id);
  assert.ok(c);
  assert.equal(c.quietDays, null);
  // Nothing has had a chance to move. Saying "no progress in 42 days" would
  // blame a person for a ladder nobody has used yet.
  assert.match(goalLine(c), /nothing recorded against this yet/i);
  assert.equal(c.citations.length, 0);
});

test("the goal line says what the person can do, not a number", async () => {
  const { goalContextFor, goalLine, recordGoalCheckin } = await import("../src/lib/clinical/return-goal-evidence");
  const g = await anActiveGoal();
  await recordGoalCheckin(ctx, {
    goalId: g.id, personId: T.patient, level: 0, at: "2026-09-01T09:00:00.000Z", checkinId: "x1",
  });
  const c = (await goalContextFor(ctx, T.patient, { now: new Date(NOW) }))
    .find((x) => x.goal.id === g.id)!;
  const line = goalLine(c);
  assert.match(line, /Completes a normal grocery trip alone/,
    "§9: plain language — a brief that printed 'level 0' tells a clinician nothing they can act on");
  assert.ok(!/level [+-]?\d/i.test(line));
});

// ---------------------------------------------------------------------------
// Phase 3 — AI assistance
// ---------------------------------------------------------------------------

test("the three goal tasks are registered with the boundaries §7 gives them", async () => {
  const { getTask } = await import("../src/lib/ai-gateway/registry");
  const ladder = getTask("return_goal.draft_ladder");
  const match = getTask("return_goal.match_evidence");
  const summary = getTask("return_goal.summarize_progress");
  assert.ok(ladder && match && summary);
  // The drafter refuses rather than falling back: there is no deterministic way
  // to write five observable rungs for an arbitrary life goal, and a template
  // would be a ladder nobody could recognise themselves in.
  assert.equal(ladder.fallback, "refuse");
  assert.equal(match.fallback, "deterministic");
  assert.equal(summary.fallback, "deterministic");
});

test("a ladder draft is refused unless all five levels come back usable", async () => {
  const { parseLadder } = await import("../src/lib/clinical/return-goal-intelligence");
  assert.equal(parseLadder("not json"), null);
  assert.equal(parseLadder('{"levels":[{"level":0,"description":"Only one."}]}'), null,
    "a partial ladder is not one a person can correct — it is one they must finish while believing it was drafted");
  assert.equal(parseLadder('{"levels":[{"level":-2,"description":""},{"level":-1,"description":"a"},{"level":0,"description":"b"},{"level":1,"description":"c"},{"level":2,"description":"d"}]}'), null,
    "an empty rung is not a rung");
  const good = parseLadder(JSON.stringify({
    levels: [
      { level: -2, description: "a" }, { level: -1, description: "b" },
      { level: 0, description: "c" }, { level: 1, description: "d" }, { level: 2, description: "e" },
    ],
  }));
  assert.ok(good);
  assert.deepEqual(good.map((r) => r.level), [-2, -1, 0, 1, 2]);
});

test("a ladder draft is always marked model-drafted", async () => {
  const { draftLadder } = await import("../src/lib/clinical/return-goal-intelligence");
  const draft = await draftLadder(ctx, {
    personId: T.patient, title: "Drive on the freeway",
    patientStatement: "I want to drive to work again.", domain: "mobility_travel",
  });
  // No provider is configured in tests, so this is the refusal path — and the
  // flag is on it either way, because §12's rule is about what the wording IS,
  // not about whether the call succeeded.
  assert.equal(draft.modelDrafted, true);
  assert.equal(draft.ok, false);
  assert.ok(draft.reason.length > 0, "a refusal has to say what the person can do instead");
  assert.match(draft.reason, /yourself/i);
});

test("a progress statement with no observation is refused", async () => {
  const { validateProgress } = await import("../src/lib/clinical/return-goal-intelligence");
  const r = validateProgress([{ text: "She is doing much better.", observationIds: [] }], []);
  assert.equal(r.statements.length, 0);
  assert.match(r.omitted[0].reason, /no observation cited/);
});

test("a progress statement citing a proposed observation is refused", async () => {
  const { validateProgress } = await import("../src/lib/clinical/return-goal-intelligence");
  const g = await anActiveGoal();
  const proposed = await recordObservation(ctx, {
    goalId: g.id, personId: T.patient, observedLevel: 2,
    evidenceClass: "model_candidate", sourceType: "x", sourceId: "y", occurredAt: NOW,
  });
  const r = validateProgress(
    [{ text: "Reached the target.", observationIds: [proposed.id] }],
    [proposed]
  );
  assert.equal(r.statements.length, 0,
    "a model candidate must not reach a summary before a person has accepted it");
  assert.match(r.omitted[0].reason, /not accepted/);
});

test("the deterministic summary cites every statement and claims nothing extra", async () => {
  const { summarizeProgress } = await import("../src/lib/clinical/return-goal-intelligence");
  const { recordGoalCheckin, recordClinicianObservation } = await import("../src/lib/clinical/return-goal-evidence");
  const g = await anActiveGoal();
  await recordGoalCheckin(ctx, {
    goalId: g.id, personId: T.patient, level: -2, at: "2026-06-01T09:00:00.000Z", checkinId: "p1",
  });
  await recordClinicianObservation(ctx, {
    goalId: g.id, personId: T.patient, level: 0, at: "2026-08-01T09:00:00.000Z", sourceId: "n1",
  });
  const summary = summarizeProgress(g, await ladderFor(ctx, g.id), await observationsFor(ctx, g.id));

  assert.ok(summary.statements.length >= 2);
  for (const s of summary.statements) {
    assert.ok(s.observationIds.length > 0, "§7: every statement cites accepted observation ids");
  }
  const all = summary.statements.map((s) => s.text).join(" ");
  // §1: "achievement is not cure." The summary describes the record, not the
  // person — no improvement, no recovery, no cause.
  assert.ok(!/improv|recover|better|remission|because|due to/i.test(all),
    `summary made a claim beyond the record: ${all}`);
  // And the two sources stay separate even in a count of them.
  assert.match(all, /patient reported/);
  assert.match(all, /clinician observed/);
});

// ---------------------------------------------------------------------------
// Phase 4 — the downstream contract
// ---------------------------------------------------------------------------

test("the projection carries a version and the level series", async () => {
  const { goalProjection, GOAL_PROJECTION_VERSION } = await import("../src/lib/clinical/return-goal-projection");
  const { recordGoalCheckin } = await import("../src/lib/clinical/return-goal-evidence");
  const g = await anActiveGoal();
  await recordGoalCheckin(ctx, {
    goalId: g.id, personId: T.patient, level: -1, at: "2026-07-01T09:00:00.000Z", checkinId: "a1",
  });
  await recordGoalCheckin(ctx, {
    goalId: g.id, personId: T.patient, level: 0, at: "2026-08-01T09:00:00.000Z", checkinId: "a2",
  });

  const set = await goalProjection(ctx, T.patient);
  assert.equal(set.version, GOAL_PROJECTION_VERSION);
  const p = set.goals.find((x) => x.goalId === g.id);
  assert.ok(p);
  // A series, not a current value: an engine handed only currentLevel would
  // have to keep its own history, and then there would be two.
  assert.equal(p.levels.length, 2);
  assert.ok(p.levels[0].occurredAt < p.levels[1].occurredAt, "oldest first");
  assert.equal(p.targetDescription, "Completes a normal grocery trip alone.");
});

test("the projection excludes proposals, rejections and the patient's words", async () => {
  const { goalProjection } = await import("../src/lib/clinical/return-goal-projection");
  const g = await anActiveGoal();
  await recordObservation(ctx, {
    goalId: g.id, personId: T.patient, observedLevel: 2,
    evidenceClass: "model_candidate", sourceType: "x", sourceId: "y", occurredAt: NOW,
  });
  const set = await goalProjection(ctx, T.patient);
  const p = set.goals.find((x) => x.goalId === g.id)!;

  assert.equal(p.levels.length, 0,
    "a fingerprint built over model candidates is a pattern derived from guesses nobody accepted");
  assert.equal(p.pendingCount, 1, "but a consumer can tell 'no evidence' from 'evidence nobody looked at'");

  // §12: goal titles and why-it-matters must not travel to general telemetry.
  const blob = JSON.stringify(set);
  assert.ok(!blob.includes("I want my independence back"), "why-it-matters reached the projection");
  assert.ok(!blob.includes("I want to shop without needing someone"), "the patient statement reached the projection");
});

test("a stall signal fires on silence, and a reversal only on a direction", async () => {
  const { goalProjection, goalSignals } = await import("../src/lib/clinical/return-goal-projection");
  const { recordGoalCheckin } = await import("../src/lib/clinical/return-goal-evidence");

  const quiet = await anActiveGoal();
  await recordGoalCheckin(ctx, {
    goalId: quiet.id, personId: T.patient, level: 0, at: "2026-05-01T09:00:00.000Z", checkinId: "q1",
  });

  const dipped = await anActiveGoal();
  for (const [level, day] of [[0, "01"], [-1, "10"], [0, "20"]] as const) {
    await recordGoalCheckin(ctx, {
      goalId: dipped.id, personId: T.patient, level,
      at: `2026-09-${day}T09:00:00.000Z`, checkinId: `d${day}`,
    });
  }

  const reversed = await anActiveGoal();
  for (const [level, day] of [[1, "01"], [0, "10"], [-1, "20"]] as const) {
    await recordGoalCheckin(ctx, {
      goalId: reversed.id, personId: T.patient, level,
      at: `2026-09-${day}T09:00:00.000Z`, checkinId: `r${day}`,
    });
  }

  const set = await goalProjection(ctx, T.patient);
  const signals = goalSignals(set, new Date("2026-09-25T10:00:00.000Z"), 42);
  const kinds = new Map(signals.map((s) => [s.goalId + s.kind, s]));

  assert.ok(kinds.has(quiet.id + "stall"));
  assert.ok(kinds.has(reversed.id + "reversal"));
  // A single lower reading is an ordinary bad week. Alerting on it would be
  // alerting on the normal shape of recovery.
  assert.ok(!kinds.has(dipped.id + "reversal"), "a dip that recovered is not a reversal");

  for (const s of signals) {
    assert.ok(s.reason.length > 0, "a signal with no stated reason is an alert nobody can act on");
  }
});
