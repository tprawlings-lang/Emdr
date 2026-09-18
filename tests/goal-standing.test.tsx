import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import {
  goalStanding, nextMilestone, lastAccepted, observationLine, reviewStanding,
  type StandingObservation,
} from "../src/lib/clinical/goal-standing";
import { GoalStanding } from "../src/components/clinical/GoalStanding";
import type { GoalLadderRung } from "../src/lib/clinical/return-to-life-vocabulary";

// Goals (17 September handoff, P4).
//
//   "Show patient wording, observable milestone, last observation, and next
//   review. Empty state supports goal creation without implying failure."
//
// The wording was already the first thing on the panel. The other three were
// each present-but-unfindable in a different way, and one of them was not
// present at all: `target_review_date` has been a column since goals shipped,
// `createGoal` accepted it, no form offered it and no screen rendered it — so
// every goal in the product carried null and the record was silent about when
// anybody intended to look again.

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const code = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ")
   .replace(/^\s*\/\/.*$/gm, " ");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const AS_OF = "2026-09-18T09:00:00.000Z";

const RUNGS: GoalLadderRung[] = [
  { level: -2, description: "I order online and someone else collects it." },
  { level: -1, description: "I go to the corner shop with my sister." },
  { level: 0, description: "I do a small shop on my own on a quiet morning." },
  { level: 1, description: "I do the weekly shop on my own." },
  { level: 2, description: "I shop on a Saturday without planning around it." },
];

const obs = (o: Partial<StandingObservation>): StandingObservation => ({
  observedLevel: -1, evidenceClass: "clinician_observed",
  occurredAt: "2026-09-01T10:00:00Z", status: "accepted", ...o,
});

// ---------------------------------------------------------------------------
// The observable milestone
// ---------------------------------------------------------------------------

test("the next step is the rung above, in the words the ladder was written in", () => {
  const m = nextMilestone(-1, RUNGS);
  assert.equal(m?.level, 0);
  assert.match(m!.said, /I do a small shop on my own on a quiet morning\./,
    "the milestone is described in something other than the clinician's own wording for it");
});

test("a goal with no accepted level yet points at the bottom of the ladder", () => {
  // Not at the goal, and not at nothing. A ladder exists precisely so the next
  // observable thing is smaller than the thing they came for.
  const m = nextMilestone(null, RUNGS);
  assert.equal(m?.level, -2);
});

test("a goal with nothing observed asks for the baseline, not for \"where you are now\"", () => {
  // Read literally, the rung labels produce "Next step: Where you are now",
  // which contradicts itself on the screen. The next thing to do on a goal
  // nobody has observed is to record where they are, and saying that is both
  // accurate and an instruction.
  const s = goalStanding({ currentLevel: null, targetReviewDate: null }, RUNGS, [], AS_OF);
  assert.equal(s.milestone?.level, -2, "the marked rung is still the bottom of the ladder");
  assert.match(s.milestoneSaid, /first step is to record where they are/);
  assert.doesNotMatch(s.milestoneSaid, /^Where you are now —/,
    "the next step reads as the step they are already on");
  assert.match(s.milestoneSaid, /I order online and someone else collects it\./);
});

test("the ladder marks the rung the standing block names", () => {
  // Two places naming the next step, and one of them naming a different one, is
  // how a reader comes to trust neither.
  const page = code(read("src/app/clinician/member/[id]/goals/page.tsx"));
  assert.match(page, /standing\.milestone\?\.level === r\.level/,
    "the ladder does not mark the next rung, so the block and the list can disagree");
});

test("the top of the ladder has no step above it, and says so", () => {
  const s = goalStanding(
    { currentLevel: 2, targetReviewDate: null }, RUNGS, [], AS_OF
  );
  assert.equal(s.milestone, null);
  assert.match(s.milestoneSaid, /no step above this one/);
});

// ---------------------------------------------------------------------------
// The last observation, and what does not count as one
// ---------------------------------------------------------------------------

test("the last observation is the most recent accepted one", () => {
  const last = lastAccepted([
    obs({ occurredAt: "2026-08-01T10:00:00Z" }),
    obs({ occurredAt: "2026-09-10T10:00:00Z", observedLevel: 0 }),
    obs({ occurredAt: "2026-07-01T10:00:00Z" }),
  ]);
  assert.equal(last?.occurredAt, "2026-09-10T10:00:00Z");
});

test("a proposal is not an observation, however recent it is", () => {
  // THE LOAD-BEARING ONE. A model candidate is a question waiting on a
  // clinician. Letting the newest one answer "last observed" would report a
  // suggestion as evidence, on the screen whose whole structure exists to keep
  // the four evidence classes apart.
  const last = lastAccepted([
    obs({ occurredAt: "2026-09-17T10:00:00Z", status: "proposed", evidenceClass: "model_candidate" }),
    obs({ occurredAt: "2026-06-02T10:00:00Z" }),
  ]);
  assert.equal(last?.occurredAt, "2026-06-02T10:00:00Z",
    "a proposed observation was read as the last observation");
});

test("a rejected observation is not the last observation either", () => {
  const last = lastAccepted([
    obs({ occurredAt: "2026-09-17T10:00:00Z", status: "rejected" }),
    obs({ occurredAt: "2026-06-02T10:00:00Z" }),
  ]);
  assert.equal(last?.occurredAt, "2026-06-02T10:00:00Z");
});

test("the observation line carries the age, the date and where it came from", () => {
  const line = observationLine(
    obs({ occurredAt: "2026-09-11T10:00:00Z", observedLevel: 0, evidenceClass: "patient_reported" }),
    AS_OF
  );
  assert.match(line, /7 days ago/);
  assert.match(line, /2026-09-11/);
  assert.match(line, /They told us/,
    "the source class is missing, so a patient's report and a clinician's observation read alike");
});

