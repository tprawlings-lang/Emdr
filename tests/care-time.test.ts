// The four care actions nothing wrote (decided 23 September: build them).
//
// §13's vocabulary names eight things a clinician can be recorded as having
// done between visits. Four had no writer anywhere — `record_thought`,
// `open_session_prep`, `review_trajectory`, `adjust_plan_link` — and two of
// those would have shown on no screen even if something had written one,
// because the ledger's inclusion list was written by hand and missed them.
//
// THE LIST AND ITS OWN DOCSTRING DISAGREED, which is the kind of fault a reader
// has no way to spot: the comment said "everything that is not a review" and
// the four names under it were not that. It is derived now, so a ninth action
// joins by existing.
//
// AND `adjust_plan_link` NEEDED THE FEATURE BEFORE THE WRITER (24 September).
// There was no plan link in this product — no model, no screen, no column — so
// nothing could be written until somebody decided what one IS. It is the
// connection between a piece of assigned support and the goal it is meant to
// move: the gap it closes was visible in the plan itself, which showed a person
// what they said they wanted and, underneath, a list of homework, with nothing
// joining the two.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";

import {
  CARE_ACTIONS, PRODUCT_WRITTEN_CARE_ACTIONS, UNWRITTEN_CARE_ACTIONS,
} from "../src/lib/clinical/attention-vocabulary";
import {
  CONTACT_LEDGER_ACTIONS, CARE_ACTION_LABEL, careHistory,
} from "../src/lib/clinical/care-history";
import type { CareActionRecord } from "../src/lib/clinical/attention-vocabulary";

function record(over: Partial<CareActionRecord> & { action: CareActionRecord["action"] }): CareActionRecord {
  return {
    id: `r-${over.action}`, personId: "p1", clinicianPersonId: "c1", signalId: null,
    note: null, startedAt: null, completedAt: "2026-09-23 09:00:00", durationSeconds: null,
    outcomeState: null, sourceSurface: "person_record", supersedesId: null,
    correctionReason: null, ...over,
  } as CareActionRecord;
}

test("the ledger shows everything that is not a review", () => {
  // The docstring always said this; the hand-written list did not, and three
  // actions fell through the gap between them.
  assert.deepEqual(
    [...CONTACT_LEDGER_ACTIONS].sort(),
    CARE_ACTIONS.filter((a) => a !== "review").sort(),
    "the ledger's list disagrees with the sentence above it again",
  );
  assert.ok(!CONTACT_LEDGER_ACTIONS.includes("review"), "a review reached the contact ledger");
});

test("each of the three newly written actions reaches the ledger with a label", () => {
  for (const action of ["record_thought", "open_session_prep", "review_trajectory"] as const) {
    const entries = careHistory([record({ action })]);
    assert.equal(entries.length, 1, `${action} is recorded and shows on no screen`);
    assert.equal(entries[0].label, CARE_ACTION_LABEL[action]);
    assert.ok(entries[0].label.length > 0, `${action} renders with an empty label`);
  }
});

