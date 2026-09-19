// Counting the work nobody has claimed.
//
// The failure register's scenario is "work nobody owns builds up UNNOTICED",
// and the noticing is the part a queue cannot do by itself: ownership is on
// every row, so a clinician can read twenty owners and still not know that nine
// of them say nobody.
//
// WHAT THIS MUST NOT DO is escalate. Who unclaimed work falls to, and after how
// long, is an operational decision about how a service runs. So the tests below
// check for the ABSENCE of a threshold as carefully as they check the count: a
// later change that adds "overdue for assignment" would be this codebase
// choosing a policy nobody approved, and it would pass every arithmetic test
// here without one that looks for it.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";

import {
  ownershipDebt, ownershipDebtStatement, OWNERSHIP_DEBT_LIMIT,
} from "../src/lib/clinical/ownership-debt";
import type { WorkItem } from "../src/lib/clinical/work-queue";

const NOW = new Date("2026-09-19T10:00:00Z");

function item(over: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    group: "needs_action", band: "standard",
    personId: over.personId ?? `p-${over.id}`, personName: over.personName ?? "A Person",
    reason: "because", detail: null, resolvedAt: null, change: null,
    evidenceAt: over.evidenceAt ?? "2026-09-18 10:00:00",
    ownerId: over.ownerId ?? null, ownerName: over.ownerName ?? null,
    dueAt: null, overdue: false, eventCount: 1, action: "review", actionable: true,
    blockedReason: null, safetyAuthority: false, signalId: null,
    ...over,
  } as WorkItem;
}

test("nothing unclaimed reads as nothing unclaimed, not as an empty queue", () => {
  const d = ownershipDebt([item({ id: "a", ownerName: "Dr Who" })], NOW);
  assert.equal(d.unowned, 0);
  assert.equal(d.oldestWaitDays, null, "an age was invented for work that has an owner");
  assert.match(ownershipDebtStatement(d), /has somebody recorded/);

  // AND AN EMPTY QUEUE IS A THIRD THING. "0 of 0 have no owner" reads as a
  // fault on a clear day; the two states say different sentences.
  assert.match(ownershipDebtStatement(ownershipDebt([], NOW)), /nothing on the queue to own/i);
});

test("the count follows the NAME, because that is what the reader sees", () => {
  // THE BUG THIS EXISTS FOR, ONE LAYER UP. A row whose owner id resolves to no
  // name renders as Unassigned — which is exactly how an assignment could
  // succeed and stay invisible. A count keyed on the id would have read zero
  // debt while every row on the screen said Unassigned, and the panel would
  // have been a second place telling the clinician the opposite of the list
  // underneath it.
  const d = ownershipDebt([item({ id: "a", ownerId: "someone", ownerName: null })], NOW);
  assert.equal(d.unowned, 1, "a row the screen shows as unassigned was counted as owned");
});

test("two rows for one person are two items and one person", () => {
  // Counting rows alone reports a busy person as a staffing gap.
  const d = ownershipDebt([
    item({ id: "a", personId: "p1" }),
    item({ id: "b", personId: "p1" }),
    item({ id: "c", personId: "p2", ownerName: "Dr Who" }),
  ], NOW);
  assert.equal(d.total, 3);
  assert.equal(d.unowned, 2);
  assert.equal(d.peopleUnowned, 1);
  assert.match(ownershipDebtStatement(d), /2 items of 3 have no owner, across 1 person\./);
});

test("the oldest is the oldest unclaimed one, not the oldest row", () => {
  const d = ownershipDebt([
    item({ id: "old-but-owned", ownerName: "Dr Who", evidenceAt: "2026-01-01 10:00:00" }),
    item({ id: "unclaimed", personName: "Chiara Fontaine", evidenceAt: "2026-09-09 10:00:00" }),
  ], NOW);
  assert.equal(d.oldestWaitDays, 10);
  assert.equal(d.oldestPersonName, "Chiara Fontaine", "the age does not lead anywhere");
});

test("both timestamp spellings measure the same age", () => {
  // The database stores "YYYY-MM-DD HH:MM:SS" and callers pass ISO. A
  // comparison spanning the two has already sorted a same-day row as older than
  // it was, in this codebase, in a way that leaked future data — so the parser
  // is the queue's own rather than a ninth copy written for this count.
  const spaced = ownershipDebt([item({ id: "a", evidenceAt: "2026-09-09 10:00:00" })], NOW);
  const iso = ownershipDebt([item({ id: "a", evidenceAt: "2026-09-09T10:00:00.000Z" })], NOW);
  assert.equal(spaced.oldestWaitDays, iso.oldestWaitDays);
});

test("an age is never negative, however the clock is set", () => {
  // The demo clock moves backwards on purpose. "-3 days waiting" is a number
  // nobody can act on, and it would appear on the busiest clinician screen.
  const d = ownershipDebt([item({ id: "a", evidenceAt: "2026-12-25 10:00:00" })], NOW);
  assert.equal(d.oldestWaitDays, 0);
});

test("nothing here escalates, and the screen says so", () => {
  // THE DECISION THIS MODULE REFUSES TO TAKE. A threshold would be this
  // codebase picking an operational policy — who unclaimed work falls to, and
  // after how long — that the failure register explicitly leaves open.
  // SCANNED OVER LOGIC, NOT PROSE. The first version of this read the file
  // whole and failed on `OWNERSHIP_DEBT_LIMIT` — the sentence that says nothing
  // escalates, reported as a rule that escalates. A guard that cannot tell the
  // explanation from the thing explained would be paid off by deleting the
  // explanation, which is the opposite of what it is for. So comments and
  // string literals come out first and what is left is code.
  const code = fs.readFileSync("src/lib/clinical/ownership-debt.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
  for (const word of ["escalat", "overdue", "breach", "threshold", "_DAYS ="]) {
    assert.ok(
      !code.toLowerCase().includes(word.toLowerCase()),
      `the debt module grew a "${word}" rule nobody approved`,
    );
  }
  // And the absence is stated where a reader is, not only in a comment.
  assert.match(OWNERSHIP_DEBT_LIMIT, /Nothing escalates/);
  assert.match(OWNERSHIP_DEBT_LIMIT, /no rule/i);

  const view = fs.readFileSync("src/components/experience/ClinicianHomeView.tsx", "utf8");
  assert.ok(view.includes("OWNERSHIP_DEBT_LIMIT"),
    "the panel renders the count without the sentence saying nothing chases it");
});
