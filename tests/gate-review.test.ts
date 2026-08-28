// Gate presentation and the clinician review drawer
// (GUI and Decision-Surface Handoff §9.1, §9.2, §15.2, §21).
//
// §3.7's finding is the reason this surface exists: a gate answered "allowed or
// not" and handed back one sentence, so "temporarily limited by today's
// check-in", "waiting for a named human review", "locked by program sequence",
// "unavailable because of consent or profile state" and "stopped by a safety
// rule" all shared one padlock. Those are not interchangeable. A member one
// form away from proceeding and a member stopped by a safety rule were told the
// same nothing — and the second was taught that the stop is an obstacle to work
// around.
//
// §21's test matrix names the gate-presentation cases directly: open, caution,
// limited, review, stop, unknown, expiry, offline.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  memberCopyFor, groupGateDecisions, overrideAllowed,
  type GateDecision, type GateState,
} from "../src/lib/clinical/gate-review";
import { NEVER_OVERRIDABLE, OVERRIDABLE } from "../src/lib/clinical/review";

const STATES: GateState[] = ["open", "caution", "limited", "review_needed", "safety_stop", "unknown"];

const LIB = fs.readFileSync(path.join(process.cwd(), "src/lib/clinical/gate-review.ts"), "utf8");
const DRAWER = fs.readFileSync(path.join(process.cwd(), "src/components/clinical/GateReviewDrawer.tsx"), "utf8");

function decision(over: Partial<GateDecision> = {}): GateDecision {
  return {
    personId: "p1", moduleId: "m1", moduleTitle: "M", state: "limited",
    headline: "Limited", memberCopy: "x", safeAlternative: "Grounding",
    memberAction: "Start grounding", reasons: [{ code: "gate.grounding", label: "l" }],
    evidence: [], policy: { id: "module-access-gate", version: "v1" },
    effectiveAt: "2026-08-28 10:00:00", prior: null,
    overridable: null, neverOverridable: NEVER_OVERRIDABLE,
    ...over,
  } as GateDecision;
}

test("every §9.1 state has member-safe copy", () => {
  for (const s of STATES) {
    const copy = memberCopyFor(s);
    assert.ok(copy && copy.length > 10, `state ${s} has no member copy`);
    // §9.1's states describe a situation; none of them apologises or alarms.
    assert.doesNotMatch(copy, /sorry|error|failed|denied/i,
      `state ${s} uses failure language: "${copy}"`);
  }
});

test("a safety stop never yields an override", () => {
  // §15.2: "Attempt safety-stop override — do not render the action." Checked
  // on the state itself, so it holds even if a future cause were wired to an
  // override target by mistake.
  assert.equal(overrideAllowed(decision({ state: "safety_stop", overridable: "module_unlock" })), false);
});

test("only pacing targets can ever be offered", () => {
  assert.equal(overrideAllowed(decision({ overridable: null })), false);
  for (const t of OVERRIDABLE) {
    assert.equal(overrideAllowed(decision({ state: "review_needed", overridable: t })), true, `${t} should be offerable`);
  }
  // The two lists must stay disjoint. If a target ever appeared in both, the
  // drawer would offer something the service refuses — a control that fails.
  const overlap = (OVERRIDABLE as readonly string[]).filter((t) =>
    (NEVER_OVERRIDABLE as readonly string[]).includes(t));
  assert.deepEqual(overlap, [], `these targets are both overridable and never-overridable: ${overlap.join(", ")}`);
});

test("no never-overridable cause is wired to an override target", () => {
  // The mapping is a default-refuse table; this checks nothing was added to it
  // that the service layer would reject.
  const block = /const OVERRIDE_FOR_ACTION[\s\S]*?\n};/.exec(LIB);
  assert.ok(block, "OVERRIDE_FOR_ACTION not found");
  for (const t of NEVER_OVERRIDABLE) {
    assert.doesNotMatch(block![0], new RegExp(`["']?${t}["']?\\s*:`),
      `${t} is never overridable but appears as an override target`);
  }
  // crisis maps to safety_stop and must never carry an override.
  assert.doesNotMatch(block![0], /\bcrisis\s*:/, "the crisis cause is wired to an override target");
});