test("a thought captured about somebody is care on their record", () => {
  // `record_thought` was in the vocabulary from the start and nothing wrote
  // one, so a thought recorded about a person appeared in the thoughts
  // feature's own ledger and nowhere on their record. It needed no new control:
  // capturing a thought is already a deliberate act by a named clinician at a
  // known time.
  const src = fs.readFileSync("src/lib/clinical/thought-store.ts", "utf8");
  assert.match(src, /action: "record_thought"/,
    "finishing a capture no longer records care on the person's record");
  // AND IT MUST NOT COST THE THOUGHT. The capture is already committed by the
  // time this runs; a care row that will not write is worth less than the
  // recording it describes.
  const at = src.indexOf('action: "record_thought"');
  assert.match(src.slice(Math.max(0, at - 600), at), /try \{/,
    "a failed care row now throws away a captured thought");
});

test("care time is recorded by a press, never by a page rendering", () => {
  // THE WHOLE DESIGN, AND THE REASON IT IS A BUTTON. Both actions are named
  // after opening a screen, which makes writing the row on render the obvious
  // build. Next.js prefetches a route when a link is hovered, so that version
  // records "this clinician reviewed the trajectory" for a link nobody clicked
  // — a clinical fact invented by a mouse moving. A render is also a GET: a
  // reload, a back button or a crawler each add a row.
  for (const page of [
    "src/app/clinician/member/[id]/trajectory/page.tsx",
    "src/app/clinician/member/[id]/page.tsx",
  ]) {
    const src = fs.readFileSync(page, "utf8");
    assert.ok(
      !/recordCareAction\s*\(/.test(src),
      `${page} records a care action while rendering, so a prefetched link writes one`,
    );
    assert.match(src, /RecordCareTime/, `${page} offers no way to record the care time it is about`);
  }
  // And the action itself refuses anything it is not for.
  const actions = fs.readFileSync("src/lib/clinical/assignment-actions.ts", "utf8");
  assert.match(actions, /RECORDABLE/, "the care-time action accepts any action name");
  assert.ok(
    !/RECORDABLE[^)]*"contact"/.test(actions),
    "the deliberate control can write a contact attempt, which has its own command and rules",
  );
});

test("the seed still may not write an action the product does not", () => {
  // The guard that caught 249 fabricated rows of a shape no clinician could
  // produce. Four actions have joined the written set; the rule is unchanged.
  for (const a of [
    "record_thought", "open_session_prep", "review_trajectory", "adjust_plan_link",
  ] as const) {
    assert.ok(
      PRODUCT_WRITTEN_CARE_ACTIONS.includes(a),
      `${a} is written by the product and not declared, so the seed is still barred from it`,
    );
  }
});

test("every word in the vocabulary now has something that writes it", () => {
  // THE LIST STAYS EMPTY OR THE NEXT ONE IS DECLARED. A word added to §13's
  // closed vocabulary with no writer reads exactly like a built feature to
  // everybody downstream — which is how 249 fabricated rows got into the
  // demonstration. This fails the moment a ninth action is named and left
  // without one, rather than when somebody notices.
  assert.deepEqual(
    [...UNWRITTEN_CARE_ACTIONS],
    [],
    "a care action is in the vocabulary with nothing in the product writing it",
  );
  // AND THE CONSTANT IS STILL THE COMPLEMENT, not a list somebody emptied by
  // hand. An empty array assigned directly would pass the assertion above
  // while hiding exactly the gap it exists to show.
  assert.deepEqual(
    [...UNWRITTEN_CARE_ACTIONS],
    CARE_ACTIONS.filter((a) => !PRODUCT_WRITTEN_CARE_ACTIONS.includes(a)),
    "UNWRITTEN_CARE_ACTIONS is no longer derived from what the product writes",
  );
});

test("the plan link is a real link, not a word that satisfies the list", () => {
  // THE FAILURE THIS GUARDS is the cheapest way to make the test above pass:
  // add the string to a file and declare the action written. A plan link that
  // is only a care-ledger row would record that a clinician adjusted something
  // the product cannot show anybody.
  const domain = fs.readFileSync("src/lib/clinical/assigned-support.ts", "utf8");
  assert.match(domain, /export async function linkAssignmentToGoal/,
    "nothing in the domain sets a plan link");
  assert.match(domain, /goal_id/, "the link is not stored on the assignment");

  const schema = fs.readFileSync("src/lib/db.ts", "utf8");
  assert.match(schema, /ensureColumn\(db, "support_assignments", "goal_id"/,
    "a database created before the column exists never gets it");

  // AND IT REACHES BOTH PEOPLE. The between-visit plan's whole rule is that a
  // field is one thing with two renderings; a link the clinician could see and
  // the person could not would be the drift that module exists to prevent.
  const plan = fs.readFileSync("src/lib/clinical/between-visit-plan.ts", "utf8");
  assert.match(plan, /towards/, "the assembled plan does not carry the link");
  const panel = fs.readFileSync("src/components/member/TodayWorkPanel.tsx", "utf8");
  assert.match(panel, /data-fact="towards"/, "the person is never shown what their work is towards");
});

// The contact caveat's placement is checked by rendering the ledger, in
// tests/care-history-ledger.test.tsx. It was checked HERE by a regular
// expression over the component's source, and that is why the mixed-ledger case
// survived: the pattern asserted the shape of the condition rather than what a
// reader sees, so it passed over a caveat that still captioned rows it does not
// describe.
