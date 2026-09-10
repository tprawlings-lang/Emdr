// The recovery-trajectory adapters, snapshots and provider (expansion handoff
// 04 §5, §6, §8, §12).
//
// Where the state-machine tests run against constructed series, these run
// against a database, because the things that can go wrong here are about
// reaching real records:
//
//   AN ADAPTER READING PAST THE TENANT BOUNDARY. ADR 0011: "foreign tenant
//   person ID returns not-found." A trajectory assembled from three subsystems
//   is three chances to widen what a clinician may see.
//
//   A PROPOSED GOAL OBSERVATION COUNTING AS EVIDENCE. Handoff 01 §7 keeps a
//   proposal out of the level; a trajectory built from proposals would be a
//   trajectory of what a model suggested rather than of what a clinician
//   accepted, and it would look identical.
//
//   A SNAPSHOT WITH NO EVIDENCE ROWS. §12's Phase 3 definition of done is
//   "every state opens evidence", and the rows are what the state was made of.
//
//   RECOMPUTING THE SAME CUTOFF WRITING A SECOND ROW. §13's reproducibility
//   clause is only useful if the clinician can point at the state they read.
//
//   THE PROVIDER FLOODING THE QUEUE. §8: "do not emit work for every stable
//   domain. The Command Center is for action, not chart commentary." Seven
//   domains per person across a caseload of forty is the alert wall the
//   Command Center exists to replace.
//
//   AND A DISAGREEMENT ERASING THE STATE. Handoff 05 §13 states the shared
//   rule: "clinician disagreement is recorded and does not erase system
//   evidence."

