// What a gate resolved to, the last time anybody asked.
//
// `clinical_language` and `projection_parity` read `unavailable` in every
// deployment — not because they fail, but because `resolveEvidence` does not
// compute either unless the caller hands it in: one needs the copy-review
// tally the review screen holds, the other a ledger rebuild deliberately not
// run on a page load. The environment tier is read on the signup page, so
// asking there would be free and wrong or correct and unaffordable, and
// requiring them anyway closes enrollment permanently.
//
// EXPIRES ON CHANGE, NOT ON A CLOCK. Decided 23 September. A time cap was
// considered and rejected: a result expiring on a timer closes the pilot tier
// overnight with nothing having changed, which teaches an operator to re-run a
// check they have no reason to believe is stale — and a check somebody re-runs
// without reading is worse than no check.

process.env.EMDR_DATA_DIR = `/tmp/steady-gateres-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "0";
process.env.EMDR_SESSION_SECRET = "gateres-test-secret-at-least-32-chars";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "gateres-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";

import { getDb } from "../src/lib/db";
import { data } from "../src/lib/data";
import {
  recordGateResult, currentGateResults, basisFor, RECORDED_GATES,
} from "../src/lib/governance/gate-results";
import { resolveEvidence } from "../src/lib/review/gates";

getDb();

async function clear() {
  const c = await data();
  await c.run("DELETE FROM gate_results", []);
}

test("a recorded result is read back where the gate cannot be recomputed", async () => {
  await clear();
  await recordGateResult({
    gateId: "clinical_language", status: "pass",
    summary: "All 11 reviewable surfaces approved at the current copy version",
  });
  const ev = resolveEvidence(getDb(), { recorded: await currentGateResults() });
  const g = ev.get("clinical_language")!;
  assert.equal(g.status, "pass", "the recorded result was not read back");
  assert.match(g.summary, /recorded \d{4}-\d{2}-\d{2}/, "the summary does not say it is a recording");
});

test("a live resolution outranks a recording", async () => {
  // The recording exists for callers that CANNOT resolve it. A caller that can
  // must not be answered from a record that is, at best, as fresh.
  const ev = resolveEvidence(getDb(), {
    recorded: await currentGateResults(),
    clinicalLanguage: { total: 4, approved: 1, blocked: 0, changesRequested: 0 },
  });
  const g = ev.get("clinical_language")!;
  assert.equal(g.status, "unavailable");
  assert.match(g.summary, /3 of 4/, "a stale recording answered over a live tally");
});

test("a result expires when the inputs it was resolved against move", async () => {
  // THE WHOLE MECHANISM. Nobody has to remember to invalidate anything: the
  // reader selects on the current basis, so a row keyed to inputs that have
  // since moved is simply not returned. There is no state in which a stale row
  // is in hand and something must remember not to trust it.
  await clear();
  const c = await data();
  await c.run(
    `INSERT INTO gate_results (gate_id, basis, status, summary, resolved_at)
     VALUES ('clinical_language', 'copy:from-last-month', 'pass', 'Everything approved', '2026-08-01 09:00:00')`,
    []
  );
  const results = await currentGateResults();
  assert.equal(
    results.has("clinical_language"), false,
    "a result resolved against a copy version that has since changed still counted",
  );
  const ev = resolveEvidence(getDb(), { recorded: results });
  assert.equal(ev.get("clinical_language")?.status, "unavailable");
});

test("the basis is never derived from the result", async () => {
  // Getting this wrong once cost a real debugging session: a gate's sign-off
  // state was folded into the facts its fingerprint is computed from, so
  // recording an approval changed the thing the approval was keyed on and the
  // signature invalidated itself by existing. A basis identifies the INPUTS
  // and is computable without doing the work — so it does not move when the
  // answer does.
  await clear();
  const before = basisFor("clinical_language");
  await recordGateResult({ gateId: "clinical_language", status: "pass", summary: "Approved" });
  assert.equal(basisFor("clinical_language"), before, "recording a result changed the basis");
  assert.ok((await currentGateResults()).has("clinical_language"));

  // And again with the opposite answer.
  await recordGateResult({ gateId: "clinical_language", status: "fail", summary: "Two blocked" });
  assert.equal(basisFor("clinical_language"), before);
  assert.equal((await currentGateResults()).get("clinical_language")?.status, "fail");
});

test("an unavailable result is not recorded", async () => {
  // It means nobody resolved it. Storing that turns "we did not look" into a
  // durable finding that survives until the inputs move — the opposite of what
  // this table is for.
  await clear();
  const wrote = await recordGateResult({
    gateId: "clinical_language", status: "unavailable", summary: "Copy review not resolved",
  });
  assert.equal(wrote, false);
  assert.equal((await currentGateResults()).size, 0);
});

test("only the two recorded gates have a basis", async () => {
  // A basis on a gate that is resolved live would be a second way to answer
  // the same question, and the two would eventually disagree.
  assert.equal(basisFor("safety_regression"), null, "a measured gate has a basis it does not need");
  assert.equal(basisFor("accessibility"), null, "an attested gate has a basis it does not need");
  assert.ok(basisFor("clinical_language"), "the copy version identifies nothing to expire against");
});

test("a build with no commit falls back to the environment generation", async () => {
  // A THIRD ONE-WAY DOOR, FOUND BY THE ENROLLMENT SUITE GOING RED ON A FRESH
  // DATABASE. `scripts/serve.sh` derives the commit from git so a served build
  // has one; `npm run start` does not, and neither does any deployment whose
  // image forgot to bake it in. Returning null there meant parity could never
  // be recorded, so the gate could never pass, so enrollment could never open —
  // in exactly the deployments least likely to work out why.
  //
  // The generation is the better basis anyway: parity asks whether a rebuild
  // reproduces what the screens show, and the generation changes precisely when
  // the data underneath is rebuilt.
  const { currentGeneration } = await import("../src/lib/environment-generation");
  const gen = (await currentGeneration()).generation;
  assert.ok(gen, "there is no generation to fall back to");

  const withCommit = basisFor("projection_parity", gen);
  assert.ok(withCommit, "no basis at all, so a parity result can never be recorded");
  if (!process.env.EMDR_BUILD_COMMIT) {
    assert.equal(withCommit, `gen:${gen}`, "the fallback did not use the generation");
  }
  // AND STILL NULL WITH NEITHER. A constant here would make every result look
  // current forever, which is the failure mode that matters.
  assert.equal(basisFor("projection_parity", null), process.env.EMDR_BUILD_COMMIT ? withCommit : null);
});

test("parity records nothing when neither a commit nor a generation is available", () => {
  // AND THIS IS THE HONEST CONSEQUENCE, asserted rather than smoothed over.
  // Nothing cheap identifies ledger state, so a recorded parity result is keyed
  // to the deployed commit. A build reporting no commit cannot be told apart
  // from another, so there is nothing to key to — and returning a constant
  // would make every result look current forever, which is the failure mode
  // that matters here.
  //
  // scripts/serve.sh sets EMDR_BUILD_COMMIT from git when it is not already
  // set, so a served build can record one. A test process cannot, which is why
  // this asserts the null rather than the value.
  if (!process.env.EMDR_BUILD_COMMIT) {
    assert.equal(
      basisFor("projection_parity", null), null,
      "a basis appeared from nowhere, so a parity result would never expire",
    );
  }
  assert.ok(RECORDED_GATES.includes("projection_parity"));
});

test("re-resolving the same basis replaces rather than accumulates", async () => {
  await clear();
  await recordGateResult({ gateId: "clinical_language", status: "fail", summary: "One blocked" });
  await recordGateResult({ gateId: "clinical_language", status: "pass", summary: "Now approved" });
  const c = await data();
  const rows = (await c.all(
    "SELECT status FROM gate_results WHERE gate_id = 'clinical_language'", []
  )) as Array<{ status: string }>;
  assert.equal(rows.length, 1, "two results for one basis, so which one counts is an ordering accident");
  assert.equal(rows[0].status, "pass");
});
