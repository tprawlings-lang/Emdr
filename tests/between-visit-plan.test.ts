// The shared between-visit plan (17 September handoff, P3).
//
//   "The plan is one read model assembled from current care-plan, goal,
//   assignment, session, and safety facts. Do not create another authoritative
//   plan table unless the current domain model cannot express a required fact.
//   Patient and clinician views may use different language, but they must
//   resolve to the same source versions."
//
// The failure this is shaped against is two views of one plan becoming two
// plans: a patient screen and a clinician screen written months apart, each
// assembling what it needs from whatever it can reach, until the two people in
// the room are reading different documents and neither knows.

process.env.EMDR_DATA_DIR = `/tmp/steady-bvp-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "between-visit-plan-secret-at-least-32ch";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "between-visit-plan-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { getDb, newId, PLATFORM_TENANT_ID } from "../src/lib/db";
import type { TenantContext } from "../src/lib/repository";
import { MODULES } from "../src/lib/modules";
import { assignSupport } from "../src/lib/clinical/assigned-support";
import { createGoal, confirmGoal } from "../src/lib/clinical/return-to-life";
import type { GoalLadderRung } from "../src/lib/clinical/return-to-life-vocabulary";
import {
  buildBetweenVisitPlan, patientPlan, clinicianPlan, PLAN_FIELDS,
} from "../src/lib/clinical/between-visit-plan";

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const db = getDb();
function person(role: string, name: string): string {
  const id = newId();
  db.prepare(
    "INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, ?, 'fabricated')"
  ).run(id, PLATFORM_TENANT_ID, name);
  db.prepare(
    "INSERT INTO users (id, tenant_id, email, password_hash, role, name) VALUES (?, ?, ?, 'x', ?, ?)"
  ).run(id, PLATFORM_TENANT_ID, `${id}@bvp.test`, role, name);
  return id;
}

const clinician = person("clinician", "Dr Okafor");
const member = person("member", "Nina");
const ctx: TenantContext = { tenantId: PLATFORM_TENANT_ID, personId: clinician };
const NOW = new Date("2026-09-18T10:00:00Z");
const MOD = MODULES.find((m) => m.order >= 7)!;
const EXPLANATION = "Ten minutes of the container practice each evening until we meet on Thursday.";

const LADDER: GoalLadderRung[] = [
  { level: -2, description: "Eats alone in another room." },
  { level: -1, description: "Sits at the table for part of the meal." },
  { level: 0, description: "Stays for the whole meal most evenings." },
  { level: 1, description: "Stays and takes part in the conversation." },
  { level: 2, description: "Meals are ordinary again." },
];

let keys = 0;
async function assignOne(over: Record<string, unknown> = {}) {
  return assignSupport(ctx, {
    personId: member, supportId: MOD.id, purposeCode: "between_visit",
    patientExplanation: EXPLANATION, availability: "assigned",
    idempotencyKey: `bvp-${++keys}`, ...over,
  } as Parameters<typeof assignSupport>[1]);
}

/**
 * A plan with more than one source behind a field.
 *
 * THE FIRST VERSION OF THIS FILE DID NOT HAVE THIS AND ITS BEST TEST WAS
 * WORTHLESS. "Both views resolve to the same sources" ran against a person with
 * one assignment and no goal, so most fields had zero or one source — and a
 * mutation that made the patient view keep only its FIRST source changed
 * nothing and passed. A comparison between two lists proves nothing until the
 * lists are long enough to differ.
 */
const SECOND = MODULES.find((m) => m.order >= 7 && m.id !== MOD.id)!;
async function richPlan() {
  await assignOne({ idempotencyKey: "bvp-rich-a" });
  await assignOne({ idempotencyKey: "bvp-rich-b", supportId: SECOND.id });
  return buildBetweenVisitPlan(ctx, member, NOW);
}

// ---------------------------------------------------------------------------
// One plan, two renderings
// ---------------------------------------------------------------------------

test("both views resolve to the same sources, field by field", async () => {
  // THE LOAD-BEARING TEST. Asserted per field rather than over the plan as a
  // whole: two views could carry the same TOTAL set of sources while
  // disagreeing about which field rests on which, and that is already two
  // documents.
  const plan = await richPlan();
  const mine = patientPlan(plan);
  const theirs = clinicianPlan(plan);

  // THE TEST HAS TO BE ABLE TO FAIL. Without this the comparison below passes
  // on empty lists, which is how the first version of it survived a mutation
  // that made one view drop every source but the first.
  const widest = Math.max(...PLAN_FIELDS.map((f) => plan[f].sources.length));
  assert.ok(widest >= 2,
    `no field rests on more than one source (widest is ${widest}), so comparing the two ` +
    "views cannot detect one of them narrowing its evidence");

  for (const f of PLAN_FIELDS) {
    assert.deepEqual(mine[f].sources, theirs[f].sources,
      `${f} rests on different evidence in the two views, so they are two plans`);
  }
});

test("a view selects a rendering and cannot assemble one", () => {
  // The structural half. The moment a view can read a database, compute a fact
  // or reach a source of its own, the two documents have started to drift —
  // and it will be months before anybody compares them.
  const src = code(read("src/lib/clinical/between-visit-plan.ts"));
  const views = src.slice(src.indexOf("export function patientPlan"));
  for (const forbidden of ["data()", "await", "getProgramPlan", "listGoals", "assignmentsFor", "SELECT"]) {
    assert.ok(!views.includes(forbidden),
      `a view reaches ${forbidden}, so it is assembling rather than selecting`);
  }
});

test("every field is rendered for both, so neither view is quietly shorter", async () => {
  const plan = await buildBetweenVisitPlan(ctx, member, NOW);
  const mine = patientPlan(plan);
  const theirs = clinicianPlan(plan);
  assert.deepEqual(Object.keys(mine).sort(), [...PLAN_FIELDS].sort());
  assert.deepEqual(Object.keys(theirs).sort(), [...PLAN_FIELDS].sort());
  assert.equal(PLAN_FIELDS.length, 6, "the handoff's table has six rows");
});

test("no second plan table was created", () => {
  // "Do not create another authoritative plan table unless the current domain
  // model cannot express a required fact." It could.
  const src = code(read("src/lib/clinical/between-visit-plan.ts"));
  assert.ok(!/INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM|\.insert\(/i.test(src),
    "the plan writes somewhere, so it is a second record rather than a reading of the first");
  const schema = read("src/lib/db.ts");
  assert.ok(!/CREATE TABLE IF NOT EXISTS between_visit_plans/.test(schema),
    "a plan table was added");
});

// ---------------------------------------------------------------------------
// The language differs; the facts do not
// ---------------------------------------------------------------------------

test("the patient reads their own words and the clinician reads the clinical ones", async () => {
  // Through the domain's own creator rather than a raw INSERT: the patient's
  // statement is encrypted at rest, so a fixture that wrote the column directly
  // would be testing a row shape the product never produces.
  const goal = await createGoal(ctx, {
    personId: member,
    title: "Re-engage with family routines",
    patientStatement: "Eat dinner with my kids without checking out",
    whyItMatters: "They have noticed me going quiet",
    domain: "relationships",
    ladder: LADDER,
  });
  await confirmGoal(ctx, goal.id, "2026-09-18 10:00:00");

  const plan = await buildBetweenVisitPlan(ctx, member, NOW);
  assert.equal(plan.currentFocus.patient.focus, "Eat dinner with my kids without checking out",
    "the patient's focus was paraphrased into clinical language");
  assert.match(plan.currentFocus.clinician.focus ?? "", /Re-engage with family routines \(relationships\)/);
  assert.match(plan.currentFocus.clinician.provenance, /confirmed 2026-09-18/,
    "the clinician view does not say whether the goal was confirmed with the person");

  // Different words, same evidence.
  assert.deepEqual(
    patientPlan(plan).currentFocus.sources,
    clinicianPlan(plan).currentFocus.sources
  );
});

test("the person reads the words their clinician wrote for them", async () => {
  const plan = await buildBetweenVisitPlan(ctx, member, NOW);
  const line = plan.assignedSupport.patient[0];
  assert.ok(line, "an assignment is not in the plan");
  assert.equal(line.purpose, EXPLANATION,
    "the person is shown a purpose code or a summary rather than what they were told");

  const theirs = plan.assignedSupport.clinician[0];
  assert.match(theirs.authority, /Assigning does not open it/,
    "the clinician view does not restate that assigning is not access");
});

// ---------------------------------------------------------------------------
// Completion, including the state that means "we do not know"
// ---------------------------------------------------------------------------

test("nothing recorded is not the same as not done", async () => {
  const plan = await buildBetweenVisitPlan(ctx, member, NOW);
  const line = plan.completion.clinician[0];
  assert.equal(line.state, "not_recorded");
  assert.match(line.meaning, /Absence of a record, not evidence of non-use/);
  assert.match(plan.completion.patient[0].said, /not a judgement/i,
    "the person is told they failed to do something nobody wrote down");
});

test("a session that never wrote an ending is uncertain, not incomplete", async () => {
  // "Do not record support.activity.completed when the activity write remains
  // uncertain." The state exists because the two-state version makes "we do not
  // know" indistinguishable from "they did not", and a clinician reading the
  // second when the first is true will raise it in session.
  const a = await assignOne({ idempotencyKey: `bvp-uncertain-${Date.now()}` });
  db.prepare(
    `INSERT INTO therapy_sessions (id, user_id, tenant_id, module_id, status, started_at, ended_at)
     VALUES (?, ?, ?, ?, 'in_progress', ?, NULL)`
  ).run(newId(), member, PLATFORM_TENANT_ID, MOD.id, a.startsAt);

  const plan = await buildBetweenVisitPlan(ctx, member, NOW);
  const line = plan.completion.clinician.find((l) => l.state === "uncertain");
  assert.ok(line, "a session with no recorded ending reads as done or not done");
  assert.match(line.meaning, /do not read it as either/i);
  assert.match(line.source, /therapy_sessions/, "the clinician cannot see which row this rests on");

  // And a completed one is recorded.
  db.prepare(
    `INSERT INTO therapy_sessions (id, user_id, tenant_id, module_id, status, started_at, ended_at)
     VALUES (?, ?, ?, ?, 'completed', ?, ?)`
  ).run(newId(), member, PLATFORM_TENANT_ID, MOD.id, a.startsAt, "2026-09-17 20:00:00");
  const after = await buildBetweenVisitPlan(ctx, member, NOW);
  assert.ok(after.completion.clinician.some((l) => l.state === "recorded"));
});

// ---------------------------------------------------------------------------
// What the plan may not claim
// ---------------------------------------------------------------------------

test("no report is described as shared, because nothing shares one", async () => {
  const plan = await buildBetweenVisitPlan(ctx, member, NOW);
  assert.equal(plan.patientReport.patient.shared, false);
  assert.equal(plan.patientReport.clinician.available, false);
  assert.match(plan.patientReport.clinician.note, /no route in this build that sends one/i);
  assert.doesNotMatch(plan.patientReport.patient.preview, /\bsent\b(?! anywhere)/i,
    "the preview implies something was sent");
});

test("the support path reports the delivery state rather than describing one", async () => {
  const plan = await buildBetweenVisitPlan(ctx, member, NOW);
  assert.match(plan.supportPath.clinician.delivery, /not monitored/i,
    "the plan claims an escalation channel the product does not have");
  assert.match(plan.supportPath.clinician.responsePolicy, /No response time can be promised/);
  assert.match(plan.supportPath.patient.route, /do not depend on anybody reading a message/i,
    "the person is pointed at a route that depends on somebody reading something");

  // Read from the delivery module, so a channel landing changes this sentence
  // rather than leaving a hand-written one behind.
  const src = code(read("src/lib/clinical/between-visit-plan.ts"));
  assert.match(src, /deliveryNotice\(/, "the support path writes its own delivery sentence");
});

test("a review date nobody set is a stated absence", async () => {
  const empty = person("member", "Nobody");
  const plan = await buildBetweenVisitPlan(ctx, empty, NOW);
  assert.equal(plan.nextReview.patient.on, null);
  assert.match(plan.nextReview.clinician.queueState, /No review date is set/);
  assert.match(plan.currentFocus.clinician.provenance, /Nothing on this record states a focus/);
});

test("the plan carries its own provenance, deduplicated", async () => {
  const plan = await buildBetweenVisitPlan(ctx, member, NOW);
  assert.ok(plan.sources.length > 0, "the plan cites nothing it was built from");
  const keys = plan.sources.map((s) => `${s.kind}:${s.id}:${s.version}`);
  assert.equal(new Set(keys).size, keys.length, "the same source is cited twice");

  // Every field's sources appear in the plan's own list.
  for (const f of PLAN_FIELDS) {
    for (const s of plan[f].sources) {
      assert.ok(keys.includes(`${s.kind}:${s.id}:${s.version}`),
        `${f} rests on a source the plan does not declare`);
    }
  }
});
