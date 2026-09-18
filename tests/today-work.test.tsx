import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import {
  todayWorkState, assignedPresentation, PENDING_WRITE_TRACKED, shareRuleInWords,
  TODAY_WORK_CONTRACT, TODAY_WORK_STATES, TODAY_WORK_ORDER,
  type TodayWorkInputs,
} from "../src/lib/member/today-work";
import { TodayWorkPanel } from "../src/components/member/TodayWorkPanel";

// The Today contract (17 September handoff, P5).
//
// The member's day already had a state — open, narrow, stabilizing, paused,
// crisis, interrupted, service_unavailable — answering "how much can you do
// today". The handoff asks a different question on a different axis: what is
// the next thing, where did it come from, and what does doing it share.
//
// THE TWO THAT MATTERED MOST WERE INDISTINGUISHABLE. A module a clinician asked
// for and a module the day shape happened to surface were the same card, in the
// same place, with the same words — so the person could not tell whether
// somebody had asked them to do this. Four of the five facts the handoff
// requires beside an assigned item are about trust rather than the activity:
// who asked, why, what it shares, when it stops mattering.

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const code = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ")
   .replace(/^\s*\/\/.*$/gm, " ");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const inputs = (over: Partial<TodayWorkInputs> = {}): TodayWorkInputs => ({
  restricted: false, pendingWrite: false, missingSources: [],
  assignedCount: 0, checkinDue: false, hasSuggestion: false, completedToday: false,
  ...over,
});

// ---------------------------------------------------------------------------
// The eight states, and which one wins
// ---------------------------------------------------------------------------

test("the eight states the handoff names are the eight that exist", () => {
  assert.deepEqual([...TODAY_WORK_STATES], [
    "restricted", "write_uncertain", "partial_failure", "assigned_due",
    "checkin_due", "suggested", "recently_completed", "no_task",
  ]);
  assert.equal(Object.keys(TODAY_WORK_CONTRACT).length, 8);
});

test("a restriction outranks everything, including an assignment", () => {
  // THE LOAD-BEARING ORDER. A restriction is the truth about today; under an
  // assignment it reads as an aside and the person finds out by being refused.
  assert.equal(
    todayWorkState(inputs({ restricted: true, assignedCount: 2, checkinDue: true })),
    "restricted",
  );
});

test("an uncertain write outranks everything below it", () => {
  assert.equal(
    todayWorkState(inputs({ pendingWrite: true, assignedCount: 1, missingSources: ["x"] })),
    "write_uncertain",
  );
});

test("a missing source outranks an assignment", () => {
  // An assignment shown over an unread source may already have been withdrawn.
  assert.equal(
    todayWorkState(inputs({ missingSources: ["assignments"], assignedCount: 1 })),
    "partial_failure",
  );
});

test("an assignment outranks a check-in, a suggestion and a completion", () => {
  assert.equal(
    todayWorkState(inputs({ assignedCount: 1, checkinDue: true, hasSuggestion: true, completedToday: true })),
    "assigned_due",
  );
});

test("the check-in comes before what it decides", () => {
  assert.equal(todayWorkState(inputs({ checkinDue: true, hasSuggestion: true })), "checkin_due");
});

test("a suggestion beats an empty screen, and a completion beats nothing", () => {
  assert.equal(todayWorkState(inputs({ hasSuggestion: true, completedToday: true })), "suggested");
  assert.equal(todayWorkState(inputs({ completedToday: true })), "recently_completed");
  assert.equal(todayWorkState(inputs()), "no_task");
});

test("every state names exactly one action", () => {
  // "A page may expose secondary actions, but it should not present several
  // controls as equal next steps." That is a property of the state.
  for (const s of TODAY_WORK_STATES) {
    const c = TODAY_WORK_CONTRACT[s];
    assert.equal(typeof c.action, "string");
    assert.ok(c.action.length > 3, `${s} has no action`);
    assert.ok(c.outranks.length > 20, `${s} does not say why it outranks what follows`);
  }
});

test("the order is the contract's order, not a rendering convenience", () => {
  assert.deepEqual([...TODAY_WORK_ORDER], [...TODAY_WORK_STATES]);
});

