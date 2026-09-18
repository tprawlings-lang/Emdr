// Queue stability (17 September handoff, P3).
//
//   "Do not move a row beneath a pointer while an action is being taken."
//   "Revalidate consequential actions against current server state."
//
// THE CHECK EXISTED AND WAS DISABLED FOR THE LIFE OF THE FEATURE. `completeReview`
// compares the version the reader's page was built from against the one the
// server holds now, and returns `stale` rather than acknowledging on top of
// somebody else's decision. The queue passed `expectedVersion={null}` at both
// call sites, and the comparison reads `if (command.expectedVersion && …)` — so
// it short-circuited on every request ever made. Two clinicians could each
// complete a review of the same row and neither would be told.
//
// Nothing failed, which is the point: a guard that is never armed passes every
// test written about the code around it.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  signalRowVersion, alertRowVersion, CASELOAD_ROW_HAS_NO_VERSION,
} from "../src/lib/clinical/row-version";

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

// ---------------------------------------------------------------------------
// The version says what would make a decision wrong
// ---------------------------------------------------------------------------

test("a signal's version moves when its state or its evidence moves", () => {
  const base = { state: "open", evidenceAt: "2026-09-14 09:00:00" };
  const v = signalRowVersion(base);
  assert.notEqual(v, signalRowVersion({ ...base, state: "acknowledged" }),
    "somebody else acknowledged it and the version did not move");
  assert.notEqual(v, signalRowVersion({ ...base, evidenceAt: "2026-09-16 21:30:00" }),
    "new evidence arrived and the version did not move");
  assert.equal(v, signalRowVersion({ ...base }), "the same state hashes differently twice");
});

test("an alert row's version is the set of open alerts, in a stable order", () => {
  const a = alertRowVersion([{ id: "a1", status: "open" }, { id: "a2", status: "open" }]);
  const b = alertRowVersion([{ id: "a2", status: "open" }, { id: "a1", status: "open" }]);
  assert.equal(a, b, "the version depends on the order the rows came back in");

  assert.notEqual(a, alertRowVersion([{ id: "a1", status: "open" }]),
    "an alert was closed by somebody else and the version did not move");
  assert.notEqual(a, alertRowVersion([
    { id: "a1", status: "open" }, { id: "a2", status: "open" }, { id: "a3", status: "open" },
  ]), "an alert the reader has never seen was raised and the version did not move");
  assert.notEqual(a, alertRowVersion([{ id: "a1", status: "reviewed" }, { id: "a2", status: "open" }]),
    "an alert changed status and the version did not move");
});

test("a caseload row has no version, and the reason is written down", () => {
  // Left as a value rather than an unexplained null. Completing a review of a
  // caseload row closes nothing and changes nothing — the row is still there
  // tomorrow — so a version could only ever raise a false alarm.
  assert.ok(CASELOAD_ROW_HAS_NO_VERSION.length > 60);
  assert.match(CASELOAD_ROW_HAS_NO_VERSION, /changes nothing|collide/i);
});

// ---------------------------------------------------------------------------
// One expression, two ends
// ---------------------------------------------------------------------------

test("the queue and the action build the version from the same function", () => {
  // A version written from `lastDetectedAt` in the queue and `evidenceAt` in
  // the action would compile, look right, and reject every review a clinician
  // ever took. Both fields are real and both are on the same signal.
  const queue = code(read("src/lib/clinical/work-queue.ts"));
  const action = code(read("src/lib/clinical/shell-actions.ts"));
  for (const [label, src] of [["the queue", queue], ["the action", action]] as const) {
    assert.match(src, /signalRowVersion\(/, `${label} does not use the shared version helper`);
  }
  // And neither end writes its own.
  for (const [label, src] of [["the queue", queue], ["the action", action]] as const) {
    assert.doesNotMatch(src, /`\$\{signal\.state\}@\$\{signal\.evidenceAt\}`/,
      `${label} has its own copy of the version expression`);
  }
});

test("a signal version is built from evidenceAt, not lastDetectedAt", () => {
  // The two differ on a real signal, and a row carrying the wrong one is a
  // check that rejects every action rather than a check that never fires.
  const src = code(read("src/lib/clinical/row-version.ts"));
  assert.match(src, /\$\{s\.evidenceAt\}/);
  assert.doesNotMatch(src, /lastDetectedAt/);
});

// ---------------------------------------------------------------------------
// The check is armed
// ---------------------------------------------------------------------------

test("the surface sends the row's version, not null", () => {
  // THE DEFECT. Both call sites passed null, so the guard short-circuited.
  const view = code(read("src/components/experience/ClinicianHomeView.tsx"));
  assert.doesNotMatch(view, /expectedVersion=\{null\}/,
    "the queue still disarms the concurrency check by sending null");
  assert.match(view, /expectedVersion=\{row\.version\}/, "the row action sends no version");
  assert.match(view, /expectedVersion=\{selected\.version\}/, "the panel action sends no version");
});

test("every queue row carries a version or says why it has none", () => {
  // A row that forgot the field would send undefined, which short-circuits the
  // same way null did — so the type requires it and this checks the branches
  // that set it are all present.
  const src = code(read("src/lib/clinical/work-queue.ts"));
  assert.match(src, /version: signalRowVersion\(signal\)/, "signal rows carry no version");
  assert.match(src, /version: alertRowVersion\(openByPerson/, "alert rows carry no version");
  assert.match(src, /version: string \| null;/, "the field is optional, so a row can omit it");
});

test("the alert path revalidates too, not only the signal path", () => {
  // A safety row is the one a clinician most needs to close, and it was the one
  // with no check at all.
  const src = code(read("src/lib/clinical/shell-actions.ts"));
  // Bounded by the next top-level declaration rather than by the first line
  // starting with a brace: stripping comments leaves blank lines behind and the
  // naive slice ended the function early, so this failed on a correct
  // implementation.
  const start = src.indexOf("async function completeReviewWithoutSignal");
  assert.notEqual(start, -1, "the alert-path review function is gone");
  const after = src.indexOf("export async function", start);
  const body = src.slice(start, after === -1 ? undefined : after);
  assert.match(body, /alertRowVersion\(open\)/,
    "the alert path computes no current version to compare against");
  assert.match(body, /expectedVersion && args\.expectedVersion !== currentVersion/,
    "the alert path does not compare the reader's version with the server's");
  assert.match(body, /return stale\(/, "a collision on the alert path is not reported as stale");
});

test("the alert version describes the set the action will act on", () => {
  // The row collapses alerts by person AND reason; the action closes EVERY open
  // alert for the person. A version over the collapsed group would miss a
  // second alert being raised under a different reason, which is exactly the
  // row the reader has not seen.
  const src = code(read("src/lib/clinical/work-queue.ts"));
  assert.match(src, /openByPerson/, "the version is built per collapsed row rather than per person");
  assert.doesNotMatch(src, /alertRowVersion\(g\.alerts\)/,
    "the version describes the collapsed group, not the alerts the action will close");
});
