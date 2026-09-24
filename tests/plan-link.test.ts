// The plan link (decided 24 September).
//
// WHAT IT IS: the connection between one piece of assigned support and the goal
// it is meant to move. §13's care vocabulary has carried `adjust_plan_link`
// since it was written and nothing could produce one, because nothing in the
// product had a link on a plan to adjust.
//
// THE GAP IT CLOSES was visible in the between-visit plan itself: it showed a
// person their focus, in their own words, and underneath it the support they
// had been asked to do, with nothing saying which served which. A clinician
// knew; the plan did not.
//
// WHAT THESE TESTS ARE SHAPED AGAINST is the cheap version of this feature — a
// column somebody can set, with a care-ledger row beside it and nothing that
// checks whose goal it is, whether the goal was ever agreed with the person, or
// whether the link moved at all before recording that a clinician moved it.

process.env.EMDR_DATA_DIR = `/tmp/steady-plan-link-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "plan-link-secret-at-least-32-characters";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "plan-link-key";

import { strict as assert } from "node:assert";
import test from "node:test";

import { getDb, newId, PLATFORM_TENANT_ID } from "../src/lib/db";
import { data } from "../src/lib/data";
import type { TenantContext } from "../src/lib/repository";
import { MODULES } from "../src/lib/modules";
import {
  assignSupport, linkAssignmentToGoal, changeAssignment, assignmentsFor,
  AssignmentRefused, LINKABLE_GOAL_STATUSES,
} from "../src/lib/clinical/assigned-support";
import { createGoal, confirmGoal, type Goal } from "../src/lib/clinical/return-to-life";
import { careActionsForPerson } from "../src/lib/clinical/attention-signals";
import { buildBetweenVisitPlan, patientPlan, clinicianPlan } from "../src/lib/clinical/between-visit-plan";

const db = getDb();
function person(role: string, name: string): string {
  const id = newId();
  db.prepare(
    "INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, ?, 'fabricated')"
  ).run(id, PLATFORM_TENANT_ID, name);
  db.prepare(
    "INSERT INTO users (id, tenant_id, email, password_hash, role, name) VALUES (?, ?, ?, 'x', ?, ?)"
  ).run(id, PLATFORM_TENANT_ID, `${id}@plan-link.test`, role, name);
  return id;
}

const clinician = person("clinician", "Dr Vale");
const member = person("member", "Rosa");
const other = person("member", "Sam");
const ctx: TenantContext = { tenantId: PLATFORM_TENANT_ID, personId: clinician };

const SUPPORT = MODULES.find((m) => m.order >= 7)!;
const EXPLANATION = "Ten minutes of the container practice before Thursday, when we will use it.";

const LADDER = [-2, -1, 0, 1, 2].map((level) => ({
  level: level as -2 | -1 | 0 | 1 | 2,
  description: `What level ${level} looks like`,
}));

let n = 0;
const assign = (over: Partial<Parameters<typeof assignSupport>[1]> = {}) =>
  assignSupport(ctx, {
    personId: member,
    supportId: SUPPORT.id,
    purposeCode: "between_visit",
    patientExplanation: EXPLANATION,
    availability: "assigned",
    idempotencyKey: `plan-link-${++n}`,
    ...over,
  });

async function goalFor(personId: string, title: string, statement: string): Promise<Goal> {
  const g = await createGoal(ctx, {
    personId, title, patientStatement: statement,
    domain: "daily_living", ladder: LADDER,
  });
  return confirmGoal(ctx, g.id, "2026-09-24 10:00:00");
}

// ---------------------------------------------------------------------------
// Whose goal it is
// ---------------------------------------------------------------------------

test("an assignment cannot be linked to somebody else's goal", async () => {
  // THE ONE THAT MATTERS. Two people in one tenant, and a link that did not
  // check would put one person's stated goal on another person's plan — and
  // the plan renders the goal's own words to the person reading it, so the
  // leak would be visible rather than theoretical.
  const theirs = await goalFor(other, "Sam's goal", "I want to drive to my sister again.");
  const a = await assign();
  await assert.rejects(
    () => linkAssignmentToGoal(ctx, { assignmentId: a.id, goalId: theirs.id }),
    (e: Error) => e instanceof AssignmentRefused && /belongs to somebody else/.test(e.message),
  );
  const [after] = await assignmentsFor(ctx, member);
  assert.equal(after.goalId, null, "the link was written despite being refused");
});

test("a goal that does not exist is refused rather than stored", async () => {
  const a = await assign();
  await assert.rejects(
    () => linkAssignmentToGoal(ctx, { assignmentId: a.id, goalId: "no-such-goal" }),
    (e: Error) => e instanceof AssignmentRefused,
  );
});

// ---------------------------------------------------------------------------
// What may be linked to
// ---------------------------------------------------------------------------

test("support cannot be linked to a goal the person has not confirmed", async () => {
  // §12's rule, not a preference: a draft is wording nobody has agreed with
  // them. Linking to it would put unconfirmed language in front of the person
  // as the reason they were asked to do something.
  const draft = await createGoal(ctx, {
    personId: member, title: "Drafted, not agreed",
    patientStatement: "Wording the clinician is still writing.",
    domain: "daily_living", ladder: LADDER,
  });
  assert.equal(draft.status, "draft", "the fixture is not a draft, so this proves nothing");
  const a = await assign();
  await assert.rejects(
    () => linkAssignmentToGoal(ctx, { assignmentId: a.id, goalId: draft.id }),
    (e: Error) => e instanceof AssignmentRefused && /draft/.test(e.message),
  );
});

test("a completed goal may still be linked to", () => {
  // "Holding gains after the main work" is one of the five purposes the product
  // offers, and that work serves a goal somebody has already reached. A
  // linkable list of active-only would have made that purpose unusable.
  assert.ok(LINKABLE_GOAL_STATUSES.includes("completed"),
    "support for holding gains cannot name the goal whose gains it holds");
  assert.ok(!(LINKABLE_GOAL_STATUSES as readonly string[]).includes("draft"),
    "a draft goal is offered as a link target");
});

// ---------------------------------------------------------------------------
// The care ledger
// ---------------------------------------------------------------------------

test("linking, moving and clearing each record one adjustment", async () => {
  const first = await goalFor(member, "Back to the school run", "I want to do the school run again.");
  const second = await goalFor(member, "Sleeping through", "I want to sleep through the night.");
  const a = await assign();

  const before = (await careActionsForPerson(ctx, member, 500)).filter((e) => e.action === "adjust_plan_link");

  const set = await linkAssignmentToGoal(ctx, { assignmentId: a.id, goalId: first.id });
  assert.equal(set.from, null);
  assert.equal(set.to, first.id);
  assert.ok(set.careActionId, "the link was made and nothing recorded it");

  const moved = await linkAssignmentToGoal(ctx, { assignmentId: a.id, goalId: second.id });
  assert.equal(moved.from, first.id, "the ledger cannot say what it moved from");

  const cleared = await linkAssignmentToGoal(ctx, { assignmentId: a.id, goalId: null });
  assert.equal(cleared.to, null);

  const after = (await careActionsForPerson(ctx, member, 500)).filter((e) => e.action === "adjust_plan_link");
  assert.equal(after.length - before.length, 3,
    "three adjustments produced a different number of care-ledger entries");

  // THE HISTORY IS IN THE LEDGER, which is the reason a column is enough. The
  // second entry has to name the goal it moved to, or the column's history is
  // genuinely lost rather than relocated.
  assert.ok(after.some((e) => (e.note ?? "").includes("Sleeping through")),
    "the ledger does not say what the link was moved to");
});

test("re-submitting the same link is refused rather than recorded", async () => {
  // A FORM CAN BE SUBMITTED TWICE FOR ENTIRELY ORDINARY REASONS. Recording that
  // a clinician adjusted a plan link, for a link that did not move, is care
  // time that did not happen — and care time that did not happen is the one
  // thing this ledger cannot survive.
  const goal = await goalFor(member, "Shopping alone", "I want to do a big shop by myself.");
  const a = await assign();
  await linkAssignmentToGoal(ctx, { assignmentId: a.id, goalId: goal.id });

  const before = (await careActionsForPerson(ctx, member, 500)).filter((e) => e.action === "adjust_plan_link").length;
  await assert.rejects(
    () => linkAssignmentToGoal(ctx, { assignmentId: a.id, goalId: goal.id }),
    (e: Error) => e instanceof AssignmentRefused && /already linked/.test(e.message),
  );
  const after = (await careActionsForPerson(ctx, member, 500)).filter((e) => e.action === "adjust_plan_link").length;
  assert.equal(after, before, "a no-op wrote a care-time record");
});

test("clearing a link that is not there is refused", async () => {
  const a = await assign();
  await assert.rejects(
    () => linkAssignmentToGoal(ctx, { assignmentId: a.id, goalId: null }),
    (e: Error) => e instanceof AssignmentRefused && /nothing to clear/.test(e.message),
  );
});

test("what a finished assignment was for cannot be rewritten", async () => {
  const goal = await goalFor(member, "Walking the dog", "I want to walk the dog in the mornings.");
  const a = await assign();
  await changeAssignment(ctx, { assignmentId: a.id, to: "completed" });
  await assert.rejects(
    () => linkAssignmentToGoal(ctx, { assignmentId: a.id, goalId: goal.id }),
    (e: Error) => e instanceof AssignmentRefused && /part of the record/.test(e.message),
  );
});

// ---------------------------------------------------------------------------
// Set at the moment of assigning
// ---------------------------------------------------------------------------

test("a link made when the support is assigned goes through the same checks", async () => {
  // TWO DOORS TO ONE FACT is how rules diverge. The creation path and the
  // relink path share `linkableGoal`, and this is what holds them together.
  const theirs = await goalFor(other, "Sam's other goal", "I want to cook again.");
  await assert.rejects(
    () => assign({ goalId: theirs.id }),
    (e: Error) => e instanceof AssignmentRefused && /belongs to somebody else/.test(e.message),
  );

  const mine = await goalFor(member, "Reading again", "I want to read a book to the end.");
  const a = await assign({ goalId: mine.id });
  assert.equal(a.goalId, mine.id, "the link was not stored at assignment time");
});

test("a refused link leaves no assignment behind", async () => {
  // THE ORDER MATTERS AND IS EASY TO GET WRONG: validating the goal after the
  // insert would leave an assignment somebody was told about, with the
  // clinician looking at an error saying it did not happen.
  const theirs = await goalFor(other, "Sam again", "I want to swim.");
  const key = `orphan-${Date.now()}`;
  const c = await data();
  await assert.rejects(() => assign({ goalId: theirs.id, idempotencyKey: key }));
  const rows = (await c.all(
    "SELECT id FROM support_assignments WHERE idempotency_key = ?", [key]
  )) as unknown[];
  assert.equal(rows.length, 0, "a refused assignment was written anyway");
});

// ---------------------------------------------------------------------------
// Both people see the same link
// ---------------------------------------------------------------------------

test("the plan shows the link to the clinician and to the person, from one source", async () => {
  // A PERSON OF THIS TEST'S OWN, because the plan assembles everything live for
  // whoever it is asked about, and the tests above have already linked support
  // for `member`. Reading the first linked line off a shared person would pass
  // on somebody else's link.
  const reader = person("member", "Ada");
  const goal = await goalFor(reader, "Back to the allotment", "I want to get back to the allotment.");
  const a = await assign({ personId: reader });
  await linkAssignmentToGoal(ctx, { assignmentId: a.id, goalId: goal.id });

  const plan = await buildBetweenVisitPlan(ctx, reader, new Date());
  const mine = plan.assignedSupport.patient.find((x) => x.towards);
  const theirs = plan.assignedSupport.clinician.find((x) => x.towards);
  assert.ok(mine, "the person is not shown what their work is towards");
  assert.ok(theirs, "the clinician is not shown what the work is towards");

  // THEIR OWN WORDS ON THEIR SIDE, the clinical title with its state on the
  // other. The same fact, said twice, which is this module's whole rule.
  assert.equal(mine!.towards, "I want to get back to the allotment.");
  assert.match(theirs!.towards!, /Back to the allotment \(active\)/);

  // AND ONE SET OF SOURCES. A clinician column citing a goal the patient column
  // cannot trace is the drift this module exists to prevent.
  const p = patientPlan(plan).assignedSupport;
  const c = clinicianPlan(plan).assignedSupport;
  assert.deepEqual(p.sources, c.sources, "the two views cite different sources");
  assert.ok(p.sources.some((s) => s.kind === "goal" && s.id === goal.id),
    "the linked goal is rendered but is not a source of the field that renders it");
});

test("a goal that cannot be read is said, not silently dropped", async () => {
  // A LINK POINTING AT NOTHING IS NOT THE SAME AS NO LINK, and only the plan
  // can tell the difference. Rendering it as "not linked" would report a lost
  // record as a decision nobody made.
  const orphaned = person("member", "Bea");
  const goal = await goalFor(orphaned, "Temporary", "I want something that will be deleted.");
  const a = await assign({ personId: orphaned });
  await linkAssignmentToGoal(ctx, { assignmentId: a.id, goalId: goal.id });

  const c = await data();
  // The ladder first: the levels reference the goal, and the column carrying
  // the link deliberately does not — which is the whole reason this state is
  // reachable and has to be rendered rather than assumed away.
  await c.run("DELETE FROM return_to_life_goal_levels WHERE goal_id = ?", [goal.id]);
  await c.run("DELETE FROM return_to_life_goals WHERE id = ?", [goal.id]);

  const plan = await buildBetweenVisitPlan(ctx, orphaned, new Date());
  const line = plan.assignedSupport.clinician.find((x) => x.linkNote);
  assert.ok(line, "a link to a missing goal renders as though there were no link");
  assert.match(line!.linkNote!, /can no longer be read/);
});
