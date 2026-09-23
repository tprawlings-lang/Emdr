// Who may sign each attested gate.
//
// Decided 19 September: a named individual, not any reviewer. p99 already
// gives every gate an owner — "Security", "Product and QA" — and a team is not
// a signature: "somebody in Security approved it" is not a thing anybody can
// follow up, and these gates decide whether a deployment may hold real people.
//
// THE UNNAMED CASE IS A DECISION, NOT A DEFAULT. Refusing every sign-off until
// three names exist would be the same one-way door this codebase has walked
// into twice — a gate that cannot pass closes enrollment permanently. So an
// unnamed gate keeps today's behaviour and the console says so, because a rule
// that was never set must not look identical to a rule that was.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";

import {
  signerFor, refusalFor, GATE_OWNERS, NO_OWNER_NAMED,
} from "../src/lib/governance/gate-owners";
import { ATTESTED_GATES } from "../src/lib/governance/attestation";

const REVIEWER = { email: "reviewer.demo@steady.local", role: "reviewer" };
const CLINICIAN = { email: "clinician.demo@steady.local", role: "clinician" };

test("every attested gate appears in the owner map, named or not", () => {
  // A map holding only the CONFIGURED gates could not tell "no owner is set"
  // from "this gate is not attestable", and the screen has to say the first one
  // out loud.
  for (const id of ATTESTED_GATES) {
    assert.ok(id in GATE_OWNERS, `${id} is attestable and absent from GATE_OWNERS`);
  }
});

test("with nobody named, any reviewer may sign — and the verdict says why", () => {
  for (const id of ATTESTED_GATES) {
    const v = signerFor(REVIEWER, id, true);
    assert.equal(v.may, true, `${id} could not be signed by a reviewer`);
    // THE REASON TRAVELS. A bare `true` here would let the screen render a
    // permission granted because nobody is named exactly like one granted
    // because somebody is.
    assert.equal(v.may && v.reason, "no_owner_named");
  }
});

test("a named owner may sign and nobody else may", () => {
  const owner = { name: "Dr Ellis Nakamura", email: "ellis@example.test" };
  const withOwner = { ...GATE_OWNERS, accessibility: owner };
  // Exercised through the same function the action calls, by swapping the map
  // the way the module reads it — the rule must not be reimplemented here.
  const original = GATE_OWNERS.accessibility;
  try {
    GATE_OWNERS.accessibility = owner;
    assert.equal(
      signerFor({ email: "ellis@example.test", role: "reviewer" }, "accessibility", true).may,
      true,
    );
    const refused = signerFor(REVIEWER, "accessibility", true);
    assert.equal(refused.may, false, "a reviewer who is not the owner signed it");
    assert.equal(!refused.may && refused.reason, "not_the_owner");
    // THE REFUSAL NAMES WHO SHOULD. A refusal that does not say who to ask
    // sends somebody to read a config file.
    assert.match(refusalFor(refused, "Accessibility") ?? "", /Dr Ellis Nakamura/);
  } finally {
    GATE_OWNERS.accessibility = original;
  }
  assert.ok(withOwner.accessibility);
});

test("the address match ignores capitalisation", () => {
  // An address typed into a configuration file and one stored at sign-up
  // differ by case often enough that matching exactly would refuse the right
  // person and name them in the refusal — the most confusing failure available.
  const original = GATE_OWNERS.authorization;
  try {
    GATE_OWNERS.authorization = { name: "Sam", email: "Sam.Owner@Example.Test" };
    assert.equal(
      signerFor({ email: "sam.owner@example.test", role: "reviewer" }, "authorization", true).may,
      true,
      "the named owner was refused over capitalisation",
    );
  } finally {
    GATE_OWNERS.authorization = original;
  }
});

test("a non-reviewer cannot sign, named or not", () => {
  const v = signerFor(CLINICIAN, "accessibility", true);
  assert.equal(v.may, false);
  assert.equal(!v.may && v.reason, "not_a_reviewer");
});

test("a gate the system measures cannot be signed by anybody", () => {
  // A signature must never stand in for a measurement.
  const v = signerFor(REVIEWER, "safety_regression", false);
  assert.equal(v.may, false);
  assert.equal(!v.may && v.reason, "not_attestable");
});

test("no name has been invented", () => {
  // Writing a plausible name would be this codebase deciding who is
  // accountable for whether a keyboard path is blocked, which is the one thing
  // it must not do. Each is null until somebody says.
  for (const [id, owner] of Object.entries(GATE_OWNERS)) {
    assert.equal(owner, null, `${id} has an owner nobody asked for: ${JSON.stringify(owner)}`);
  }
  assert.match(NO_OWNER_NAMED, /absence of a decision/i);
});

test("the sign-off action asks this module rather than deciding for itself", () => {
  // A form that hides a control is a suggestion; the action is the door. A
  // second rule at the door would eventually disagree with this one.
  const src = fs.readFileSync("src/lib/review/actions.ts", "utf8");
  assert.match(src, /signerFor\(/, "recordGateSignoff does not consult the owner rule");
});
