// One policy governing entry, storage, display and export (UX 008).
//
// The defect UX 008 names is a contradiction: every screen says "DEMO —
// FABRICATED DATA — NOT CLINICAL CARE", and the product also has a pilot with
// an enrollment code, a consent flow and a place limit. Both statements are
// true of different states, and nothing said which state a deployment was in.
//
// THE PROPERTY THAT MATTERS MOST IS THE DIRECTION OF FAILURE. Every way this
// can be wrong — an unresolved gate, an unreadable database, a class nobody
// listed — has to land on fabricated-only. A policy module that widened what
// was permitted when it could not tell would be worse than no policy, because
// it would be trusted.

import { strict as assert } from "node:assert";
import test from "node:test";

import {
  readTier, permits, mayAdmitParticipant, TIER_POLICY, T1_REQUIRED_GATES,
  type DataClass, type Verb,
} from "../src/lib/governance/environment-policy";

const allPass = Object.fromEntries(T1_REQUIRED_GATES.map((g) => [g, true]));

test("no enrollment code means a demonstration, whatever the gates say", () => {
  const r = readTier({ enrollmentOpen: false, gatePassed: allPass });
  assert.equal(r.tier, "T0_demonstration");
  assert.equal(mayAdmitParticipant(r), false);
  assert.match(r.because, /Enrollment is closed/);
});

test("a code set with a gate failing is a demonstration, and says which gate", () => {
  // THE STATE NOTHING COULD DESCRIBE. An operator who means to run a pilot and
  // a deployment that has earned one are different things, and one environment
  // variable used to be the whole distance between them.
  for (const gate of T1_REQUIRED_GATES) {
    const r = readTier({
      enrollmentOpen: true,
      gatePassed: { ...allPass, [gate]: false },
    });
    assert.equal(r.tier, "T0_demonstration", `${gate} failing did not hold the tier down`);
    assert.equal(mayAdmitParticipant(r), false);
    assert.ok(r.because.includes(gate), `the refusal does not name ${gate}, so nobody can clear it`);
  }
});

test("a gate nobody resolved is not a gate that passed", () => {
  // `unavailable` and `pass` are different facts everywhere else in this
  // codebase, and the one place that must not collapse them is the one
  // deciding whether a real person may be admitted.
  const r = readTier({ enrollmentOpen: true, gatePassed: {} });
  assert.equal(r.tier, "T0_demonstration");
  assert.deepEqual([...r.blockedBy].sort(), [...T1_REQUIRED_GATES].sort());
});

test("every required gate passing, with enrollment open, is the pilot tier", () => {
  const r = readTier({ enrollmentOpen: true, gatePassed: allPass });
  assert.equal(r.tier, "T1_pilot");
  assert.equal(mayAdmitParticipant(r), true);
  assert.deepEqual(r.blockedBy, []);
});

test("no tier permits a real participant's record to leave in a file", () => {
  // Admitting a real participant and permitting their record to be exported
  // are two decisions, and granting the second with the first is how a consent
  // scope quietly widens. A whole-database snapshot already cannot honour
  // per-participant terms.
  for (const tier of Object.keys(TIER_POLICY) as Array<keyof typeof TIER_POLICY>) {
    assert.equal(
      permits(tier, "real_participant", "export"), false,
      `${tier} lets a real participant's record out in a file`,
    );
  }
});

test("the demonstration tier permits no real participant data at all", () => {
  for (const verb of ["entry", "storage", "display", "export"] as Verb[]) {
    assert.equal(
      permits("T0_demonstration", "real_participant", verb), false,
      `the demonstration tier permits ${verb} of a real participant's information`,
    );
  }
  // AND IT DOES PERMIT REAL STAFF, which is the honest half. A policy saying
  // "fabricated only" while a reviewer's real name sat in the header would be
  // one nobody could follow, so it would be ignored rather than corrected.
  assert.equal(permits("T0_demonstration", "real_staff", "display"), true);
});

test("a class nobody listed permits nothing", () => {
  // An omission is the most likely way this goes wrong — somebody adds a data
  // class and forgets a tier. The safe reading of a missing entry is "no".
  assert.equal(permits("T0_demonstration", "nonsense" as DataClass, "entry"), false);
  assert.equal(permits("T1_pilot", "nonsense" as DataClass, "display"), false);
});

test("every tier states its rule in a sentence somebody can act on", () => {
  for (const [tier, policy] of Object.entries(TIER_POLICY)) {
    assert.ok(policy.statement.length > 80, `${tier} has no usable statement`);
    assert.equal(policy.tier, tier, `${tier}'s policy is filed under the wrong key`);
  }
});
