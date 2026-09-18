// The failure register has to be checkable, or it is a paragraph again.
//
// P6's acceptance is "failure-injection evidence". A hand-maintained list of
// what survives failure would drift exactly like the handoff sections it
// replaces — and drift in this direction is worse than in any other, because a
// row that says `proven` is a statement that somebody tried breaking it.

import { strict as assert } from "node:assert";
import test from "node:test";

import { FAILURE_REGISTER, failureCoverage } from "../src/lib/governance/failure-register";
import {
  verifyFailureRegister, failureRegisterDrift,
} from "../src/lib/governance/failure-register-verify";

test("every row's claim is supported by the tests it names", () => {
  assert.deepEqual(
    failureRegisterDrift().map((d) => `${d.id}: ${d.problems.join("; ")}`),
    [],
    "the failure register claims evidence the test suite does not carry",
  );
});

test("ids are unique, so two rows cannot describe one scenario differently", () => {
  const ids = FAILURE_REGISTER.map((e) => e.id);
  assert.deepEqual([...new Set(ids)].sort(), [...ids].sort());
});

test("a test that does not name the scenario is not evidence for it", () => {
  // THE RULE THAT MAKES THIS REGISTER WORTH HAVING. A file existing under a
  // plausible name is the weakest possible evidence, and it is exactly what a
  // register drifts into claiming.
  const findings = verifyFailureRegister([
    {
      id: "fake.named-but-unlinked",
      scenario: "x", required: "y", area: "concurrency", state: "proven",
      // A real test file that says nothing about this scenario.
      injections: ["tests/smoke.test.ts", "tests/retry.test.ts"],
    },
    {
      id: "fake.missing-file",
      scenario: "x", required: "y", area: "reset", state: "proven",
      injections: ["tests/does-not-exist.test.ts"],
    },
    {
      id: "fake.proven-with-nothing",
      scenario: "x", required: "y", area: "permissions", state: "proven",
      injections: [],
    },
  ]);
  assert.match(findings[0].problems.join(" "), /never names fake\.named-but-unlinked/);
  assert.match(findings[1].problems.join(" "), /does not exist/);
  assert.match(findings[2].problems.join(" "), /assertion rather than evidence/);
});

test("a held row says why, and a gap cannot claim an injection", () => {
  const findings = verifyFailureRegister([
    { id: "fake.silent-hold", scenario: "x", required: "y", area: "safety", state: "held", injections: [] },
    {
      id: "fake.gap-with-evidence", scenario: "x", required: "y", area: "safety", state: "gap",
      injections: ["tests/retry.test.ts"],
    },
  ]);
  assert.match(findings[0].problems.join(" "), /needs a note saying why/);
  assert.match(findings[1].problems.join(" "), /contradictory/);

  for (const e of FAILURE_REGISTER) {
    if (e.state === "held") {
      assert.ok(e.note && e.note.length > 20, `${e.id} is held with no explanation`);
    }
  }
});

test("every row states a required behaviour, or nothing could be checked", () => {
  const findings = verifyFailureRegister([
    { id: "fake.no-requirement", scenario: "x", required: "  ", area: "reset", state: "gap", injections: [] },
  ]);
  assert.match(findings[0].problems.join(" "), /states no required behaviour/);
  for (const e of FAILURE_REGISTER) {
    assert.ok(e.required.trim().length > 20, `${e.id} does not say what is required`);
  }
});

test("coverage is counted, not described", () => {
  const c = failureCoverage();
  assert.equal(c.total, FAILURE_REGISTER.length);
  assert.equal(c.proven + c.gaps + c.held, c.total, "every row is in exactly one state");
  // THE NUMBER IS NOT ASSERTED AGAINST A TARGET. A register that failed the
  // build until every row was proven would be closed by marking rows proven,
  // which is the one outcome that makes it worthless. What the suite enforces
  // is that each claim is true; how many there are is a status, and it is
  // read on the review screen.
  assert.deepEqual(c.openIds, FAILURE_REGISTER.filter((e) => e.state === "gap").map((e) => e.id));
});
