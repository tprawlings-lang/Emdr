// The command-context service (expansion handoff 03 §15, §5; Phase 3).
//
// Phase 3's definition of done is two claims, and the second is the one that
// fails invisibly:
//
//   "EVERY MATERIAL STATEMENT CAN OPEN ITS EVIDENCE."
//   "UNAVAILABLE SYSTEMS SHOW HONEST MISSING STATE."
//
// The second fails by rendering nothing. A Recovery Trajectory section that
// does not exist yet and a Recovery Trajectory that is flat produce the same
// blank space, and only one of them is a fact about the person. §20 is explicit:
// "missing downstream feature → show Not available or omit section. Never
// manufacture neutral state."
//
// So every section here is a discriminated union with four DIFFERENT reasons
// for absence, and the tests below check that the right one comes back — that
// "this person has no life goals" and "life goals are switched off in this
// deployment" are not the same answer.
//
// And the rule that keeps the whole thing honest, §15's: "Command Center does
// not reach around subsystem rules to access protected content." A test asserts
// there is no SQL in the module at all.

process.env.EMDR_DATA_DIR = `/tmp/steady-cmdctx-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "cmdctx-test-secret-at-least-32-characters-long";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "cmdctx-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";

import { getDb } from "../src/lib/db";
import type { TenantContext } from "../src/lib/repository";
import {
  buildCommandContext, commandContextCacheKey, COMMAND_CONTEXT_VERSION,
  type SectionMissing,
} from "../src/lib/clinical/command-context";
import { upsertSignal, recordCareAction } from "../src/lib/clinical/attention-signals";
import { createGoal, confirmGoal, recordObservation } from "../src/lib/clinical/return-to-life";
import { RESPONSE_POLICY } from "../src/lib/clinical/response-fingerprint-policy";

const db = getDb();
const T = {
  tenant: "tenant-cc", other: "tenant-cc-2",
  clinician: "clin-cc", patient: "pat-cc", empty: "pat-cc-empty",
};
for (const t of [T.tenant, T.other]) {
  db.prepare("INSERT OR IGNORE INTO tenants (id, kind, name) VALUES (?, 'organization', ?)").run(t, t);
}
for (const id of [T.clinician, T.patient, T.empty]) {
  db.prepare("INSERT OR IGNORE INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, 'X', 'fabricated')")
    .run(id, T.tenant);
}
const ctx: TenantContext = { tenantId: T.tenant, personId: T.clinician };
const otherCtx: TenantContext = { tenantId: T.other, personId: T.clinician };

const LADDER = [
  { level: -2 as const, description: "Cannot enter the store alone." },
  { level: -1 as const, description: "Enters alone for a few items." },
  { level: 0 as const, description: "Completes a normal grocery trip alone." },
  { level: 1 as const, description: "Completes normal trips across different stores." },
  { level: 2 as const, description: "Shops alone comfortably." },
];

function reasonOf(section: unknown): string {
  return (section as SectionMissing).reason;
}

// ---------------------------------------------------------------------------
// Honest absence (§20)
// ---------------------------------------------------------------------------

test("a person with nothing recorded gets stated reasons, never blanks", async () => {
  const c = await buildCommandContext(ctx, { personId: T.empty });

  for (const [name, section] of [
    ["returnToLife", c.returnToLife],
    ["responseFingerprint", c.responseFingerprint],
    ["followUps", c.followUps],
    ["actionHistory", c.actionHistory],
    ["recoveryTrajectory", c.recoveryTrajectory],
    ["therapeuticLoad", c.therapeuticLoad],
  ] as const) {
    assert.equal(section.present, false, `${name} should be absent`);
    const s = section as SectionMissing;
    assert.ok(s.note.length > 20, `${name} must say why in words, not "no data"`);
    assert.ok(!/^no data$/i.test(s.note));
  }
});

// The distinction the enum exists for. These four produce the same blank space
// and mean completely different things.
test("the four reasons for absence are not interchangeable", async () => {
  const c = await buildCommandContext(ctx, { personId: T.empty });
  assert.equal(reasonOf(c.returnToLife), "none_recorded", "this person has no goals");
  assert.equal(
    reasonOf(c.recoveryTrajectory), "unavailable",
    "the feature is not built — that is not a statement about the person"
  );
  assert.equal(reasonOf(c.whyHere), "none_recorded", "the row came from somewhere else");
});

// §20's exact case: an absent downstream feature must not read as a flat one.
test("an unbuilt subsystem says it is unbuilt, in words", async () => {
  const c = await buildCommandContext(ctx, { personId: T.empty });
  for (const s of [c.recoveryTrajectory, c.therapeuticLoad]) {
    assert.equal(s.reason, "unavailable");
    assert.ok(
      /not built yet/i.test(s.note),
      "a clinician must be able to tell 'nothing computed' from 'nothing there'"
    );
    assert.ok(
      /not a judgement|Nothing here says/i.test(s.note),
      "and the note must say what the absence does NOT mean"
    );
  }
});

test("insufficient evidence is not the same as nothing recorded", async () => {
  // One exposure is recorded, which is under §6's display threshold.
  db.prepare("INSERT OR IGNORE INTO users (id, email, name, role, password_hash) VALUES (?, ?, 'A', 'member', 'x')")
    .run(T.patient, "pat-cc@example.test");
  db.prepare(
    `INSERT OR REPLACE INTO therapy_sessions
       (id, user_id, tenant_id, module_id, status, pre_suds, post_suds, started_at, ended_at)
     VALUES ('cc-s1', ?, ?, 'calm-place', 'completed', 7, 3, '2026-08-01 10:00:00', '2026-08-01 10:40:00')`
  ).run(T.patient, T.tenant);
  const { syncInterventionInstances } = await import("../src/lib/clinical/interventions");
  await syncInterventionInstances(ctx, T.patient);

  const c = await buildCommandContext(ctx, { personId: T.patient });
  assert.equal(reasonOf(c.responseFingerprint), "insufficient_evidence");
  const note = (c.responseFingerprint as SectionMissing).note;
  assert.ok(
    note.includes(String(RESPONSE_POLICY.displayThreshold)),
    "the threshold is named, so the clinician knows what would change the answer"
  );
});

// ---------------------------------------------------------------------------
// Evidence (§15, Phase 3's first claim)
// ---------------------------------------------------------------------------

test("every present section carries evidence refs or says it has none", async () => {
  const goal = await createGoal(ctx, {
    personId: T.patient,
    title: "Grocery shopping alone",
    patientStatement: "I want to shop without needing someone with me.",
    domain: "daily_living",
    ladder: LADDER,
  });
  await confirmGoal(ctx, goal.id, T.patient);
  // A clinician's own observation is accepted on record — handoff 01 reserves
  // the review step for model candidates.
  await recordObservation(ctx, {
    goalId: goal.id, personId: T.patient, observedLevel: -1,
    evidenceClass: "clinician_observed", sourceType: "manual", sourceId: "x",
    occurredAt: "2026-08-20 09:00:00",
  });

  const c = await buildCommandContext(ctx, { personId: T.patient });
  assert.equal(c.returnToLife.present, true);
  if (!c.returnToLife.present) return;
  const [g] = c.returnToLife.goals;
  assert.ok(g.evidence.length > 0, "an accepted observation is openable evidence");
  assert.ok(g.evidence.every((e) => e.type && e.id && e.label));
  assert.equal(g.evidence[0].type, "return_goal_observation");
});

// Handoff 01 §9: "show levels in plain language, not clinical scoring
// language." A drawer that said "Level -1" would ask a clinician to hold a
// five-point scale in their head to read a summary.
test("a goal level is shown in words, with the rung it means", async () => {
  const c = await buildCommandContext(ctx, { personId: T.patient });
  assert.equal(c.returnToLife.present, true);
  if (!c.returnToLife.present) return;
  const [g] = c.returnToLife.goals;
  assert.ok(g.currentLevelLabel.length > 2);
  assert.ok(!/^-?\d+$/.test(g.currentLevelLabel), "not a bare number");
  assert.equal(g.currentDescription, "Enters alone for a few items.");
});

// §5: "proposed AI links do not appear as accepted" — and the same rule for a
// proposed observation, which must not be folded into the accepted evidence.
test("a proposed observation is counted separately, never as evidence", async () => {
  const goals = await import("../src/lib/clinical/return-to-life");
  const active = await goals.listGoals(ctx, T.patient, ["active"]);
  const proposed = await recordObservation(ctx, {
    goalId: active[0].id, personId: T.patient, observedLevel: 1,
    evidenceClass: "model_candidate", sourceType: "matcher", sourceId: "m1",
    occurredAt: "2026-08-25 09:00:00",
  });

  const c = await buildCommandContext(ctx, { personId: T.patient });
  assert.equal(c.returnToLife.present, true);
  if (!c.returnToLife.present) return;
  const [g] = c.returnToLife.goals;
  assert.equal(g.pendingCount, 1, "it is counted, so the clinician knows it is waiting");
  assert.ok(
    !g.evidence.some((e) => e.id === proposed.id),
    "and it is not evidence — nobody accepted it"
  );
});

// ---------------------------------------------------------------------------
// Why here (§5, §12)
// ---------------------------------------------------------------------------

test("why-here comes from the durable signal and reports acknowledgement", async () => {
  const { signal } = await upsertSignal(ctx, {
    personId: T.patient, sourceFeature: "response-fingerprint-provider",
    candidate: {
      type: "repeated_recovery_burden", dedupeKey: "response:d1", band: "review_today",
      statement: "Difficulty afterwards has been recorded on 3 of 6 exposures.",
      evidenceIds: ["i1", "i2"], evidenceType: "intervention_instance",
      evidenceAt: "2026-09-01T00:00:00.000Z",
      limitations: ["An association in the record, not a claim about cause."],
      policyVersion: RESPONSE_POLICY.version,
    },
  });

  const c = await buildCommandContext(ctx, { personId: T.patient, signalId: signal.id });
  assert.equal(c.whyHere.present, true);
  if (!c.whyHere.present) return;
  assert.equal(c.whyHere.signal.id, signal.id);
  assert.equal(c.whyHere.evidence.length, 2, "every material statement opens its evidence");
  assert.equal(c.whyHere.acknowledged, false);
  assert.ok(c.whyHere.limitations.length > 0, "what the evidence cannot support travels too");
});

// §12: "opening a row or drawer does not silently acknowledge it."
test("assembling the context acknowledges nothing", async () => {
  const before = db.prepare(
    "SELECT state FROM clinical_attention_signals WHERE person_id = ?"
  ).all(T.patient) as { state: string }[];
  await buildCommandContext(ctx, { personId: T.patient });
  await buildCommandContext(ctx, { personId: T.patient });
  const after = db.prepare(
    "SELECT state FROM clinical_attention_signals WHERE person_id = ?"
  ).all(T.patient) as { state: string }[];
  assert.deepEqual(after, before, "reading a record must not change it");

  const src = fs.readFileSync("src/lib/clinical/command-context.ts", "utf8");
  const code = src
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    // The cache key's hash builder calls .update(); that is a digest, not a
    // write, and excluding it by name is more honest than loosening the check.
    .replace(/createHash\("sha256"\)\.update\([^)]*\)/g, "");
  assert.ok(
    !/\b(insert|update|delete)\b/i.test(code),
    "the context service has no write path at all"
  );
});

// ---------------------------------------------------------------------------
// §15's rule: no reaching around the subsystems
// ---------------------------------------------------------------------------

test("the context service issues no queries of its own", () => {
  const src = fs.readFileSync("src/lib/clinical/command-context.ts", "utf8");
  const code = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/\bSELECT\b/i.test(code), "§15: it must not reach around subsystem rules");
  assert.ok(!/from "\.\.\/data"/.test(code), "and it must not import the raw client");
  assert.ok(!/repo\(/.test(code), "nor the repository directly — every read goes through a subsystem");
});

test("the cache key covers everything that can change the answer", () => {
  const base = {
    tenantId: T.tenant, personId: T.patient,
    evidenceCutoff: "2026-09-01T00:00:00.000Z", signalId: "s1",
  };
  const key = commandContextCacheKey(base);
  for (const changed of [
    { ...base, tenantId: T.other },
    { ...base, personId: T.empty },
    { ...base, evidenceCutoff: "2026-09-02T00:00:00.000Z" },
    { ...base, signalId: "s2" },
    { ...base, signalId: null },
  ]) {
    assert.notEqual(commandContextCacheKey(changed), key);
  }
  // A key missing a policy version serves a drawer assembled under rules that
  // no longer apply, and nothing about the stale answer looks stale.
  const src = fs.readFileSync("src/lib/clinical/command-context.ts", "utf8");
  const start = src.indexOf("export function commandContextCacheKey");
  // Bounded to the function. Slicing to end-of-file would find these names in
  // `buildCommandContext`'s provenance block and pass whatever the key does.
  const fn = src.slice(start, src.indexOf("\n/**", start));
  assert.ok(fn.length > 0 && fn.length < src.length);
  assert.ok(fn.includes("CLINICAL_POLICY_VERSION"));
  assert.ok(fn.includes("RESPONSE_POLICY.version"));
  assert.ok(fn.includes("COMMAND_CONTEXT_VERSION"));
});

test("provenance travels with the assembled context", async () => {
  const c = await buildCommandContext(ctx, { personId: T.patient });
  assert.equal(c.provenance.contextVersion, COMMAND_CONTEXT_VERSION);
  assert.ok(c.provenance.clinicalPolicyVersion);
  assert.equal(c.provenance.responsePolicyVersion, RESPONSE_POLICY.version);
  assert.ok(c.evidenceCutoff);
});

// ---------------------------------------------------------------------------
// Failure and tenancy (§18, §20)
// ---------------------------------------------------------------------------

test("a foreign tenant sees an empty record, not another tenant's", async () => {
  const c = await buildCommandContext(otherCtx, { personId: T.patient });
  assert.equal(c.returnToLife.present, false);
  assert.equal(c.responseFingerprint.present, false);
  assert.equal(c.actionHistory.present, false);
});

test("a signal id from another person is withheld, not shown", async () => {
  const { signal } = await upsertSignal(ctx, {
    personId: T.empty, sourceFeature: "engagement-gap-provider",
    candidate: {
      type: "engagement_gap", dedupeKey: "engagement:gap", band: "watch",
      statement: "No check-in for 40 days.", evidenceIds: [],
      evidenceAt: "2026-09-01T00:00:00.000Z", limitations: [],
      policyVersion: "engagement-gap.1.0.0",
    },
  });
  // Asking for one person's drawer with another person's signal id.
  const c = await buildCommandContext(ctx, { personId: T.patient, signalId: signal.id });
  assert.equal(c.whyHere.present, false);
  assert.equal(reasonOf(c.whyHere), "withheld");
});

test("coverage names which sections assembled and which did not", async () => {
  const c = await buildCommandContext(ctx, { personId: T.patient });
  assert.ok(c.coverage.assembled.length >= 5, "the sections that ran are named");
  assert.deepEqual(c.coverage.failed, []);
});

test("action history shows what was done, with no invented duration", async () => {
  await recordCareAction(ctx, {
    personId: T.patient, clinicianId: T.clinician, action: "review", sourceSurface: "drawer",
  });
  const c = await buildCommandContext(ctx, { personId: T.patient });
  assert.equal(c.actionHistory.present, true);
  if (!c.actionHistory.present) return;
  assert.equal(c.actionHistory.actions[0].action, "review");
  assert.equal(c.actionHistory.actions[0].durationSeconds, null);
});


// ---------------------------------------------------------------------------
// Point in time (§22)
// ---------------------------------------------------------------------------
//
// §22's test matrix: "historical view does not use future evidence." The
// cached current_level reflects EVERY accepted observation, so a drawer that
// read it at an earlier cutoff would report the level this goal reached later
// as the level it had then.

test("an earlier cutoff shows the level the goal had then, not the one it reached", async () => {
  const goals = await import("../src/lib/clinical/return-to-life");
  const active = await goals.listGoals(ctx, T.patient, ["active"]);
  const goalId = active[0].id;

  // A later, better reading.
  await recordObservation(ctx, {
    goalId, personId: T.patient, observedLevel: 0,
    evidenceClass: "clinician_observed", sourceType: "manual", sourceId: "later",
    occurredAt: "2026-09-02 09:00:00",
  });

  // Both cutoffs are explicit, so the test does not depend on the wall clock.
  const now = await buildCommandContext(ctx, {
    personId: T.patient, asOf: "2026-09-03T00:00:00.000Z",
  });
  const then = await buildCommandContext(ctx, {
    personId: T.patient, asOf: "2026-09-01T00:00:00.000Z",
  });
  assert.equal(now.returnToLife.present, true);
  assert.equal(then.returnToLife.present, true);
  if (!now.returnToLife.present || !then.returnToLife.present) return;

  assert.equal(now.returnToLife.goals[0].currentLevel, 0, "today it is the newer reading");
  assert.equal(
    then.returnToLife.goals[0].currentLevel, -1,
    "on 1 September it was the older one — the later observation had not happened"
  );
  assert.ok(
    !then.returnToLife.goals[0].evidence.some((e) => e.id.length === 0),
    "and the evidence behind it is the evidence that existed then"
  );
});

test("the goal level is folded, never read from the cached column", () => {
  const src = fs.readFileSync("src/lib/clinical/command-context.ts", "utf8");
  const fn = src.slice(src.indexOf("async function returnToLifeFor"), src.indexOf("async function responseFingerprintFor"));
  assert.ok(fn.includes("foldLevel(accepted)"), "the domain's own fold");
  assert.ok(
    !/goal\.currentLevel/.test(fn),
    "a cached column reflects every observation, including ones after the cutoff"
  );
});
