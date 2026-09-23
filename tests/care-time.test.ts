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
// AND `adjust_plan_link` IS STILL UNWRITTEN, deliberately. There is no plan
// link in this product — no model, no screen, no column — so building it would
// mean inventing what one IS, which is a product decision rather than an
// implementation. That is recorded rather than quietly skipped.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";

import { CARE_ACTIONS, PRODUCT_WRITTEN_CARE_ACTIONS } from "../src/lib/clinical/attention-vocabulary";
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
  // produce. Three actions join the written set today; the rule is unchanged.
  for (const a of ["record_thought", "open_session_prep", "review_trajectory"] as const) {
    assert.ok(
      PRODUCT_WRITTEN_CARE_ACTIONS.includes(a),
      `${a} is written by the product and not declared, so the seed is still barred from it`,
    );
  }
});

test("adjust_plan_link is still unwritten, and that is recorded", () => {
  // NOT AN OVERSIGHT. There is no plan link in this product — no model, no
  // screen, no column — so building it would mean inventing what one IS, which
  // is a product decision rather than an implementation. Filing it as done
  // would be the register carrying a claim nobody can check.
  assert.ok(
    !PRODUCT_WRITTEN_CARE_ACTIONS.includes("adjust_plan_link"),
    "adjust_plan_link is declared as written by the product, which would let the seed fabricate it",
  );
  const register = fs.readFileSync("src/lib/governance/work-register.ts", "utf8");
  assert.match(register, /plan link/i, "the register does not say why the fourth action is unbuilt");
});

test("the contact caveat appears only where there is a contact attempt", () => {
  // A CAVEAT IN THE WRONG PLACE IS WORSE THAN NONE. "An attempt, recorded by
  // the clinician who made it — not proof that anybody was reached" was
  // rendered above EVERY entry, which was true while every entry was a contact
  // attempt. Three actions joined the ledger on 23 September and it started
  // sitting above "Trajectory read", telling a clinician something false about
  // a row it does not describe — and teaching them that the caveats on this
  // screen are decoration.
  const src = fs.readFileSync("src/components/clinical/CareHistoryLedger.tsx", "utf8");
  const at = src.indexOf("CONTACT_MEANING}");
  assert.ok(at > 0, "the ledger no longer says what a contact attempt does not prove");
  const guard = src.slice(Math.max(0, at - 260), at);
  assert.match(
    guard, /entries\.some\(\(e\) => e\.action === "contact"\)/,
    "the contact caveat is rendered over every entry again, including ones it does not describe",
  );
});
