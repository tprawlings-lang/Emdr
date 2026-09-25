// The clinician-assigned lane (Handoff 10 Phase 3; rows CV10_E01 to E05),
// built ahead of its gate for a team to review and test:
//
//   - the containers are Handoff 03's ModuleDefinition, drafts with no
//     protocol content; the demo's steps say they are placeholders;
//   - never listed without a live assignment, a deep link without one is not
//     available, and an expired assignment cannot be started;
//   - an assignment is necessary, never sufficient: the existing engine's
//     steady tier, crisis and dissociation rules still decide;
//   - distress before and after; a rise of 3 or more, or above 7, flags the
//     assigning clinician;
//   - stop costs nothing;
//   - what is written is encrypted and readable by the member and the
//     assigning clinician only;
//   - absent outside the demo while its rows are unsigned.

process.env.EMDR_DATA_DIR = `/tmp/steady-assigned-lane-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "assigned-lane-secret-at-least-32-characters";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "assigned-lane-key";

import { strict as assert } from "node:assert";
import test from "node:test";

import { getDb, newId, PLATFORM_TENANT_ID } from "../src/lib/db";
import { todayISO } from "../src/lib/gating";
import { AccessTier } from "../src/lib/safety/types";
import type { TenantContext } from "../src/lib/repository";
import { assignSupport, AssignmentRefused } from "../src/lib/clinical/assigned-support";
import {
  distressFlag, endLaneRun, laneGate, laneReasons, laneRunsForClinician, laneSteps, laneVisibility,
  liveLaneAssignments, LaneRefused, myLaneRuns, saveLaneStep, startLaneRun, type LaneGateInputs,
} from "../src/lib/assigned-lane";
import { getLaneModule, LANE_MODULES } from "../src/lib/content/h10-assigned-lane";
import { MODULES } from "../src/lib/modules";
import { ALL_PRACTICES } from "../src/lib/practices";
import { PROGRAMS } from "../src/lib/programs";
import { TECHNIQUES } from "../src/lib/therapy-kb/catalog";

const db = getDb();
const CRISIS = "I want to kill myself";
const WRITTEN = "the smell of the rain on the car park";

function person(role: string, name: string, checkin?: { notSafe?: boolean; dissociation?: number }): string {
  const id = newId();
  db.prepare("INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, ?, 'fabricated')").run(id, PLATFORM_TENANT_ID, name);
  db.prepare("INSERT INTO users (id, tenant_id, email, password_hash, role, name) VALUES (?, ?, ?, 'x', ?, ?)")
    .run(id, PLATFORM_TENANT_ID, `${id}@lane.test`, role, name);
  if (role === "member") {
    db.prepare(`INSERT INTO checkins (id, user_id, checkin_date, activation, shutdown, harm_urge, feels_safe, dissociation,
        sleep_quality, substance_flag, recommended_action) VALUES (?, ?, ?, 2, 2, 0, ?, ?, 7, 0, 'processing_ok')`)
      .run(newId(), id, todayISO(), checkin?.notSafe ? 0 : 1, checkin?.dissociation ?? 1);
  }
  return id;
}

const clinician = person("clinician", "Dr Vale");
const colleague = person("clinician", "Dr Okafor");
const ctx: TenantContext = { tenantId: PLATFORM_TENANT_ID, personId: clinician };
const future = () => new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10) + " 23:59:59";

let n = 0;
async function assign(member: string, over: Partial<Parameters<typeof assignSupport>[1]> = {}) {
  return assignSupport(ctx, {
    personId: member, supportId: "wet-v1", purposeCode: "between_visit",
    patientExplanation: "Thirty minutes of the writing we planned, before Thursday's visit.",
    availability: "assigned", expiresAt: future(), idempotencyKey: `lane-${++n}`, ...over,
  });
}

// ── The rules, pure ──────────────────────────────────────────────────────────

test("E01's distress flag: a rise of 3 or more, or above 7", () => {
  assert.equal(distressFlag(4, 7), true, "rose by 3");
  assert.equal(distressFlag(4, 6), false, "rose by 2");
  assert.equal(distressFlag(2, 8), true, "above 7");
  assert.equal(distressFlag(7, 7), false, "7 is not above 7, and did not rise");
  assert.equal(distressFlag(9, 8), true, "went down, but is still above 7");
  assert.equal(distressFlag(5, null), false, "no rating after: nothing to compare");
});

test("the gate's reasons: every one that applies, the assignment first", () => {
  const ok: LaneGateInputs = { signed: true, assignment: { live: true, expired: false }, hasContent: true, engine: { tier: AccessTier.STEADY, categories: [] } };
  assert.deepEqual(laneReasons(ok), []);
  assert.deepEqual(laneReasons({ ...ok, assignment: null, signed: false, engine: null }), ["no_active_assignment"],
    "without an assignment nothing else is said");
  assert.deepEqual(laneReasons({ ...ok, assignment: { live: false, expired: true }, engine: { tier: AccessTier.CRISIS, categories: ["crisis"] } }), ["expired"]);
  assert.deepEqual(laneReasons({ ...ok, engine: { tier: AccessTier.STEADY, categories: ["daily_route"], ruleIds: ["DAILY_DISSOCIATION_4"] } }), ["high_dissociation"]);
  assert.deepEqual(laneReasons({ ...ok, engine: { tier: AccessTier.CAUTIOUS, categories: [] } }), ["tier_below_steady"]);
  assert.deepEqual(laneReasons({ ...ok, engine: { tier: AccessTier.CRISIS, categories: ["crisis"] } }), ["crisis_today", "tier_below_steady"]);
  assert.deepEqual(laneReasons({ ...ok, engine: { tier: AccessTier.STEADY, categories: ["dissociation"] } }), ["high_dissociation"]);
  assert.deepEqual(laneReasons({ ...ok, engine: null }), ["engine_unreadable"], "an unreadable engine is not a yes");
  assert.deepEqual(laneReasons({ ...ok, hasContent: false, signed: false }), ["not_signed", "content_not_supplied"]);
});

// ── The containers ───────────────────────────────────────────────────────────

test("three drafts in Handoff 03's shape, as §6 stubs them, with no protocol content", () => {
  assert.deepEqual(LANE_MODULES.map((m) => [m.moduleId, m.clinicalReviewId]), [
    ["wet-v1", "CV10_E02"], ["cpt-worksheets-v1", "CV10_E03"], ["irt-nightmares-v1", "CV10_E04"],
  ]);
  for (const m of LANE_MODULES) {
    assert.equal(m.clinicalLane, "clinician_assigned");
    assert.equal(m.state, "draft");
    assert.equal(m.category, "trauma_processing");
    assert.deepEqual([...m.requiredGates], ["active_assignment", "tier>=STEADY", "no_crisis_today"]);
    assert.deepEqual([...m.contraindicationRuleIds], ["active_crisis", "high_dissociation"]);
    assert.deepEqual([...m.outcomeMeasureIds], ["pcl-5"]);
    assert.equal(m.contentOwner, "<partner>");
    assert.equal(m.content, null, "protocol content was written here; §6 forbids it");
    assert.ok(m.signoffRowIds.includes("CV10_E01") && m.signoffRowIds.includes("CV10_E05") && m.signoffRowIds.includes(m.clinicalReviewId));
    for (const s of m.demoPlaceholder) {
      const words = s.kind === "read" ? s.body : s.prompt;
      assert.match(words, /^Placeholder/, `${m.moduleId}/${s.id}: a demo step that does not say it is a placeholder`);
    }
  }
  assert.equal(getLaneModule("wet-v1")!.title, "Written exposure (clinician-assigned)", "the handoff's own title");
});

test("never listed anywhere a member browses", () => {
  const ids = new Set(LANE_MODULES.map((m) => m.moduleId));
  assert.ok(!MODULES.some((m) => ids.has(m.id)), "in the module catalog");
  assert.ok(!ALL_PRACTICES.some((p) => ids.has(p.id)), "in the practices");
  assert.ok(!PROGRAMS.some((p) => ids.has(p.id) || p.units.some((u) => u.practiceIds.some((x) => ids.has(x)))), "in a program");
  assert.ok(!TECHNIQUES.some((t) => ids.has(t.id)), "in the companion's knowledge base");
});

test("outside the demo it is absent, and cannot be assigned", async () => {
  const m = person("member", "Ana");
  process.env.EMDR_DEMO = "0";
  try {
    assert.equal(await laneVisibility(getLaneModule("wet-v1")!), "absent");
    assert.equal(laneSteps(getLaneModule("wet-v1")!), null, "no partner content and no demo: nothing to run");
    await assert.rejects(assign(m), (e: Error) => e instanceof AssignmentRefused && /not signed/.test(e.message));
  } finally {
    process.env.EMDR_DEMO = "1";
  }
  assert.equal(await laneVisibility(getLaneModule("wet-v1")!), "draft");
});

// ── Assignments ──────────────────────────────────────────────────────────────

test("an assignment must end", async () => {
  await assert.rejects(assign(person("member", "Bo"), { expiresAt: null }), (e: Error) => e instanceof AssignmentRefused && /end date/.test(e.message));
});

test("without a live assignment: not listed, not available, and not startable", async () => {
  const m = person("member", "Cy");
  assert.deepEqual(await liveLaneAssignments(m), []);
  const other = await assign(person("member", "Di"));
  const g = await laneGate(m, other.id);
  assert.equal(g.assignment, null, "another member's assignment was readable");
  assert.deepEqual(g.decision.reasonCodes[0], "no_active_assignment");
  await assert.rejects(startLaneRun(m, other.id, 3), LaneRefused);
  await assert.rejects(startLaneRun(m, "no-such-id", 3), LaneRefused);
});

test("an expired assignment is listed nowhere and cannot be started", async () => {
  const m = person("member", "Ed");
  const a = await assign(m, { expiresAt: "2020-01-01 23:59:59" });
  assert.deepEqual(await liveLaneAssignments(m), []);
  const g = await laneGate(m, a.id);
  assert.deepEqual(g.decision.reasonCodes, ["expired"]);
  await assert.rejects(startLaneRun(m, a.id, 3), (e: Error) => e instanceof LaneRefused && e.code === "expired");
});

test("an assignment is not enough: a crisis today or a dissociation hold still closes it", async () => {
  const crisis = person("member", "Fi", { notSafe: true });
  const a = await assign(crisis);
  const g = await laneGate(crisis, a.id);
  assert.equal(g.decision.allowed, false);
  assert.ok(g.decision.reasonCodes.includes("crisis_today"), g.decision.reasonCodes.join(","));
  assert.deepEqual(g.decision.permittedAlternativeModuleIds, ["skill-orient-room", "skill-contact-points"]);
  await assert.rejects(startLaneRun(crisis, a.id, 3), LaneRefused);
  const floating = person("member", "Gu", { dissociation: 9 });
  const b = await assign(floating);
  assert.deepEqual((await laneGate(floating, b.id)).decision.reasonCodes, ["high_dissociation", "tier_below_steady"]);
});

// ── Runs ─────────────────────────────────────────────────────────────────────

test("a run: distress before, the gate stored, writing encrypted, distress after", async () => {
  const m = person("member", "Hal");
  const a = await assign(m);
  assert.deepEqual((await liveLaneAssignments(m)).map((x) => x.id), [a.id]);
  await assert.rejects(startLaneRun(m, a.id, undefined), (e: Error) => e instanceof LaneRefused && e.code === "choose_distress");
  const runId = await startLaneRun(m, a.id, 4);
  const run = db.prepare("SELECT gate_snapshot_json, distress_before, module_version FROM intervention_runs WHERE id = ?").get(runId) as
    { gate_snapshot_json: string; distress_before: number; module_version: string };
  assert.equal(JSON.parse(run.gate_snapshot_json).allowed, true);
  assert.equal(run.distress_before, 4);
  assert.equal(run.module_version, "0-draft");
  await assert.rejects(saveLaneStep(m, runId, "intro", "x"), LaneRefused, "a read step takes no answer");
  assert.deepEqual(await saveLaneStep(m, runId, "narrative", WRITTEN), { ok: true });
  const row = db.prepare("SELECT encrypted_free_text FROM intervention_run_responses WHERE run_id = ?").get(runId) as { encrypted_free_text: string };
  assert.match(row.encrypted_free_text, /^enc1:/);
  assert.ok(!row.encrypted_free_text.includes("rain"));
  const r = await endLaneRun(m, runId, { stopped: false, distressAfter: 5, useful: "yes", note: "hard but okay" });
  assert.deepEqual(r, { ok: true, flagged: false });
  const flags = db.prepare("SELECT COUNT(*) AS n FROM alerts WHERE user_id = ? AND alert_type = 'assigned_practice_distress'").get(m) as { n: number };
  assert.equal(flags.n, 0, "a flag fired on a rise of 1");
  // The member's own view: their words, no ratings.
  const mine = await myLaneRuns(m, a.id);
  assert.deepEqual(mine[0].written, [{ stepId: "narrative", answer: WRITTEN }]);
  assert.equal(mine[0].note, "hard but okay");
  assert.equal(mine[0].distressBefore, undefined, "a rating was shown back to the member");
});

test("finishing needs the rating after; the flag fires on a rise of 3 and reaches the queue without the words", async () => {
  const m = person("member", "Ivo");
  const a = await assign(m);
  const runId = await startLaneRun(m, a.id, 3);
  await saveLaneStep(m, runId, "narrative", WRITTEN);
  await assert.rejects(endLaneRun(m, runId, { stopped: false }), (e: Error) => e instanceof LaneRefused && e.code === "choose_distress");
  assert.deepEqual(await endLaneRun(m, runId, { stopped: false, distressAfter: 6 }), { ok: true, flagged: true });
  const alert = db.prepare("SELECT severity, detail FROM alerts WHERE user_id = ? AND alert_type = 'assigned_practice_distress'").get(m) as { severity: string; detail: string };
  assert.equal(alert.severity, "high");
  assert.match(alert.detail, /from 3 to 6/);
  assert.ok(!alert.detail.includes("rain"), "the words reached the alert");
});

test("stop is always there and costs nothing: no rating needed, no flag, no refusal next time", async () => {
  const m = person("member", "Jo");
  const a = await assign(m);
  const runId = await startLaneRun(m, a.id, 5);
  assert.deepEqual(await endLaneRun(m, runId, { stopped: true }), { ok: true, flagged: false });
  const run = db.prepare("SELECT status, stop_reason_code FROM intervention_runs WHERE id = ?").get(runId) as { status: string; stop_reason_code: string };
  assert.deepEqual(run, { status: "stopped_by_patient", stop_reason_code: "patient_stop" });
  assert.equal((await laneGate(m, a.id)).decision.allowed, true, "stopping closed the practice");
  // A stop with a high rating after still flags: the rule is about distress, not about finishing.
  const again = await startLaneRun(m, a.id, 2);
  assert.deepEqual(await endLaneRun(m, again, { stopped: true, distressAfter: 8 }), { ok: true, flagged: true });
});

test("crisis language in the writing saves nothing and ends the run as a policy hard stop", async () => {
  const m = person("member", "Kai");
  const a = await assign(m);
  const runId = await startLaneRun(m, a.id, 3);
  assert.deepEqual(await saveLaneStep(m, runId, "narrative", `${WRITTEN}. ${CRISIS}`), { ok: false, crisis: true });
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM intervention_run_responses WHERE run_id = ?").get(runId) as { n: number }).n, 0);
  const run = db.prepare("SELECT status, stop_reason_code FROM intervention_runs WHERE id = ?").get(runId) as { status: string; stop_reason_code: string };
  assert.deepEqual(run, { status: "hard_stopped_by_policy", stop_reason_code: "crisis_language" });
  await assert.rejects(saveLaneStep(m, runId, "narrative", WRITTEN), LaneRefused, "a hard-stopped run took more writing");
});

test("only the assigning clinician reads what was written; each read is audited", async () => {
  const m = person("member", "Lu");
  const a = await assign(m);
  const runId = await startLaneRun(m, a.id, 3);
  await saveLaneStep(m, runId, "narrative", WRITTEN);
  await endLaneRun(m, runId, { stopped: false, distressAfter: 3 });
  const seen = await laneRunsForClinician(clinician, m, a.id);
  assert.equal(seen[0].written[0].answer, WRITTEN);
  assert.deepEqual([seen[0].distressBefore, seen[0].distressAfter, seen[0].flagged], [3, 3, false]);
  await assert.rejects(laneRunsForClinician(colleague, m, a.id), (e: Error) => e instanceof LaneRefused && e.code === "not_yours");
  await assert.rejects(laneRunsForClinician(clinician, person("member", "Mo"), a.id), LaneRefused, "the id was read under the wrong person");
  const audits = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE actor_id = ? AND event_type = 'assigned_writing_viewed'").get(clinician) as { n: number };
  assert.ok(audits.n >= 1);
});

test("the spine carries coded facts: ratings and ids, never the writing", async () => {
  const rows = db.prepare("SELECT payload FROM longitudinal_events WHERE event_type LIKE 'intervention.run_%'").all() as Array<{ payload: string }>;
  assert.ok(rows.length > 0);
  for (const r of rows) {
    assert.ok(!r.payload.includes("rain") && !r.payload.includes("kill"), "writing reached the spine");
    for (const k of Object.keys(JSON.parse(r.payload))) {
      assert.ok(["runId", "assignmentId", "moduleId", "moduleVersion", "decisionId", "distressBefore", "distressAfter", "flagged", "stopReason"].includes(k), `unexpected field ${k}`);
    }
  }
});

test("demo reset clears the lane's rows before the people they reference", async () => {
  // Found by running the reset after a real run: persons went first and the
  // foreign key stopped it. Pinned here because no other fixture has lane rows.
  const { DEMO_DATA_TABLES } = await import("../src/lib/demo-reset");
  const at = (t: string) => DEMO_DATA_TABLES.indexOf(t as (typeof DEMO_DATA_TABLES)[number]);
  assert.ok(at("intervention_run_responses") >= 0 && at("intervention_runs") >= 0, "the lane's tables are not reset");
  assert.ok(at("intervention_run_responses") < at("intervention_runs"), "runs are cleared before their responses");
  assert.ok(at("intervention_runs") < at("persons"), "persons are cleared before the runs that reference them");
});