test("a setup gate does not borrow the generic 'limited' sentence", () => {
  // Found by rendering it: a member blocked by the fitness screener was shown
  // "Processing is paused today. Grounding and regulation remain open." while
  // the clinician read the real reason one line above. Those are different
  // claims, and the generic one describes a wait where there is an action.
  assert.match(LIB, /GENERIC_LIMITED_CAUSES/,
    "every limited cause shares one member sentence again");
  const block = /const GENERIC_LIMITED_CAUSES[^;]+;/.exec(LIB);
  assert.ok(block, "GENERIC_LIMITED_CAUSES not found");
  for (const setup of ["screening", "consent", "profile", "subscribe", "safety_plan"]) {
    assert.doesNotMatch(block![0], new RegExp(`["']${setup}["']`),
      `"${setup}" is treated as a daily limit; it is a setup step and needs its own sentence`);
  }
  // And each such cause names the step that resolves it, rather than sending
  // the member to grounding.
  for (const setup of ["screening", "consent", "profile", "prereq"]) {
    assert.match(LIB, new RegExp(`${setup}:\\s*\\{\\s*action:`),
      `"${setup}" has no member action, so it falls back to "Start grounding"`);
  }
});

test("identical decisions collapse, different causes do not", () => {
  // §10.3's duplicate-collapse rule, one surface over. An incomplete screener
  // blocks all eleven modules; without this the drawer was eleven expandable
  // rows carrying the identical decision, making one unresolved form look like
  // eleven problems.
  const same = [
    decision({ moduleId: "a", moduleTitle: "A" }),
    decision({ moduleId: "b", moduleTitle: "B" }),
  ];
  const g = groupGateDecisions(same);
  assert.equal(g.length, 1, "two identical decisions did not collapse");
  assert.deepEqual(g[0].moduleNames, ["A", "B"], "collapsing lost the affected modules");

  const different = [
    decision({ moduleId: "a", moduleTitle: "A", reasons: [{ code: "gate.screening", label: "l" }] }),
    decision({ moduleId: "b", moduleTitle: "B", reasons: [{ code: "gate.prereq", label: "l" }] }),
  ];
  assert.equal(groupGateDecisions(different).length, 2,
    "two different causes merged — one of them is now invisible");

  // Same cause, different state must not merge either.
  const states = [
    decision({ moduleId: "a", state: "limited" }),
    decision({ moduleId: "b", state: "safety_stop" }),
  ];
  assert.equal(groupGateDecisions(states).length, 2, "a safety stop merged into a limited group");
});

test("the drawer shows everything §9.2 requires", () => {
  const required: Array<[string, RegExp]> = [
    ["current decision and effective time", /d\.headline[\s\S]*d\.effectiveAt|d\.effectiveAt/],
    ["rule and version", /d\.policy\.id[\s\S]*d\.policy\.version/],
    ["human-readable reasons", /d\.reasons/],
    ["evidence references", /d\.evidence/],
    ["prior decision", /d\.prior/],
    ["member-safe copy preview", /d\.memberCopy/],
    ["what cannot be overridden", /d\.neverOverridable/],
    ["a reason the member can act on", /d\.memberAction/],
  ];
  const missing = required.filter(([, rx]) => !rx.test(DRAWER)).map(([w]) => w);
  assert.deepEqual(missing, [], "the gate drawer omits: " + missing.join(", "));
});

test("the drawer states the boundary even when an override is available", () => {
  // A drawer showing only what CAN be relaxed invites the reading that
  // everything else is merely absent from this screen. The never-overridable
  // block must sit outside the canOverride branch.
  const idx = DRAWER.indexOf("Cannot be overridden");
  const branch = DRAWER.indexOf("canOverride ?");
  assert.ok(idx > -1, "the drawer never names what cannot be overridden");
  assert.ok(idx > branch, "the boundary is inside the override branch and disappears when no override exists");
});

test("the override form carries scope and a required reason", () => {
  // §15.2: an override is a high-risk confirmation "with scope and expiry", and
  // review.ts refuses a reason under 10 characters — the form must not let a
  // clinician discover that only after typing.
  assert.match(DRAWER, /minLength=\{10\}/, "the override reason has no minimum length");
  assert.match(DRAWER, /required/, "the override reason is not required");
  assert.match(DRAWER, /pacing only/i, "the override form does not state its scope");
});

test("the drawer does not re-implement the override boundary", () => {
  // The service layer is the boundary. A second copy in a component is a copy
  // that can drift, and the one that drifts is the one nobody tests.
  assert.doesNotMatch(DRAWER, /NEVER_OVERRIDABLE\s*=|OVERRIDABLE\s*=/,
    "the drawer defines its own override lists instead of rendering the decision's");
});