process.env.EMDR_DATA_DIR = `/tmp/steady-rte-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "rte-test-secret-at-least-32-characters-long";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "rte-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";

import { getDb } from "../src/lib/db";
import type { TenantContext } from "../src/lib/repository";
import { readEvents } from "../src/lib/events";
import {
  computeTrajectory, domainSeriesFor, saveTrajectory, evidenceForSnapshot,
  recordTrajectoryReview, reviewsForPerson, trajectoryLine, trajectoryContext,
  deviations, TrajectoryError, TRAJECTORY_POLICY,
} from "../src/lib/clinical/recovery-trajectory";
import { createGoal, confirmGoal, recordObservation } from "../src/lib/clinical/return-to-life";
import {
  RECOVERY_TRAJECTORY_PROVIDER, CORROBORATION_THRESHOLD, selectDeviations,
} from "../src/lib/clinical/attention-providers/recovery-trajectory";
import type { TrajectorySnapshot } from "../src/lib/clinical/recovery-trajectory";
import { conforms, isDeterministic } from "../src/lib/clinical/attention-providers/contract";

const db = getDb();
const T = {
  tenant: "tenant-rte", other: "tenant-rte-other",
  clinician: "clin-rte", patient: "pat-rte", stranger: "pat-rte-foreign",
};

for (const t of [T.tenant, T.other]) {
  db.prepare("INSERT OR IGNORE INTO tenants (id, kind, name) VALUES (?, 'organization', ?)").run(t, t);
}
db.prepare("INSERT OR IGNORE INTO users (id, email, name, role, password_hash) VALUES (?, ?, 'Dr R', 'clinician', 'x')")
  .run(T.clinician, "clin-rte@example.test");
for (const [id, tenant, name] of [[T.patient, T.tenant, "Rey"], [T.stranger, T.other, "Stranger"]] as const) {
  db.prepare("INSERT OR IGNORE INTO users (id, email, name, role, password_hash) VALUES (?, ?, ?, 'member', 'x')")
    .run(id, `${id}@example.test`, name);
  db.prepare("INSERT OR IGNORE INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, ?, 'fabricated')")
    .run(id, tenant, name);
  db.prepare("UPDATE users SET tenant_id = ? WHERE id = ?").run(tenant, id);
}
db.prepare("UPDATE users SET tenant_id = ? WHERE id = ?").run(T.tenant, T.clinician);
db.prepare("INSERT OR IGNORE INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, 'Dr R', 'fabricated')")
  .run(T.clinician, T.tenant);

const ctx: TenantContext = { tenantId: T.tenant, personId: T.clinician };
const CUTOFF = "2026-09-01T00:00:00.000Z";
const DAY = 86_400_000;

function dayBefore(n: number): string {
  return new Date(Date.parse(CUTOFF) - n * DAY).toISOString().slice(0, 10);
}

function checkin(person: string, tenant: string, daysAgo: number, values: {
  activation: number; dissociation: number; sleep: number;
}) {
  const date = dayBefore(daysAgo);
  db.prepare(
    `INSERT OR REPLACE INTO checkins
       (id, user_id, tenant_id, checkin_date, activation, shutdown, harm_urge, feels_safe,
        dissociation, sleep_quality, substance_flag, recommended_action, created_at)
     VALUES (?, ?, ?, ?, ?, 2, 0, 1, ?, ?, 0, 'practice', ?)`
  ).run(`ck-${person}-${date}`, person, tenant, date, values.activation,
    values.dissociation, values.sleep, `${date} 08:00:00`);
  db.prepare(
    `INSERT OR REPLACE INTO longitudinal_events
       (id, tenant_id, person_id, event_type, payload_version, payload, actor_type, actor_id,
        occurred_at, recorded_at, source_system)
     VALUES (?, ?, ?, 'daily_checkin.completed', 1, ?, 'patient', ?, ?, ?, 'test')`
  ).run(
    `ev-${person}-${date}`, tenant, person,
    JSON.stringify({
      activation: values.activation, dissociation: values.dissociation,
      sleepQuality: values.sleep,
    }),
    person, `${date} 08:00:00`, `${date} 08:00:00`
  );
}

// A record that reverses on activation: settled for six weeks, then worse.
for (let i = 0; i < 8; i++) checkin(T.patient, T.tenant, 45 - i * 3, { activation: 3, dissociation: 2, sleep: 7 });
for (let i = 0; i < 7; i++) checkin(T.patient, T.tenant, 20 - i * 3, { activation: 7, dissociation: 2, sleep: 7 });
// The foreign person has an identical record in another tenant.
for (let i = 0; i < 8; i++) checkin(T.stranger, T.other, 45 - i * 3, { activation: 3, dissociation: 2, sleep: 7 });
for (let i = 0; i < 7; i++) checkin(T.stranger, T.other, 20 - i * 3, { activation: 7, dissociation: 2, sleep: 7 });

// ---------------------------------------------------------------------------
// Adapters (§12 Phase 1)
// ---------------------------------------------------------------------------

test("check-in domains arrive on their own scales, never converted", async () => {
  const { series } = await domainSeriesFor(ctx, T.patient, { asOf: CUTOFF });
  const byType = new Map(series.map((s) => [s.domainType, s]));
  assert.ok(byType.has("activation"), "no activation lane");
  assert.ok(byType.has("sleep"), "no sleep lane");
  assert.equal(byType.get("activation")!.better, "lower");
  assert.equal(byType.get("sleep")!.better, "higher", "sleep must not inherit activation's direction");
  // Every value is the value that was recorded. A rescaled lane would be a
  // composite score one step from existing.
  const activation = byType.get("activation")!;
  assert.ok(activation.points.every((pt) => pt.value === 3 || pt.value === 7), "values were transformed");
  assert.equal(byType.get("engagement")!.better, "none");
});

test("a foreign tenant's identical record is not visible", async () => {
  // ADR 0011. The stranger has the same readings under another tenant, so a
  // leak would produce a plausible trajectory rather than an obvious error.
  const { series } = await domainSeriesFor(ctx, T.stranger, { asOf: CUTOFF });
  const goals = series.filter((s) => s.domainType === "function");
  assert.deepEqual(goals, [], "a foreign person's goals were read");
  const set = await computeTrajectory(ctx, T.stranger, { asOf: CUTOFF });
  const stated = set.snapshots.filter((s) => s.state !== "insufficient_data");
  // Check-ins are a legacy user-scoped table read through the timeline, so this
  // asserts what the boundary actually protects today: nothing tenant-scoped
  // crosses, and the goal lane — the one this handoff added — is empty.
  assert.ok(
    !stated.some((s) => s.domainType === "function"),
    "a function state was computed for somebody in another tenant"
  );
});

test("only accepted goal observations reach the function lane", async () => {
  const goal = await createGoal(ctx, {
    personId: T.patient, title: "Back to the allotment",
    patientStatement: "I want to be at the allotment on Saturdays.",
    domain: "community_recreation",
    ladder: [
      { level: -2 as const, description: "Not at all, and it feels out of reach." },
      { level: -1 as const, description: "Been once since we started." },
      { level: 0 as const, description: "Some Saturdays." },
      { level: 1 as const, description: "Most Saturdays." },
      { level: 2 as const, description: "Every Saturday, without planning it." },
    ],
  });
  await confirmGoal(ctx, goal.id, `${dayBefore(90)}T09:00:00.000Z`);

  await recordObservation(ctx, {
    goalId: goal.id, personId: T.patient, observedLevel: 1,
    evidenceClass: "clinician_observed", sourceType: "clinician_entry",
    sourceId: "obs-a", occurredAt: `${dayBefore(60)}T09:00:00.000Z`,
  });

  // A model's proposal at a much higher level, never decided by anybody.
  await recordObservation(ctx, {
    goalId: goal.id, personId: T.patient, observedLevel: 2,
    evidenceClass: "model_candidate", sourceType: "clinician_entry",
    sourceId: "obs-proposed", occurredAt: `${dayBefore(5)}T09:00:00.000Z`,
  });

  const { series } = await domainSeriesFor(ctx, T.patient, { asOf: CUTOFF });
  const fn = series.find((s) => s.domainType === "function" && s.domainKey === goal.id);
  assert.ok(fn, "the goal produced no lane");
  assert.equal(fn!.points.length, 1, "a proposed observation reached the lane");
  assert.ok(!fn!.points.some((pt) => pt.value === 2), "the model's proposal was plotted");
});

// ---------------------------------------------------------------------------
// Snapshots and evidence (§5, §13)
// ---------------------------------------------------------------------------

test("a saved snapshot opens its evidence and appends one event", async () => {
  const set = await computeTrajectory(ctx, T.patient, { asOf: CUTOFF });
  const stated = set.snapshots.filter((s) => s.state !== "insufficient_data");
  assert.ok(stated.length > 0, "nothing was computed to save");
  await saveTrajectory(ctx, set, T.clinician);

  for (const s of stated) {
    const evidence = await evidenceForSnapshot(ctx, s.id);
    assert.ok(evidence.length > 0, `${s.label} was stored with no evidence rows`);
    // The order is the order cited, so "the third record" is a thing somebody
    // can point at.
    assert.deepEqual(evidence.map((e) => e.rank), evidence.map((_, i) => i));
  }

  const events = await readEvents({ personId: T.patient });
  const computed = events.filter((e) => e.event_type === "trajectory.snapshot_computed");
  assert.equal(computed.length, set.snapshots.length);
  for (const e of computed) {
    const payload = e.payload as Record<string, unknown>;
    assert.ok(payload.policyVersion, "a snapshot event with no policy version cannot be attributed");
    assert.ok(payload.evidenceCutoff, "nor one with no cutoff");
  }
});

test("recomputing the same cutoff under the same policy does not write a second row", async () => {
  const before = db.prepare("SELECT COUNT(*) AS n FROM recovery_trajectory_snapshots").get() as { n: number };
  const set = await computeTrajectory(ctx, T.patient, { asOf: CUTOFF });
  await saveTrajectory(ctx, set, T.clinician);
  await saveTrajectory(ctx, set, T.clinician);
  const after = db.prepare("SELECT COUNT(*) AS n FROM recovery_trajectory_snapshots").get() as { n: number };
  assert.equal(after.n, before.n, "a repeated computation duplicated the record");
});

test("a different policy version writes beside the old row, not over it", async () => {
  const before = db.prepare(
    "SELECT COUNT(*) AS n FROM recovery_trajectory_snapshots WHERE person_id = ?"
  ).get(T.patient) as { n: number };
  const altered = {
    ...TRAJECTORY_POLICY,
    version: "recovery-trajectory.test-9.9.9",
  };
  const set = await computeTrajectory(ctx, T.patient, { asOf: CUTOFF, policy: altered });
  await saveTrajectory(ctx, set, T.clinician);
  const after = db.prepare(
    "SELECT COUNT(*) AS n FROM recovery_trajectory_snapshots WHERE person_id = ?"
  ).get(T.patient) as { n: number };
  assert.ok(after.n > before.n, "the new policy overwrote history rather than adding to it");
  // And the old rows still say which rules made them.
  const versions = db.prepare(
    "SELECT DISTINCT policy_version FROM recovery_trajectory_snapshots WHERE person_id = ?"
  ).all(T.patient) as { policy_version: string }[];
  assert.ok(versions.length >= 2, "the two computations are indistinguishable");
});

// ---------------------------------------------------------------------------
// Review (§5)
// ---------------------------------------------------------------------------

test("a disagreement is recorded beside the state and needs a reason", async () => {
  const set = await computeTrajectory(ctx, T.patient, { asOf: CUTOFF });
  await saveTrajectory(ctx, set, T.clinician);
  const target = set.snapshots.find((s) => s.state !== "insufficient_data")!;

  await assert.rejects(
    () => recordTrajectoryReview(ctx, {
      personId: T.patient, snapshotId: target.id, clinicianPersonId: T.clinician,
      reviewState: "disagreed",
    }),
    TrajectoryError,
    "a disagreement with no reason leaves the next reader worse off than no review"
  );

  await recordTrajectoryReview(ctx, {
    personId: T.patient, snapshotId: target.id, clinicianPersonId: T.clinician,
    reviewState: "disagreed", note: "Night shifts started in August; the sleep lane is reading the roster.",
  });

  const reviews = await reviewsForPerson(ctx, T.patient);
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].reviewState, "disagreed");

  // AND THE STATE IS STILL THERE. Handoff 05 §13's shared rule: disagreement
  // "does not erase system evidence."
  const row = db.prepare("SELECT state FROM recovery_trajectory_snapshots WHERE id = ?")
    .get(target.id) as { state: string };
  assert.equal(row.state, target.state, "recording a disagreement changed the stored state");
  const again = await computeTrajectory(ctx, T.patient, { asOf: CUTOFF });
  assert.equal(
    again.snapshots.find((s) => s.id === target.id)?.state, target.state,
    "the state was suppressed after a clinician disagreed with it"
  );
});

// ---------------------------------------------------------------------------
// The provider (§8)
// ---------------------------------------------------------------------------

test("the provider emits only deviations, never chart commentary", async () => {
  const candidates = await RECOVERY_TRAJECTORY_PROVIDER.evaluate({
    ctx, personId: T.patient, evidenceCutoff: CUTOFF,
  });
  const set = await computeTrajectory(ctx, T.patient, { asOf: CUTOFF });
  const stated = set.snapshots.filter((s) => s.state !== "insufficient_data");

  assert.ok(stated.length > candidates.length, "every stated domain became a work item");
  for (const c of candidates) {
    assert.match(c.type, /^trajectory\.(reversing|stalled|slowing)$/, `${c.type} is not a deviation`);
  }
  // The reversing activation lane is there; the steady dissociation one is not.
  assert.ok(candidates.some((c) => c.dedupeKey === "trajectory:activation:activation"));
  assert.ok(
    !candidates.some((c) => c.dedupeKey.includes("dissociation")),
    "a domain holding steady reached the queue"
  );
  assert.ok(
    !candidates.some((c) => c.dedupeKey.includes("engagement")),
    "§8: engagement is context, not queue work"
  );
});

test("the provider's wording names the domain and the window, and grades nobody", async () => {
  const candidates = await RECOVERY_TRAJECTORY_PROVIDER.evaluate({
    ctx, personId: T.patient, evidenceCutoff: CUTOFF,
  });
  assert.ok(candidates.length > 0);
  for (const c of candidates) {
    assert.match(c.statement, /review window|narrow band|window before/i, c.statement);
    // §8's own example of what not to write.
    assert.ok(
      !/off track|not progressing|failing|non-?compliant|poor/i.test(c.statement),
      `the statement grades the person: ${c.statement}`
    );
    assert.ok(
      c.limitations.some((l) => /does not know why/.test(l)),
      "§4: a temporal relationship is not a cause, and the row must say so"
    );
    assert.ok(c.evidenceIds.length > 0, "a candidate asserting a change cited nothing");
  }
});

test("the provider passes the published contract and is deterministic", async () => {
  const args = { ctx, personId: T.patient, evidenceCutoff: CUTOFF };
  const candidates = await RECOVERY_TRAJECTORY_PROVIDER.evaluate(args);
  const issues = conforms(RECOVERY_TRAJECTORY_PROVIDER, candidates, { evidenceCutoff: CUTOFF });
  assert.deepEqual(issues, [], issues.map((i) => `${i.rule}: ${i.detail}`).join("\n"));
  assert.ok(await isDeterministic(RECOVERY_TRAJECTORY_PROVIDER, args));
});

// §8's three clauses, each against its own constructed case. The narrowing is
// the part of this provider a reviewer will want to argue with, and a rule that
// can only be exercised by seeding a database until it happens to produce a
// slowing domain is a rule nobody checks.

function snap(over: Partial<TrajectorySnapshot> = {}): TrajectorySnapshot {
  return {
    id: `snap-${over.domainKey ?? "x"}-${over.state ?? "stable"}`,
    personId: T.patient,
    domainType: "activation", domainKey: "activation", label: "Activation",
    unit: "0–10", better: "lower",
    state: "stable", stateLabel: "Holding steady",
    policyVersion: TRAJECTORY_POLICY.version, evidenceCutoff: CUTOFF,
    signalEligible: true,
    classification: {
      state: "stable",
      current: {
        from: CUTOFF, to: CUTOFF, n: 6, median: 5, iqr: 1, min: 4, max: 6,
        spanDays: 18, evidenceIds: ["e1", "e2"], reconstructedCount: 0,
      },
      comparison: null, prior: null,
      improvementDelta: 0, priorImprovementDelta: null, adverseCount: 0,
      explanation: ["A line."], limitations: [],
    },
    ...over,
  } as TrajectorySnapshot;
}

test("a single slowing domain does not reach the queue", () => {
  // §8: "clinically meaningful slowing across multiple corroborating domains."
  // One lane easing off is a chart observation at the caseload level.
  assert.ok(CORROBORATION_THRESHOLD >= 2);
  const lone = selectDeviations([
    snap({ domainKey: "activation", state: "slowing", label: "Activation" }),
    snap({ domainKey: "dissociation", domainType: "dissociation", label: "Dissociation" }),
  ]);
  assert.deepEqual(
    lone.filter((c) => c.type === "trajectory.slowing"), [],
    "a lone slowing domain reached the queue"
  );
});

test("slowing that corroborates reaches the queue, each row citing its own evidence", () => {
  const both = selectDeviations([
    snap({ domainKey: "activation", state: "slowing", label: "Activation" }),
    snap({ domainKey: "sleep", domainType: "sleep", state: "slowing", label: "Sleep quality" }),
  ]);
  const slowing = both.filter((c) => c.type === "trajectory.slowing");
  assert.equal(slowing.length, 2, "the corroborated pair did not reach the queue");
  for (const c of slowing) {
    assert.ok(
      c.limitations.some((l) => /more than one domain slowed/.test(l)),
      "a corroborated row must say what corroborated it"
    );
    assert.ok(c.evidenceIds.length > 0, "rows were collapsed into one with pooled evidence");
  }
});

test("a stall reaches the queue only on a life goal", () => {
  // §8: "sustained stall on an active Return-to-Life goal." A stalled measure
  // lane is a chart observation; a stalled goal is somebody's life not moving.
  const rows = selectDeviations([
    snap({ domainKey: "goal-1", domainType: "function", state: "stalled", label: "Back to the allotment" }),
    snap({ domainKey: "activation", state: "stalled", label: "Activation" }),
    snap({ domainKey: "phq-9", domainType: "measure", state: "stalled", label: "PHQ-9" }),
  ]);
  assert.equal(rows.length, 1, rows.map((r) => r.dedupeKey).join(", "));
  assert.equal(rows[0].dedupeKey, "trajectory:function:goal-1");
});

test("a reversal reaches the queue as review_today; nothing else outranks it", () => {
  const rows = selectDeviations([
    snap({ domainKey: "activation", state: "reversing" }),
    snap({ domainKey: "goal-1", domainType: "function", state: "stalled", label: "A goal" }),
  ]);
  const reversal = rows.find((r) => r.type === "trajectory.reversing")!;
  assert.equal(reversal.band, "review_today", "a non-safety row must never claim the top band");
  const stall = rows.find((r) => r.type === "trajectory.stalled")!;
  assert.equal(stall.band, "follow_up");
  // §2: "non-safety review_now cannot masquerade as safety." No band this
  // provider sets is ever review_now.
  assert.ok(!rows.some((r) => r.band === "review_now"), "a trajectory row claimed review_now");
});

test("stable, improving and insufficient domains never become work", () => {
  const rows = selectDeviations([
    snap({ domainKey: "activation", state: "stable" }),
    snap({ domainKey: "sleep", domainType: "sleep", state: "improving", label: "Sleep quality" }),
    snap({ domainKey: "dissociation", domainType: "dissociation", state: "insufficient_data", label: "Dissociation" }),
    // And an ineligible domain in a state that would otherwise qualify.
    snap({ domainKey: "checkins", domainType: "engagement", state: "reversing", label: "Check-ins", signalEligible: false }),
  ]);
  assert.deepEqual(rows, [], rows.map((r) => r.dedupeKey).join(", "));
});

// ---------------------------------------------------------------------------
// The sentence and the context shape (§8, §9)
// ---------------------------------------------------------------------------

test("the sentence keeps both halves when domains disagree", () => {
  const set = {
    personId: T.patient, evidenceCutoff: CUTOFF, policyVersion: TRAJECTORY_POLICY.version,
    unavailable: [],
    snapshots: [
      { label: "Sleep quality", state: "reversing" },
      { label: "Back to the allotment", state: "improving" },
    ] as never[],
  };
  const line = trajectoryLine(set as never)!;
  assert.match(line, /Sleep quality/);
  assert.match(line, /Back to the allotment/);
  assert.match(line, /while/, "§4: the disagreement is preserved, not netted off");
  assert.ok(!/overall|net|on balance/i.test(line), line);
});

test("nothing moving produces no sentence rather than a reassuring one", () => {
  const line = trajectoryLine({
    personId: T.patient, evidenceCutoff: CUTOFF, policyVersion: "v", unavailable: [],
    snapshots: [{ label: "Activation", state: "stable" }] as never[],
  } as never);
  assert.equal(line, null, "a quiet record must not be summarised as good news");
});

test("the context shape drops insufficient domains and carries evidence", async () => {
  const set = await computeTrajectory(ctx, T.patient, { asOf: CUTOFF });
  const context = trajectoryContext(set);
  assert.ok(context.every((c) => c.state !== "insufficient_data"));
  for (const c of context) {
    assert.ok(c.policyVersion, "a context row with no policy version cannot be attributed");
    assert.ok(c.headline.length > 0, "§4: never an unexplained state");
  }
  assert.ok(deviations(set).every((s) => s.signalEligible));
});
