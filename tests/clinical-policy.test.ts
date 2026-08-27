// Configurable clinical policy modes (Demo-First handoff §6).
//
// The point of these tests is that a policy mode is a *safety boundary*, not a
// preference. Two properties matter more than the rest and are asserted
// directly: a default may never read as an approval, and no configuration may
// promote the deterministic engine to govern member access.

process.env.EMDR_DATA_DIR = `/tmp/steady-policy-${process.pid}-${Date.now()}`;
delete process.env.EMDR_DEMO;

import { strict as assert } from "node:assert";
import test from "node:test";
import {
  activePolicy, policyBanner, coverageStatement, companionContentAllowed,
  T1_DEFAULT_POLICY, POLICY_PRESETS, CLINICAL_POLICY_VERSION,
} from "../src/lib/clinical-policy";

function withPolicy<T>(name: string | undefined, fn: () => T): T {
  const saved = process.env.EMDR_CLINICAL_POLICY;
  if (name === undefined) delete process.env.EMDR_CLINICAL_POLICY;
  else process.env.EMDR_CLINICAL_POLICY = name;
  try { return fn(); } finally {
    if (saved === undefined) delete process.env.EMDR_CLINICAL_POLICY;
    else process.env.EMDR_CLINICAL_POLICY = saved;
  }
}

test("the default policy matches the handoff's T0/T1 assumptions", () => {
  const p = withPolicy(undefined, activePolicy);
  assert.equal(p.version, CLINICAL_POLICY_VERSION);
  assert.equal(p.companionVisibility, "escalation");
  assert.equal(p.caseload, "hybrid");
  assert.equal(p.coverage, "business_hours");
  assert.equal(p.alertConsequence, "pause_processing");
  assert.equal(p.reEntry, "clinician_decision");
  assert.equal(p.autonomous, "shadow");
});

test("no policy is approved, and the banner says so", () => {
  for (const name of Object.keys(POLICY_PRESETS)) {
    const p = withPolicy(name, activePolicy);
    assert.equal(p.approved, false, `${name} claims approval`);
    assert.equal(p.approvedBy, null);
    assert.match(policyBanner(p), /PROVISIONAL, not clinically approved/,
      `${name} does not disclose that it is provisional`);
  }
});

test("SAFETY: no configuration can promote the engine to govern", () => {
  // 'active' is a real mode in the type, because it is the eventual target. It
  // must not be reachable by editing an environment variable — promotion is
  // gated on clinician sign-off conditions and a staged, reversible flip.
  const reachable = Object.entries(POLICY_PRESETS)
    .filter(([, v]) => v.autonomous === "active")
    .map(([k]) => k);
  assert.deepEqual(reachable, [], "a preset offers 'active' autonomy");

  POLICY_PRESETS.__test_active = { autonomous: "active" };
  try {
    assert.throws(() => withPolicy("__test_active", activePolicy),
      /cannot be selected by configuration/);
  } finally {
    delete POLICY_PRESETS.__test_active;
  }
});

test("an unknown policy name fails loudly rather than falling back", () => {
  // Silently defaulting would mean a demo running a configuration nobody chose.
  assert.throws(() => withPolicy("does-not-exist", activePolicy),
    /Unknown EMDR_CLINICAL_POLICY/);
});

test("presets change behaviour, so a reviewer can compare rather than imagine", () => {
  const priv = withPolicy("privacy_maximal", activePolicy);
  assert.equal(companionContentAllowed("escalation", priv), false,
    "privacy_maximal must withhold content even on escalation");

  const max = withPolicy("clinician_maximal", activePolicy);
  assert.equal(companionContentAllowed("routine", max), true);
  assert.equal(max.caseload, "pooled");

  const staffed = withPolicy("staffed_24h", activePolicy);
  assert.equal(staffed.coverage, "24_hour");
  assert.equal(staffed.reEntry, "timed");
});

test("companion visibility is enforced per context, not as a single switch", () => {
  const at = (v: typeof T1_DEFAULT_POLICY.companionVisibility) =>
    ({ ...T1_DEFAULT_POLICY, companionVisibility: v });

  assert.equal(companionContentAllowed("escalation", at("never")), false);
  assert.equal(companionContentAllowed("escalation", at("escalation")), true);
  assert.equal(companionContentAllowed("routine", at("escalation")), false,
    "an escalation grant must not become a reading habit");
  assert.equal(companionContentAllowed("member_shared", at("member_shared")), true);
  assert.equal(companionContentAllowed("routine", at("member_shared")), false);
  assert.equal(companionContentAllowed("routine", at("always")), true);
});

test("the member-facing coverage statement matches the configured schedule", () => {
  // The failure this prevents: a product promising round-the-clock monitoring
  // while the rota is business hours.
  const business = coverageStatement({ ...T1_DEFAULT_POLICY, coverage: "business_hours" });
  assert.match(business, /business hours/);
  assert.match(business, /not monitored around the clock/);

  const none = coverageStatement({ ...T1_DEFAULT_POLICY, coverage: "none" });
  assert.match(none, /No one reviews your entries in real time/);

  const full = coverageStatement({ ...T1_DEFAULT_POLICY, coverage: "24_hour" });
  assert.doesNotMatch(full, /not monitored around the clock/,
    "a 24-hour rota should not carry the not-monitored disclaimer");

  // Every variant must route to crisis resources, whatever the coverage.
  for (const c of ["none", "business_hours", "extended", "24_hour"] as const) {
    const s = coverageStatement({ ...T1_DEFAULT_POLICY, coverage: c });
    assert.match(s, /988/, `${c} does not name the crisis line`);
    assert.match(s, /911/, `${c} does not name emergency services`);
  }
});

test("no coverage statement claims Steady is an emergency service", () => {
  for (const c of ["none", "business_hours", "extended", "24_hour"] as const) {
    const s = coverageStatement({ ...T1_DEFAULT_POLICY, coverage: c });
    assert.match(s, /not an emergency service/, `${c} omits the disclaimer`);
  }
});