test("today and yesterday are said, not counted", () => {
  assert.match(observationLine(obs({ occurredAt: "2026-09-18T08:00:00Z" }), AS_OF), /today/);
  assert.match(observationLine(obs({ occurredAt: "2026-09-17T08:00:00Z" }), AS_OF), /yesterday/);
});

test("nothing recorded reads as nothing recorded, not as no progress", () => {
  const line = observationLine(null, AS_OF);
  assert.match(line, /Nothing has been recorded against this goal yet\./);
  assert.doesNotMatch(line.toLowerCase(), /progress|fail|behind/);
});

// ---------------------------------------------------------------------------
// The next review, including the absence of one
// ---------------------------------------------------------------------------

test("an unset review date is an absence, never a lapse", () => {
  const r = reviewStanding(null, AS_OF);
  assert.equal(r.state, "unset");
  assert.match(r.said, /No review date has been set/);
  assert.doesNotMatch(r.said.toLowerCase(), /overdue|late|due/,
    "a goal nobody set a date on is reported as late for a date nobody set");
});

test("a future date says how long there is", () => {
  const r = reviewStanding("2026-10-02", AS_OF);
  assert.equal(r.state, "scheduled");
  assert.equal(r.daysUntil, 14);
  assert.match(r.said, /in 14 days, on 2026-10-02/);
});

test("a date that has passed says how long ago, and by how much", () => {
  const r = reviewStanding("2026-08-19", AS_OF);
  assert.equal(r.state, "overdue");
  assert.equal(r.daysUntil, -30);
  assert.match(r.said, /due 30 days ago, on 2026-08-19/);
});

test("today is today", () => {
  const r = reviewStanding("2026-09-18", AS_OF);
  assert.equal(r.state, "today");
  assert.match(r.said, /Due for review today/);
});

test("one day is never 1 days, in either direction", () => {
  assert.match(reviewStanding("2026-09-19", AS_OF).said, /in 1 day,/);
  assert.match(reviewStanding("2026-09-17", AS_OF).said, /1 day ago/);
  assert.doesNotMatch(reviewStanding("2026-09-19", AS_OF).said, /1 days/);
  assert.doesNotMatch(reviewStanding("2026-09-17", AS_OF).said, /1 days/);
});

// ---------------------------------------------------------------------------
// On the screen
// ---------------------------------------------------------------------------

test("all three rows render, including the ones with nothing in them", () => {
  // A row that hides when empty teaches a reader that its absence means "not
  // applicable", and the review row's whole job is to make an unset date
  // visible.
  const standing = goalStanding({ currentLevel: null, targetReviewDate: null }, RUNGS, [], AS_OF);
  const html = renderToStaticMarkup(
    <GoalStanding standing={standing} goalId="g1" personId="p1" />
  );
  const t = text(html);
  for (const label of ["Next step", "Last observed", "Next review"]) {
    assert.ok(t.includes(label), `the ${label} row is missing when there is nothing to put in it`);
  }
  assert.match(t, /Nothing has been recorded against this goal yet/);
  assert.match(t, /No review date has been set/);
});

test("the standing block is above the ladder, not below the evidence list", () => {
  const page = code(read("src/app/clinician/member/[id]/goals/page.tsx"));
  const standing = page.indexOf("<GoalStanding");
  const ladder = page.indexOf("The five steps");
  const evidence = page.indexOf(">Evidence<");
  assert.ok(standing > 0, "the goals page does not render the standing block");
  assert.ok(standing < ladder, "the standing block sits below the ladder it summarises");
  assert.ok(standing < evidence, "the standing block sits below the evidence list");
});

test("the review date has a way in, because a field nothing can set is not a feature", () => {
  // The defect underneath this one: the column existed, `createGoal` took it,
  // and no form on any screen offered it. The screen would have reported
  // "no review date has been set" for every goal in the product, for ever.
  const form = code(read("src/components/clinical/GoalLadderForm.tsx"));
  assert.match(form, /name="targetReviewDate"/, "a new goal cannot be given a review date");
  assert.match(form, /export function SetReviewDate/, "an existing goal's review date cannot be changed");
  const actions = code(read("src/lib/clinical/goal-actions.ts"));
  assert.match(actions, /setGoalReviewDateAction/);
  assert.match(actions, /targetReviewDate,/,
    "the create action drops the review date the form collects");
});

test("the empty state offers goal creation and does not imply failure", () => {
  const page = read("src/app/clinician/member/[id]/goals/page.tsx");
  const empty = page.slice(page.indexOf("No goals yet"), page.indexOf("No goals yet") + 600);
  assert.match(empty, /Nothing has been set with this person/);
  for (const word of ["fail", "behind", "missing", "should have", "overdue"]) {
    assert.doesNotMatch(empty.toLowerCase(), new RegExp(word),
      `the empty state says "${word}", which reads as a judgement about the person`);
  }
  // And the form is above it rather than behind the empty state, so the way to
  // fix "there is nothing here" is on the screen already.
  assert.ok(page.indexOf("<NewGoalForm") < page.indexOf("No goals yet"));
});

test("every date on the goals panel is written the same way", () => {
  // The evidence rows used toLocaleDateString, which renders on the SERVER and
  // so carried the server's locale rather than the reader's — three lines under
  // "on 2026-09-11", which is the same kind of fact written two ways.
  const page = code(read("src/app/clinician/member/[id]/goals/page.tsx"));
  assert.doesNotMatch(page, /toLocaleDateString/,
    "a date on this screen is formatted by the server's locale");
});
