// The questions waiting on a person.
//
// NEITHER EXISTING REGISTER COULD SAY THIS. The work register has `proposed`
// and `held`; the failure register has `gap`. All three describe the state of
// the WORK, and none says "this is not moving because nobody has answered a
// question" — so a decision waiting on somebody looked exactly like work
// nobody had got to, and that difference is the only thing telling you whether
// building harder would help.
//
// THE FAILURE MODE OF A LIST OF OPEN QUESTIONS IS THAT IT OUTLIVES THEM. A
// question stays open after it was answered in a meeting; a "blocks" pointer
// keeps naming work that shipped; a decision is taken and its rationale is
// nowhere near the code it explains. Every check below is one of those.

import { strict as assert } from "node:assert";
import test from "node:test";

import {
  DECISION_REGISTER, OPEN_DECISIONS, decisionSummary, AUDIENCE_LABEL,
} from "../src/lib/governance/decision-register";
import { WORK_REGISTER } from "../src/lib/governance/work-register";
import { FAILURE_REGISTER } from "../src/lib/governance/failure-register";
import { RELEASE_DEFINITION } from "../src/lib/review/release-definition";

const known = new Set<string>([
  ...WORK_REGISTER.map((e) => e.id),
  ...FAILURE_REGISTER.map((e) => e.id),
  ...RELEASE_DEFINITION.map((e) => e.id),
]);

test("everything a decision claims to block exists", () => {
  // A pointer at work that was renamed or never filed is how a list of open
  // questions stops being checkable — and this one is meant to be the record
  // somebody acts on.
  for (const d of DECISION_REGISTER) {
    for (const id of d.blocks) {
      assert.ok(known.has(id), `${d.id} blocks "${id}", which is in no register`);
    }
  }
});

test("an open decision does not block work that is already finished", () => {
  // THE WAY THIS LIST GOES STALE. Somebody answers a question, the work lands,
  // and the question sits here for weeks looking like a blocker — which costs
  // exactly the thing the registers exist to prevent: a reader trusting a
  // paragraph that was true once.
  const finished = new Set(
    WORK_REGISTER.filter((e) => e.state === "reachable" || e.state === "tested").map((e) => e.id)
  );
  for (const d of OPEN_DECISIONS) {
    for (const id of d.blocks) {
      assert.ok(
        !finished.has(id),
        `${d.id} is open and blocks ${id}, which is built — either the question was answered or it never blocked it`,
      );
    }
  }
});

test("an answered decision says what was decided and when", () => {
  // A decision that vanishes when it is taken leaves the code carrying a
  // rationale nobody can find, and the next person re-opens it.
  for (const d of DECISION_REGISTER.filter((x) => x.state === "answered")) {
    assert.ok(d.answer, `${d.id} is answered and records no answer`);
    assert.match(d.answer!.on, /^\d{4}-\d{2}-\d{2}$/, `${d.id}'s answer has no usable date`);
    assert.ok(d.answer!.decided.length > 40, `${d.id}'s answer is too short to act on`);
  }
});

test("every decision says what happens while nobody has answered", () => {
  // An unanswered question ALWAYS has a current behaviour, and leaving it
  // unsaid is how a default becomes a decision nobody took. This is the field
  // most often missing from a list of open questions and the one that tells a
  // reader whether the wait is costing anything.
  for (const d of DECISION_REGISTER) {
    assert.ok(d.meanwhile.length > 40, `${d.id} does not say what happens meanwhile`);
  }
});

test("a question is asked in words somebody outside the codebase can answer", () => {
  // "Should CONTACT_LEDGER_ACTIONS include record_thought" is not a question a
  // clinical lead can answer. The same question, askable, is what makes this a
  // register rather than a backlog.
  for (const d of DECISION_REGISTER) {
    assert.ok(d.question.includes("?"), `${d.id} is not phrased as a question`);
    assert.ok(d.question.length > 60, `${d.id}'s question is too terse to answer cold`);
    // A symbol name with no spaces around it, or a file path, means the
    // question was written for whoever wrote the code.
    assert.ok(
      !/\b\w+\.(ts|tsx)\b/.test(d.question),
      `${d.id} names a source file, so it is a question for the author rather than the decider`,
    );
  }
});

test("ids are unique and every audience has a label", () => {
  const ids = DECISION_REGISTER.map((d) => d.id);
  assert.deepEqual([...new Set(ids)].sort(), [...ids].sort(), "two decisions share an id");
  for (const d of DECISION_REGISTER) {
    assert.ok(AUDIENCE_LABEL[d.audience], `${d.audience} has no label, so the screen shows a key`);
  }
});

test("the summary counts what it says it counts", () => {
  const s = decisionSummary();
  assert.equal(s.open, OPEN_DECISIONS.length);
  assert.equal(s.open + s.answered, DECISION_REGISTER.length);
  // A decision blocking nothing is still worth asking and is counted
  // separately rather than hidden — what it must not do is pad a count of
  // things that are stuck.
  assert.equal(s.blocking, OPEN_DECISIONS.filter((d) => d.blocks.length > 0).length);
  assert.ok(s.blocking <= s.open);
  assert.equal(
    Object.values(s.byAudience).reduce((a, b) => a + b, 0), s.open,
    "an open decision belongs to no audience, so nobody is asked",
  );
});
