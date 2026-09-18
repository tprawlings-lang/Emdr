import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import {
  planReviewStanding, PLAN_REVIEW_SUBJECT, PLAN_REVIEW_MEANS,
  type PlanReviewRecord,
} from "../src/lib/clinical/plan-review";
import { PlanReviewAction } from "../src/components/clinical/PlanReviewAction";

// Care plan (17 September handoff, P4).
//
//   "Place the permitted review action beside the plan. User does not hunt
//   through the full record."
//
// The screen ended with "approve or correct it on the full record, where the
// action is audited" — the hunt, written down. And it pointed at the wrong
// control: the approval on the record page is about the generated SUMMARY, a
// different artefact with different evidence under it, so a clinician who
// followed the instruction would have attested to something they were not
// looking at.

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const code = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ")
   .replace(/^\s*\/\/.*$/gm, " ");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const review = (over: Partial<PlanReviewRecord> = {}): PlanReviewRecord => ({
  eventId: "e1", at: "2026-09-18T10:00:00Z", clinicianId: "clin-1",
  note: null, planVersion: "2026-03-03 10:00:00", ...over,
});

// ---------------------------------------------------------------------------
// Where a review stands against the plan on screen
// ---------------------------------------------------------------------------

test("a plan nobody has read says so, and is not called unapproved", () => {
  // A plan produced by fixed rules is in force whether or not anybody has
  // signed anything. "Not approved" would describe it as waiting on a
  // signature it does not need.
  const s = planReviewStanding(null, "2026-03-03 10:00:00");
  assert.match(s.said, /Nobody has recorded reading this plan/);
  assert.doesNotMatch(s.said.toLowerCase(), /not approved|unapproved|pending/);
});

test("a review of the version on screen is current", () => {
  const s = planReviewStanding(review(), "2026-03-03 10:00:00");
  assert.equal(s.currency?.state, "current");
  assert.match(s.said, /Read and accepted on 2026-09-18, against this version/);
});

test("a plan regenerated after the review makes it out of date", () => {
  // THE LOAD-BEARING ONE. The review stays true about the plan it saw; it has
  // stopped describing the one on screen, and inheriting it silently is how a
  // clinician comes to believe somebody has read something nobody has read.
  const s = planReviewStanding(review(), "2026-09-10 09:00:00");
  assert.equal(s.currency?.state, "out_of_date");
  assert.match(s.said, /against an earlier version/);
  assert.match(s.said, /regenerated since/);
});

test("a review with no recorded version is unknown, not current", () => {
  const s = planReviewStanding(review({ planVersion: null }), "2026-03-03 10:00:00");
  assert.equal(s.currency?.state, "unknown");
  assert.match(s.said, /not recorded/);
  assert.doesNotMatch(s.said, /against this version/);
});

// ---------------------------------------------------------------------------
// What the action is, and is not
// ---------------------------------------------------------------------------

test("what the review does not touch is stated beside it, not inferred", () => {
  const t = text(renderToStaticMarkup(
    <PlanReviewAction
      personId="p1" planId="plan-1" planVersion="2026-03-03 10:00:00"
      standing={planReviewStanding(null, "2026-03-03 10:00:00")}
    />
  ));
  assert.match(t, /does not change the plan/);
  assert.match(t, /does not open or close anything/);
  assert.match(t, /does not reach the member/);
  assert.equal(PLAN_REVIEW_MEANS.doesNot.length, 3);
});

test("the control carries the plan's version, so a later plan does not inherit it", () => {
  const html = renderToStaticMarkup(
    <PlanReviewAction
      personId="p1" planId="plan-1" planVersion="2026-03-03 10:00:00"
      standing={planReviewStanding(null, "2026-03-03 10:00:00")}
    />
  );
  assert.match(html, /name="planVersion" value="2026-03-03 10:00:00"/);
  assert.match(html, /name="planId" value="plan-1"/);
});

test("a plan already read offers reading it again rather than approving twice", () => {
  const t = text(renderToStaticMarkup(
    <PlanReviewAction
      personId="p1" planId="plan-1" planVersion="2026-03-03 10:00:00"
      standing={planReviewStanding(review(), "2026-03-03 10:00:00")}
    />
  ));
  assert.match(t, /Read it again/);
  assert.doesNotMatch(t, /I have read this plan/);
});

// ---------------------------------------------------------------------------
// On the screen, and off the other one
// ---------------------------------------------------------------------------

test("the plan page no longer sends the reader to the full record to act", () => {
  const page = code(read("src/app/clinician/member/[id]/plan/page.tsx"));
  assert.doesNotMatch(page, /Approve or correct it on the full record/,
    "the plan still tells the reader to go somewhere else to act on it");
  assert.match(page, /<PlanReviewAction/);
  assert.match(page, /planVersion=\{planRow\.created_at\}/);
});

test("the plan review is its own subject, not the summary's", () => {
  // Following the old instruction would have approved the generated summary,
  // which rests on different evidence. Two subjects, two records.
  assert.equal(PLAN_REVIEW_SUBJECT, "program_plan");
  const actions = code(read("src/lib/clinical/actions.ts"));
  assert.match(actions, /subject: PLAN_REVIEW_SUBJECT/);
  const summaryAction = actions.slice(
    actions.indexOf("export async function approveSummaryAction"),
    actions.indexOf("export async function reviewPlanAction"),
  );
  assert.match(summaryAction, /subject: "summary"/,
    "the summary approval changed subject, so the two records are now the same one");
});

test("the approval records which version it was made against", () => {
  // Without it the currency policy can only answer "unknown", which is honest
  // and useless — and the handoff's completion semantics ask for the reviewed
  // evidence version by name.
  const review = code(read("src/lib/clinical/review.ts"));
  assert.match(review, /evidenceAt: args\.evidenceAt \?\? null/,
    "the review event does not carry the version of what was reviewed");
  const actions = code(read("src/lib/clinical/actions.ts"));
  assert.match(actions, /evidenceAt: planVersion/);
});