// ---------------------------------------------------------------------------
// The state nothing can reach, said out loud
// ---------------------------------------------------------------------------

test("write_uncertain is in the contract and unreachable, and says so", () => {
  // Nothing in this build stores an unreconciled command. A state left out of
  // the model is a state nobody notices is missing; one modelled and silently
  // unreachable is worse. The flag is the single line to change.
  assert.equal(PENDING_WRITE_TRACKED, false);
  const page = code(read("src/app/app/today/page.tsx"));
  assert.match(page, /pendingWrite: PENDING_WRITE_TRACKED/,
    "the page invents a value for a state nothing produces");
});

// ---------------------------------------------------------------------------
// The five facts beside an assigned item
// ---------------------------------------------------------------------------

test("an assigned item carries who asked, why, how long, what it shares and until when", () => {
  const p = assignedPresentation({
    assignedByName: "Dr Vale",
    patientExplanation: "Ten minutes of the container practice before Thursday, when we will use it.",
    sharePolicy: "clinical-policy-2026-08-t1",
    expiresAt: "2026-10-02",
    minutes: 10,
  });
  assert.equal(p.source, "Dr Vale");
  assert.match(p.purpose, /container practice/);
  assert.equal(p.estimatedTime, "About 10 minutes");
  assert.match(p.sharingRule, /can see that you opened this/);
  assert.match(p.expiration, /until 2026-10-02/);
  assert.deepEqual(
    [...TODAY_WORK_CONTRACT.assigned_due.requires],
    ["care_team_source", "purpose", "estimated_time", "sharing_rule", "expiration"],
  );
});

test("an assignment with no end date does not claim to run for ever", () => {
  const p = assignedPresentation({
    assignedByName: null, patientExplanation: "x", sharePolicy: "y",
    expiresAt: null, minutes: null,
  });
  assert.match(p.expiration, /No end date was set/);
  assert.doesNotMatch(p.expiration.toLowerCase(), /never|indefinit|ongoing/);
  assert.equal(p.estimatedTime, "No estimate recorded");
  // A missing name is not "your clinician": a role is not a source.
  assert.match(p.source, /Somebody on your care team/);
});

// ---------------------------------------------------------------------------
// On the screen
// ---------------------------------------------------------------------------

test("the assigned panel renders all five required facts", () => {
  const html = renderToStaticMarkup(
    <TodayWorkPanel
      state="assigned_due"
      supportHref="/app/ground"
      assigned={{
        label: "Containment and pause skills",
        href: "/app/session/containment",
        presentation: assignedPresentation({
          assignedByName: "Dr Vale",
          patientExplanation: "Ten minutes before Thursday.",
          sharePolicy: "They see that you opened it.",
          expiresAt: "2026-10-02",
          minutes: 8,
        }),
      }}
    />
  );
  for (const fact of TODAY_WORK_CONTRACT.assigned_due.requires) {
    assert.match(html, new RegExp(`data-fact="${fact}"`), `the panel does not render ${fact}`);
  }
  const t = text(html);
  assert.match(t, /Asked for by your care team/);
  assert.match(t, /Start assigned support/);
});

test("the assigned panel does not make it sound compulsory", () => {
  const t = text(renderToStaticMarkup(
    <TodayWorkPanel
      state="assigned_due" supportHref="/app/ground"
      assigned={{
        label: "x", href: "/y",
        presentation: assignedPresentation({
          assignedByName: "Dr Vale", patientExplanation: "p", sharePolicy: "s",
          expiresAt: null, minutes: null,
        }),
      }}
    />
  ));
  assert.match(t, /You can stop at any point/);
  for (const word of ["required", "must", "overdue", "you need to", "complete this"]) {
    assert.ok(!t.toLowerCase().includes(word), `the panel says "${word}" about an assignment`);
  }
});

test("a partial failure names what is unavailable and keeps support reachable", () => {
  const html = renderToStaticMarkup(
    <TodayWorkPanel
      state="partial_failure" supportHref="/app/ground"
      unavailable={["Your day could not be read."]}
    />
  );
  assert.match(html, /data-fact="what_is_unavailable"/);
  assert.match(html, /data-fact="safe_support_reachable"/);
  assert.match(html, /href="\/app\/ground"/);
  assert.match(text(html), /Use available support/);
});

test("the states the day view already carries render no second headline", () => {
  // Two primary actions on one screen is the thing the contract exists to
  // prevent, and the day view below already says what the day is.
  for (const state of ["checkin_due", "suggested", "recently_completed", "no_task", "restricted"] as const) {
    const html = renderToStaticMarkup(
      <TodayWorkPanel state={state} supportHref="/app/ground" />
    );
    assert.equal(html, "", `${state} renders a second primary action above the day`);
  }
});

test("the Today page computes the state and renders the panel above the day", () => {
  const page = code(read("src/app/app/today/page.tsx"));
  assert.match(page, /todayWorkState\(\{/);
  assert.match(page, /<TodayWorkPanel/);
  assert.ok(page.indexOf("<TodayWorkPanel") < page.indexOf("<MemberTodayView"),
    "the assignment sits below the day it was asked for on top of");
  // Only assignments that are still asking for something, and only the ones a
  // clinician assigned rather than offered.
  assert.match(page, /isLive\(a, now\) && a\.availability === "assigned"/);
});


// ---------------------------------------------------------------------------
// The sharing rule is a sentence, not a version
// ---------------------------------------------------------------------------

test("a policy version never reaches the member as the sharing rule", () => {
  // THE DEFECT THE RENDERED SCREEN SHOWED. Under the heading "What it shares"
  // the member's Today read "clinical-policy-2026-08-t1" — a policy identifier
  // where a person expected a sentence, and one the handoff rules out by name:
  // "the patient should not see ... projection versions, tenant terms".
  const said = shareRuleInWords("clinical-policy-2026-08-t1");
  assert.doesNotMatch(said, /clinical-policy|v\d|\bt1\b/,
    `the member reads a version string: "${said}"`);
  assert.match(said, /Your care team can see/);
});

test("an unrecorded rule says so rather than guessing a plausible one", () => {
  // Inventing what a record shares is the one mistake nobody can walk back
  // after somebody has acted on it.
  const said = shareRuleInWords("some-policy-nobody-mapped");
  assert.match(said, /does not have plain words/);
  assert.match(said, /care team can\s*\n?\s*tell you/);
  assert.doesNotMatch(said, /some-policy-nobody-mapped/);
});

test("the assignment still stores the version, because that is what binds", () => {
  // The stored field is right; only the rendering was wrong. A later policy
  // change has to be visible as a difference rather than applied backwards.
  const store = read("src/lib/clinical/assigned-support.ts");
  assert.match(store, /share_policy: policy\.version/,
    "the assignment no longer binds the sharing rule to a policy version");
});

test("the Care screen no longer says assigned support is unbuilt above the working panel", () => {
  // It said "because assigned support is not built", unconditionally, directly
  // above a working Assigned support panel with a working Assign control. True
  // when written; false from the day the feature landed.
  const page = code(read("src/app/clinician/member/[id]/care/page.tsx"));
  assert.doesNotMatch(page, /assigned support is not built/);
  assert.match(page, /assignments === 0/,
    "the missing-information line does not depend on whether anything is assigned");
});


test("one duration reaches the member, from the source every member surface reads", () => {
  // The assigned panel first quoted the module catalogue's durationLabel, which
  // put "15–20 min" beside the day card's "About 10 minutes" for the same
  // activity on the same screen. Two catalogues disagree about several modules;
  // which is right is a content decision, and until it is made every member
  // surface reads the same one of them.
  const page = code(read("src/app/app/today/page.tsx"));
  assert.match(page, /minutes: memberMinutes\(first\.supportId\)/,
    "the assigned panel quotes a different duration catalogue from the day below it");
  assert.doesNotMatch(page, /durationLabel/,
    "the member's Today reads the clinician-facing duration label");
});

test("the day does not re-offer the activity the assignment already offered", () => {
  // "Asked for by your care team" sat above a card offering the same thing as
  // "start wherever you like", with two start buttons — two controls as equal
  // next steps, and the weaker framing was the louder of the two.
  const page = code(read("src/app/app/today/page.tsx"));
  assert.match(page, /view\.recommended\?\.activityId === first\.supportId/);
  assert.match(page, /\{ \.\.\.view, recommended: null \}/);
});
