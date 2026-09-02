// The planning engine (handoff 07 §3.4 p34, §3.5 p35, §3.6 p36, §4.5 p44,
// §5.4 p49, §6.1 p52).
//
// p52's exit evidence for Wave 6 is "no person-level actions; full audit", and
// both halves are checked here structurally rather than by inspection: the
// first by what `src/lib/planning` is allowed to import and name, the second
// by driving a signal through the state machine and reading the log back.
//
// The rule arithmetic is checked the way the metrics are — tiny fixtures with
// the expected answer worked out in the comment. A rule checked against its
// own implementation is checked against nothing.

process.env.EMDR_DATA_DIR = `/tmp/steady-planning-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "planning-test-secret-at-least-32-characters";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "planning-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { ALL_ELIGIBLE, cohort, cohortHash } from "../src/lib/metrics/cohorts";
import type { MetricResult } from "../src/lib/metrics/compute";
import { ROLES, type Role } from "../src/lib/roles";
import {
  PLANNING_OWNER, RULE_IDS, RULE_VERSION, THRESHOLD_DEFAULTS, THRESHOLD_VERSION,
  defaultThresholds, thresholdsFrom, type ThresholdSource,
} from "../src/lib/planning/policy";
import {
  LADDER, CURRENT_LEVEL, ladder, wordingViolation, NO_RACE_CORRECTION,
} from "../src/lib/planning/ladder";
import {
  RULES, evaluateAll, evaluateRule, rule,
  type RuleContext, type WindowReading,
} from "../src/lib/planning/rules";
import {
  ACTION_LABELS, BLOCKED_ACTIONS, SIGNAL_STATES, STATES, actionPermitted,
  advanceTarget, allowedActions, isBlockedAction, mayTransition, stateDef, transition,
  type SignalState,
} from "../src/lib/planning/lifecycle";
import { REQUIRED_PHRASE, buildSignal, cohortIsProtected, routingFor, signalId } from "../src/lib/planning/signal";

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

function walk(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(rel));
    else if (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) out.push(rel);
  }
  return out;
}

/** Strip comments, so a rule can be DISCUSSED in prose without tripping the
 *  check that enforces it. */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CTX = { start: "2026-03-01", end: "2026-05-31" };

function result(over: Partial<MetricResult> = {}): MetricResult {
  return {
    metric_id: "followup_completion.v1",
    cohort_id: "fixture.v1",
    cohort_hash: "0000000000000000",
    window: CTX,
    grain: "person",
    numerator: 80,
    denominator: 100,
    value: 0.8,
    missing: {},
    suppressed: false,
    status: "observed",
    data_version: "demo-population-v1",
    metric_version: "1.0.0",
    projection_version: "population_metrics.v2",
    refreshed_at: "2026-08-29T12:00:00Z",
    lineage_ref: "lineage://metric-run-0001",
    detail: {},
    ...over,
  };
}

/** One window: the cohort's rate and the reference's, as percentages. */
function window_(label: string, cohortPct: number, refPct: number, over: Partial<WindowReading> = {}): WindowReading {
  return {
    label,
    cohort: result({ numerator: Math.round(cohortPct), denominator: 100, value: cohortPct / 100 }),
    reference: result({ numerator: Math.round(refPct), denominator: 100, value: refPct / 100 }),
    missingness: 0.1,
    ...over,
  };
}

function ctx(over: Partial<RuleContext> = {}): RuleContext {
  return {
    cohortId: "fixture.v1",
    cohortHash: "0000000000000000",
    referenceId: ALL_ELIGIBLE.id,
    access: [window_("w1", 70, 85), window_("w2", 71, 85)],
    followup: [window_("w1", 70, 85), window_("w2", 71, 85)],
    change: [window_("w1", 70, 85), window_("w2", 71, 85)],
    fairness: { measure: "follow-up completion", disparityPp: -14, completeness: 1, groupSize: 40 },
    capacity: { demand: 120, openFirstVisitSlots: 80, slotDataAsOf: "2026-08-28", asOfAgeDays: 1 },
    reviewLoad: {
      fixedReviewEvents: 90, staffedCapacity: 60,
      classificationComplete: true, coverageScheduleKnown: true,
    },
    dataQuality: {
      missingness: 0.1, projectionMismatches: 0, driftPp: 1, checksFailed: 0, checksTotal: 3,
    },
    followupDueLogicDiffers: false,
    exposureDefinitionChanged: false,
    changeIntervalIsConfidence: true,
    ...over,
  };
}

const T = defaultThresholds();

// ---------------------------------------------------------------------------
// p34 — the seven rules
// ---------------------------------------------------------------------------

test("p34's seven rules are all present, and no eighth has been added quietly", () => {
  assert.deepEqual(RULES.map((r) => r.id).sort(), [...RULE_IDS].sort());
  for (const r of RULES) {
    assert.ok(r.trigger.length > 10, `${r.id} has no trigger`);
    assert.ok(r.output.length > 5, `${r.id} has no output`);
    assert.ok(r.noOutputWhen.length > 5, `${r.id} has no "no output when" condition`);
  }
});

test("ACCESS_GAP fires on a gap that holds in both windows, and not on one that flips", () => {
  // 70 against 85 is −15pp; 71 against 85 is −14pp. Both past the 10-point
  // default, both in the same direction: fires.
  const held = evaluateRule("ACCESS_GAP", ctx(), T);
  assert.equal(held.withheld, null);
  assert.equal(held.fired, true);
  assert.equal(held.observed.difference_pp, -15);

  // −15 then +14. Each is past the threshold in absolute terms and they are
  // not the same finding — a cohort that swings either side of the population
  // is unstable, not disadvantaged. Reporting |difference| would call it a gap.
  const flipped = evaluateRule("ACCESS_GAP", ctx({
    access: [window_("w1", 70, 85), window_("w2", 99, 85)],
  }), T);
  assert.equal(flipped.withheld, null);
  assert.equal(flipped.fired, false, "a gap that changed sign was reported as a repeated gap");
});

test("ACCESS_GAP is withheld by each of p34's three conditions, separately", () => {
  const suppressed = evaluateRule("ACCESS_GAP", ctx({
    access: [window_("w1", 70, 85), window_("w2", 71, 85, {
      cohort: result({ suppressed: true, numerator: -1, value: null }),
    })],
  }), T);
  assert.match(String(suppressed.withheld), /suppressed/);
  assert.equal(suppressed.fired, false);

  // 29 people, against a minimum analysis size of 30.
  const small = evaluateRule("ACCESS_GAP", ctx({
    access: [window_("w1", 70, 85), window_("w2", 71, 85, {
      cohort: result({ numerator: 20, denominator: 29, value: 20 / 29 }),
    })],
  }), T);
  assert.match(String(small.withheld), /below the minimum analysis size of 30/);

  // 41% missing, against a 30% limit.
  const missing = evaluateRule("ACCESS_GAP", ctx({
    access: [window_("w1", 70, 85), window_("w2", 71, 85, { missingness: 0.41 })],
  }), T);
  assert.match(String(missing.withheld), /missingness/);
});

test("FOLLOWUP_GAP is directional: a cohort ABOVE the reference is not an access problem", () => {
  // 70 against 85 is −15, past the 12-point default: fires.
  const below = evaluateRule("FOLLOWUP_GAP", ctx(), T);
  assert.equal(below.fired, true);
  assert.equal(below.observed.difference_pp, -14);

  // 85 against 70 is +15. Same magnitude, opposite meaning.
  const above = evaluateRule("FOLLOWUP_GAP", ctx({
    followup: [window_("w1", 85, 70), window_("w2", 85, 70)],
  }), T);
  assert.equal(above.fired, false, "a cohort completing follow-up MORE often was reported as a gap");
});

test("FOLLOWUP_GAP is not silenced by the missingness it exists to find", () => {
  // THE GUARD THAT COULD NEVER PASS. Follow-up completion IS a missingness
  // measure, so a generic "missingness high" precondition rejects exactly the
  // cohorts this rule is for. Measured on the real population: an authored
  // access barrier produced an 18-point gap and 41% missingness, and the rule
  // was withheld for having the finding.
  //
  // p34 lists missingness under ACCESS_GAP and not under this rule, and this
  // is why.
  const out = evaluateRule("FOLLOWUP_GAP", ctx({
    followup: [window_("w1", 70, 85, { missingness: 0.41 }), window_("w2", 70, 85, { missingness: 0.41 })],
  }), T);
  assert.equal(out.withheld, null, "the rule was silenced by the missingness it measures");
  assert.equal(out.fired, true);

  // The other two preconditions still apply, because neither is the thing
  // being measured.
  const small = evaluateRule("FOLLOWUP_GAP", ctx({
    followup: [window_("w1", 70, 85), window_("w2", 70, 85, {
      cohort: result({ numerator: 5, denominator: 12, value: 5 / 12 }),
    })],
  }), T);
  assert.match(String(small.withheld), /below the minimum analysis size/);
});

test("FOLLOWUP_GAP is withheld when the due-date logic differs across groups", () => {
  const out = evaluateRule("FOLLOWUP_GAP", ctx({ followupDueLogicDiffers: true }), T);
  assert.match(String(out.withheld), /due-date logic/);
  assert.equal(out.fired, false);
});

test("MODULE_SIGNAL will not fire without an interval estimate", () => {
  // p34's condition is that the confidence interval must not cross zero, and
  // this build computes no confidence interval — `computeObservedChange`
  // reports the observed RANGE and says so, because calling a range an
  // interval estimate promotes the finding a rung on p36's ladder.
  const out = evaluateRule("MODULE_SIGNAL", ctx({ changeIntervalIsConfidence: false }), T);
  assert.match(String(out.withheld), /confidence interval/);
  assert.equal(out.fired, false);

  const changed = evaluateRule("MODULE_SIGNAL", ctx({ exposureDefinitionChanged: true }), T);
  assert.match(String(changed.withheld), /exposure definition/);
});

test("MODULE_SIGNAL is withheld when the interval crosses zero", () => {
  const spanning = ctx({
    change: [
      window_("w1", 70, 85, { cohort: result({ detail: { mean_change: -6, range_low: -12, range_high: 3 } }), reference: result({ detail: { mean_change: -1 } }) }),
      window_("w2", 70, 85, { cohort: result({ detail: { mean_change: -6, range_low: -12, range_high: 3 } }), reference: result({ detail: { mean_change: -1 } }) }),
    ],
  });
  const out = evaluateRule("MODULE_SIGNAL", spanning, T);
  assert.match(String(out.withheld), /crosses zero/);

  // The same difference with an interval entirely below zero fires: mean −6
  // against −1 is a 5-point difference, past the 2-point default, in both
  // windows.
  const clear = ctx({
    change: [
      window_("w1", 70, 85, { cohort: result({ detail: { mean_change: -6, range_low: -12, range_high: -2 } }), reference: result({ detail: { mean_change: -1 } }) }),
      window_("w2", 70, 85, { cohort: result({ detail: { mean_change: -6, range_low: -12, range_high: -2 } }), reference: result({ detail: { mean_change: -1 } }) }),
    ],
  });
  const fired = evaluateRule("MODULE_SIGNAL", clear, T);
  assert.equal(fired.withheld, null);
  assert.equal(fired.fired, true);
  assert.equal(fired.observed.change_difference, -5);
});

test("REGION_CAPACITY fires on a ratio and is withheld without a slot feed", () => {
  // 120 waiting against 80 slots is 1.5, past the 1.2 default.
  const out = evaluateRule("REGION_CAPACITY", ctx(), T);
  assert.equal(out.fired, true);
  assert.equal(out.observed.ratio, 1.5);

  const noFeed = evaluateRule("REGION_CAPACITY", ctx({
    capacity: { demand: 120, openFirstVisitSlots: null, slotDataAsOf: null, asOfAgeDays: null },
  }), T);
  assert.match(String(noFeed.withheld), /no open-slot feed/);

  const stale = evaluateRule("REGION_CAPACITY", ctx({
    capacity: { demand: 120, openFirstVisitSlots: 80, slotDataAsOf: "2026-06-01", asOfAgeDays: 89 },
  }), T);
  assert.match(String(stale.withheld), /89 days old/);
});

test("FAIRNESS_ALERT respects completeness, group size and the protected-attribute condition", () => {
  const fires = evaluateRule("FAIRNESS_ALERT", ctx(), T);
  assert.equal(fires.fired, true, "a 14-point disparity over 40 fully-recorded people did not fire");

  // 60% recorded, against an 80% policy threshold.
  const incomplete = evaluateRule("FAIRNESS_ALERT", ctx({
    fairness: { measure: "follow-up completion", disparityPp: -14, completeness: 0.6, groupSize: 40 },
  }), T);
  assert.match(String(incomplete.withheld), /recorded for 60%/);

  const tooSmall = evaluateRule("FAIRNESS_ALERT", ctx({
    fairness: { measure: "follow-up completion", disparityPp: -14, completeness: 1, groupSize: 12 },
  }), T);
  assert.match(String(tooSmall.withheld), /12 people, below the minimum analysis size/);

  // A region is a reporting dimension, not a protected class.
  const notProtected = evaluateRule("FAIRNESS_ALERT", ctx({ fairness: null }), T);
  assert.match(String(notProtected.withheld), /not defined by a protected attribute/);
});

test("FAIRNESS_ALERT's statement names the measure and the gap, and nothing about the group", () => {
  const out = evaluateRule("FAIRNESS_ALERT", ctx(), T);
  // p43: do not rank races, assign grades to demographic groups, or use red
  // and green labels on protected identities. The statement is generated, so
  // the check is on the template rather than on a reviewer's phrasing.
  for (const banned of ["worst", "best", "poor", "grade", "rank", "underperform", "fails"]) {
    assert.doesNotMatch(out.statement.toLowerCase(), new RegExp(banned),
      `the fairness statement characterises the group: "${banned}"`);
  }
});

test("SAFETY_REVIEW_LOAD is withheld without a classification or a coverage schedule", () => {
  // 90 events against a staffed capacity of 60 is 1.5, past the 1.0 default.
  assert.equal(evaluateRule("SAFETY_REVIEW_LOAD", ctx(), T).fired, true);

  const noSchedule = evaluateRule("SAFETY_REVIEW_LOAD", ctx({
    reviewLoad: { fixedReviewEvents: 90, staffedCapacity: null, classificationComplete: true, coverageScheduleKnown: false },
  }), T);
  assert.match(String(noSchedule.withheld), /staffed coverage schedule/);

  const unclassified = evaluateRule("SAFETY_REVIEW_LOAD", ctx({
    reviewLoad: { fixedReviewEvents: 90, staffedCapacity: 60, classificationComplete: false, coverageScheduleKnown: true },
  }), T);
  assert.match(String(unclassified.withheld), /classification/);
});

test("DATA_QUALITY is never bypassed — no input withholds it", () => {
  // p34 writes "Never bypassed" in this rule's no-output cell. Every
  // degenerate input the other six rules withhold on is fed to this one, and
  // it must return an answer to all of them.
  const degenerate: Partial<RuleContext>[] = [
    { dataQuality: null },
    { followupDueLogicDiffers: true },
    { exposureDefinitionChanged: true },
    { changeIntervalIsConfidence: false },
    { capacity: null },
    { reviewLoad: null },
    { fairness: null },
    { access: [], followup: [], change: [] },
    { access: [window_("w", 1, 1, { cohort: result({ suppressed: true }), missingness: 0.99 })] },
  ];
  for (const over of degenerate) {
    const out = evaluateRule("DATA_QUALITY", ctx(over), T);
    assert.equal(out.withheld, null, `DATA_QUALITY was withheld by ${JSON.stringify(Object.keys(over))}`);
  }
  // And a missing reading is itself a failure, not silence.
  assert.equal(evaluateRule("DATA_QUALITY", ctx({ dataQuality: null }), T).fired, true);
});

test("DATA_QUALITY fires on each of its limits, and blocks the whole release", () => {
  const cases: [string, Partial<RuleContext>["dataQuality"], RegExp][] = [
    ["missingness", { missingness: 0.5, projectionMismatches: 0, driftPp: 0, checksFailed: 0, checksTotal: 3 }, /missingness is 50/],
    ["replay", { missingness: 0.1, projectionMismatches: 4, driftPp: 0, checksFailed: 0, checksTotal: 3 }, /4 rows did not rebuild/],
    ["drift", { missingness: 0.1, projectionMismatches: 0, driftPp: -22, checksFailed: 0, checksTotal: 3 }, /drifted 22/],
    ["manifest", { missingness: 0.1, projectionMismatches: 0, driftPp: 0, checksFailed: 2, checksTotal: 3 }, /2 of 3 manifest checks failed/],
  ];
  for (const [name, dq, expected] of cases) {
    const out = evaluateRule("DATA_QUALITY", ctx({ dataQuality: dq }), T);
    assert.equal(out.fired, true, `${name} did not fire DATA_QUALITY`);
    assert.match(out.statement, expected);
  }

  // p34's output for this rule is "Block planning release", which is a
  // statement about the other six. A dashboard listing them beside a warning
  // would leave a reader to decide how much to discount them.
  const all = evaluateAll(ctx({
    dataQuality: { missingness: 0.9, projectionMismatches: 9, driftPp: 30, checksFailed: 3, checksTotal: 3 },
  }), T);
  assert.equal(all.length, 1, "other rules were evaluated while planning release was blocked");
  assert.equal(all[0].ruleId, "DATA_QUALITY");
});

test("no outcome is ever both withheld and fired", () => {
  // The invariant p34's "no output when" column IS. Checked across a spread of
  // contexts rather than asserted once, because the failure mode is a rule
  // edited later to compute both and let a screen decide.
  const spread: Partial<RuleContext>[] = [
    {}, { followupDueLogicDiffers: true }, { exposureDefinitionChanged: true },
    { changeIntervalIsConfidence: false }, { capacity: null }, { reviewLoad: null },
    { fairness: null }, { access: [] }, { followup: [] }, { change: [] },
    { fairness: { measure: "m", disparityPp: -40, completeness: 0.1, groupSize: 5 } },
    { access: [window_("a", 10, 90, { missingness: 0.9 })] },
  ];
  for (const over of spread) {
    for (const id of RULE_IDS) {
      const out = evaluateRule(id, ctx(over), T);
      assert.ok(!(out.withheld !== null && out.fired),
        `${id} was both withheld and fired on ${JSON.stringify(Object.keys(over))}`);
      if (out.withheld !== null) {
        assert.equal(out.statement, "", `${id} produced a statement while withholding output`);
      }
    }
  }
});

test("evaluateRule refuses an outcome that violates the invariant, rather than passing it on", () => {
  // The enforcement, not the convention. A rule rewritten to return both is
  // caught at the call site — which is the only place a future edit passes
  // through.
  const broken = rule("ACCESS_GAP");
  const original = broken.evaluate;
  try {
    broken.evaluate = () => ({
      ruleId: "ACCESS_GAP", fired: true, withheld: "the cell is suppressed",
      statement: "Observed among this cohort: something.", output: "x",
      observed: {}, threshold: {}, metricRefs: [], limitations: [],
    });
    assert.throws(() => evaluateRule("ACCESS_GAP", ctx(), T), /both withheld and fired/);
  } finally {
    broken.evaluate = original;
  }
});

// ---------------------------------------------------------------------------
// D5 — every threshold has an owner
// ---------------------------------------------------------------------------

/** A threshold source that records what was asked for. This is how the guard
 *  below can tell a rule reading policy from a rule reading a literal: a
 *  hard-coded number reads no key, so it shows up as a threshold nobody
 *  asked for rather than as a diff somebody had to notice. */
function recording(): { source: ThresholdSource; read: Set<string> } {
  const seen = new Set<string>();
  const map = Object.fromEntries(THRESHOLD_DEFAULTS.map((t) => [t.key, t.value]));
  const inner = thresholdsFrom(map);
  return {
    read: seen,
    source: { get: (k) => { seen.add(k); return inner.get(k); }, keys: () => inner.keys() },
  };
}

test("every number a rule compares against is a policy threshold, and every threshold is used", () => {
  const { source, read } = recording();
  // Contexts chosen so each rule reaches its trigger rather than returning at
  // its first precondition — a rule that exits early reads fewer keys, and
  // the guard would pass by not looking.
  for (const over of [
    {},
    { access: [window_("w1", 70, 85, { missingness: 0.9 })] },
    { fairness: { measure: "m", disparityPp: -14, completeness: 0.5, groupSize: 40 } },
    { capacity: { demand: 1, openFirstVisitSlots: 1, slotDataAsOf: "2026-08-01", asOfAgeDays: 60 } },
  ]) {
    for (const id of RULE_IDS) evaluateRule(id, ctx(over), source);
  }

  const declared = new Set(THRESHOLD_DEFAULTS.map((t) => t.key));
  const undeclared = [...read].filter((k) => !declared.has(k));
  assert.deepEqual(undeclared, [], `a rule read a threshold with no policy row: ${undeclared.join(", ")}`);

  const unread = [...declared].filter((k) => !read.has(k));
  assert.deepEqual(unread, [],
    `these thresholds have an owner and an approval date and no rule reads them: ${unread.join(", ")}. ` +
    "A threshold nobody reads is a number somebody will assume is in force.");
});

test("a threshold source refuses an unknown key rather than defaulting", () => {
  // The mechanism the guard above depends on. If `get` returned a default for
  // an unknown key, a rule could read a number that has no owner and the
  // recording guard would see the read and pass.
  assert.throws(() => T.get("no.such.threshold"), /no policy threshold/);
});

test("the thresholds are p34's own values, and each carries its caveat", () => {
  const byKey = Object.fromEntries(THRESHOLD_DEFAULTS.map((t) => [t.key, t]));
  // p34 as printed: 10 points for the access gap, 12 for the follow-up gap,
  // two windows for both repeat conditions.
  assert.equal(byKey["access_gap.difference_pp"].value, 10);
  assert.equal(byKey["followup_gap.difference_pp"].value, 12);
  assert.equal(byKey["access_gap.repeat_windows"].value, 2);
  assert.equal(byKey["module_signal.repeat_windows"].value, 2);
  // p37's internal minimum analysis size, which is a different control from
  // p29's small-cell suppression at 11.
  assert.equal(byKey["analysis.min_denominator"].value, 30);

  for (const t of THRESHOLD_DEFAULTS) {
    assert.ok(t.basis.length > 20, `${t.key} has no stated basis`);
    assert.ok(RULE_IDS.includes(t.ruleId), `${t.key} names a rule that does not exist`);
  }
  // p34's caveat has to reach the reader, so it is on the rows rather than in
  // the handoff only.
  const withCaveat = THRESHOLD_DEFAULTS.filter((t) => /not a validated clinical cutoff/i.test(t.basis));
  assert.ok(withCaveat.length >= 6,
    "p34's product-default caveat is not carried on the numbers it applies to");
});

test("the thresholds have a named owner and an approval date", () => {
  assert.ok(PLANNING_OWNER.name.length > 3, "no owner is recorded for the planning thresholds");
  assert.match(PLANNING_OWNER.approvedAt, /^\d{4}-\d{2}-\d{2}$/, "no approval date is recorded");
  assert.match(THRESHOLD_VERSION, /^planning-thresholds\.\d+\.\d+\.\d+$/);
  assert.match(RULE_VERSION, /^planning-rules\.\d+\.\d+\.\d+$/);
  // The concentration of authority is recorded rather than left to be
  // discovered: p35 separates clinical review from the person who set the
  // numbers, and here one person holds both.
  assert.ok(PLANNING_OWNER.note.length > 40,
    "the owner holds both scopes and nothing says so");
});

// ---------------------------------------------------------------------------
// p36 — the release ladder
// ---------------------------------------------------------------------------

test("p36's five levels are present with their permitted wording", () => {
  assert.equal(LADDER.length, 5);
  assert.equal(ladder(1).permittedWording, "Observed among this cohort");
  assert.equal(ladder(3).permittedWording, "Adjusted association");
  assert.equal(ladder(4).permittedWording, "Estimated effect under stated assumptions");
  assert.equal(ladder(5).permittedWording, "Pilot effect estimate");
  assert.throws(() => ladder(6), /defines 1 through 5/);
  assert.match(NO_RACE_CORRECTION, /prohibited/i);
});

test("every statement a rule produces passes its own release level", () => {
  const statements: string[] = [];
  for (const over of [{}, { capacity: { demand: 500, openFirstVisitSlots: 10, slotDataAsOf: "2026-08-28", asOfAgeDays: 0 } }]) {
    for (const id of RULE_IDS) {
      const out = evaluateRule(id, ctx(over), T);
      if (out.fired) statements.push(out.statement);
    }
  }
  assert.ok(statements.length >= 4, "not enough rules fired to check their wording");
  for (const s of statements) {
    assert.equal(wordingViolation(s, CURRENT_LEVEL), null, `overclaiming statement: ${s}`);
  }
});

test("a statement that claims causation is refused rather than rendered", () => {
  assert.match(String(wordingViolation("Follow-up completion improves in this cohort.", 1)),
    /must open with/);
  assert.match(String(wordingViolation("Observed among this cohort: the module caused the change.", 1)),
    /claims causation/);
  // Level 4 permits an effect claim under stated assumptions, so the same
  // vocabulary is not banned everywhere — a ladder with one rung is not a
  // ladder.
  assert.equal(wordingViolation("Estimated effect under stated assumptions: a 3-point difference.", 4), null);
});

test("buildSignal refuses to assemble a signal whose statement overclaims", () => {
  const c = cohort("spanish_preferred.v1");
  const good = evaluateRule("FOLLOWUP_GAP", ctx(), T);
  assert.ok(buildSignal({
    outcome: good, cohort: c, cohortHash: cohortHash(c), referenceId: ALL_ELIGIBLE.id,
    tenantId: "t", dataVersion: "demo-population-v1", detectedAt: "2026-08-29T00:00:00Z", role: "reviewer",
  }).signal_id.startsWith("sig-"));

  assert.throws(() => buildSignal({
    outcome: { ...good, statement: "Follow-up completion was reduced by the reminder change." },
    cohort: c, cohortHash: cohortHash(c), referenceId: ALL_ELIGIBLE.id,
    tenantId: "t", dataVersion: "demo-population-v1", detectedAt: "2026-08-29T00:00:00Z", role: "reviewer",
  }), /release ladder/);
});

// ---------------------------------------------------------------------------
// p35 — the state machine
// ---------------------------------------------------------------------------

test("p35's eight states are present, with their entry and allowed activity", () => {
  assert.equal(STATES.length, 8);
  assert.deepEqual(STATES.map((s) => s.state), [...SIGNAL_STATES]);
  for (const s of STATES) {
    assert.ok(s.entry.length > 5, `${s.state} has no entry condition`);
    assert.ok(s.allowedActivity.length > 5, `${s.state} has no allowed activity`);
  }
  // p35: "No reactivation; create new version."
  assert.deepEqual(stateDef("retired").exits, []);
  assert.equal(stateDef("retired").terminal, true);
  // p35's exit cell for Analysis requested names one thing.
  assert.deepEqual(stateDef("analysis_requested").exits, ["return_with_evidence"]);
});

test("every exit action leads somewhere, and a rejected signal retires", () => {
  const routing = { affectsProgramContent: true, protectedGroupImpact: true };
  for (const s of STATES) {
    for (const a of s.exits) {
      const to = transition(s.state, a, routing);
      assert.notEqual(to, null, `${a} from ${s.state} leads nowhere`);
      assert.ok(SIGNAL_STATES.includes(to as SignalState), `${a} from ${s.state} leads outside the machine`);
    }
  }
  assert.equal(transition("draft", "reject", routing), "retired");
  assert.equal(transition("clinical_review", "reject", routing), "retired");
  assert.equal(transition("decision_recorded", "archive", routing), "retired");
  // An action that is not an exit from this state is refused, not improvised.
  assert.equal(transition("retired", "advance", routing), null);
  assert.equal(transition("draft", "approve", routing), null);
});

test("advance routes by p35's entry conditions rather than by a fixed order", () => {
  const both = { affectsProgramContent: true, protectedGroupImpact: true };
  const neither = { affectsProgramContent: false, protectedGroupImpact: false };
  const fairnessOnly = { affectsProgramContent: false, protectedGroupImpact: true };

  assert.equal(advanceTarget("draft", both), "clinical_review");
  assert.equal(advanceTarget("clinical_review", both), "fairness_review");
  assert.equal(advanceTarget("fairness_review", both), "pilot_proposed");
  // A capacity signal touches no programme content and no protected group, so
  // it needs neither review — that is what p35's entry conditions mean.
  assert.equal(advanceTarget("draft", neither), "pilot_proposed");
  assert.equal(advanceTarget("draft", fairnessOnly), "fairness_review");
  assert.equal(advanceTarget("pilot_proposed", both), null);
});

test("a fairness signal cannot skip fairness review", () => {
  const c = cohort("spanish_preferred.v1");
  assert.equal(cohortIsProtected(c), true);
  const r = routingFor("FAIRNESS_ALERT", c);
  assert.equal(r.protectedGroupImpact, true);
  // From draft, its only forward move reaches fairness review — directly or
  // through clinical review first, never past it.
  const path: SignalState[] = [];
  let s: SignalState | null = "draft";
  while (s && path.length < 6) {
    path.push(s);
    s = advanceTarget(s, r);
  }
  assert.ok(path.includes("fairness_review"), `a protected-group signal advanced past fairness review: ${path.join(" → ")}`);

  // And a region cohort is not treated as a protected group.
  assert.equal(cohortIsProtected(cohort("south_age_55_64.v1")), false);
});

// ---------------------------------------------------------------------------
// p49 — the server supplies the action set
// ---------------------------------------------------------------------------

test("no allowed action is ever a blocked action, for any state and any role", () => {
  const routings = [
    { affectsProgramContent: true, protectedGroupImpact: true },
    { affectsProgramContent: false, protectedGroupImpact: false },
  ];
  let checked = 0;
  for (const state of SIGNAL_STATES) {
    for (const role of ROLES) {
      for (const r of routings) {
        const allowed = allowedActions(state, role, r) as string[];
        for (const b of BLOCKED_ACTIONS) {
          assert.ok(!allowed.includes(b), `${role} may ${b} on a ${state} signal`);
        }
        checked += 1;
      }
    }
  }
  assert.equal(checked, SIGNAL_STATES.length * ROLES.length * routings.length);
  for (const b of BLOCKED_ACTIONS) assert.equal(isBlockedAction(b), true);
  assert.equal(isBlockedAction("reject"), false);
});

test("only the roles p50 grants planning_review may move a signal", () => {
  const r = { affectsProgramContent: true, protectedGroupImpact: true };
  for (const role of ["member", "clinician", "organization", "payer"] as Role[]) {
    assert.equal(mayTransition(role), false, `${role} may transition a planning signal`);
    assert.deepEqual(allowedActions("draft", role, r), [],
      `${role} was offered actions on a planning signal`);
    assert.equal(actionPermitted("draft", role, r, "reject"), false);
  }
  for (const role of ["reviewer", "demo_admin"] as Role[]) {
    assert.ok(allowedActions("draft", role, r).length > 0, `${role} was offered nothing`);
  }
});

test("a draft offers exactly p44's four actions", () => {
  const r = { affectsProgramContent: true, protectedGroupImpact: true };
  assert.deepEqual(
    allowedActions("draft", "reviewer", r).sort(),
    ["assign_owner", "propose_pilot", "reject", "request_analysis"],
  );
  // p49's worked object carries the same list.
  for (const a of allowedActions("draft", "reviewer", r)) {
    assert.ok(ACTION_LABELS[a], `${a} has no label`);
  }
});

test("an action that was not offered is refused by the same computation that offered the rest", () => {
  const r = { affectsProgramContent: true, protectedGroupImpact: true };
  assert.equal(actionPermitted("draft", "reviewer", r, "approve"), false);
  assert.equal(actionPermitted("draft", "reviewer", r, "reject"), true);
  assert.equal(actionPermitted("retired", "reviewer", r, "advance"), false);
  assert.equal(actionPermitted("draft", "reviewer", r, "route_person"), false);
});

test("the clinical-review sign-off is a check, not an assumption", () => {
  // The owner signs clinical review as well as the thresholds, so a reviewer
  // may advance out of that state. The point of the assertion is that the
  // permission is derived from the recorded scope rather than hard-coded — the
  // day the two roles separate, one function changes.
  const r = { affectsProgramContent: true, protectedGroupImpact: false };
  assert.ok(PLANNING_OWNER.scope.includes("clinical_review"));
  assert.ok(allowedActions("clinical_review", "reviewer", r).includes("advance"));
});

test("the signal object carries p44's required phrase and p49's fields", () => {
  const c = cohort("spanish_preferred.v1");
  const out = evaluateRule("FOLLOWUP_GAP", ctx(), T);
  const s = buildSignal({
    outcome: out, cohort: c, cohortHash: cohortHash(c), referenceId: ALL_ELIGIBLE.id,
    tenantId: "t", dataVersion: "demo-population-v1", detectedAt: "2026-08-29T00:00:00Z", role: "reviewer",
  });
  // p49's object, field for field.
  for (const k of [
    "signal_id", "signal_type", "state", "statement", "rule_version", "metric_refs",
    "cohort_ref", "threshold", "observed", "limitations", "allowed_actions",
    "blocked_actions", "clinical_review", "fairness_review", "audit_ref",
  ]) {
    assert.ok(k in s, `the signal object is missing p49's ${k}`);
  }
  assert.equal(s.required_phrase, REQUIRED_PHRASE);
  assert.deepEqual([...s.blocked_actions], [...BLOCKED_ACTIONS]);
  assert.ok(s.limitations.includes("fabricated data"));
  assert.equal(s.audit_ref, `audit://${s.signal_id}`);
});

test("p44's required phrase is the handoff's sentence, not a paraphrase", () => {
  assert.equal(
    REQUIRED_PHRASE,
    "This is a planning hypothesis based on the stated cohort and data window. It is not a " +
    "diagnosis, treatment order or proof that the observed factor caused the result.",
  );
});

test("a signal whose cohort has left the registry does not lose its fairness routing", () => {
  // The fail-safe. `buildSignal` derives routing from the cohort it is given,
  // and a stored signal whose cohort has since been retired is rebuilt with a
  // stub that has no filters — so a derived routing reports no protected-group
  // impact, and the signal is offered an advance straight past fairness
  // review because somebody deleted its definition.
  const stub = {
    id: "gone.v1", version: "unknown", label: "gone", question: "",
    eligibility: {}, filters: {},
  };
  const out = evaluateRule("FOLLOWUP_GAP", ctx(), T);
  const args = {
    outcome: out, cohort: stub, cohortHash: "0".repeat(16), referenceId: ALL_ELIGIBLE.id,
    tenantId: "t", dataVersion: "demo-population-v1", detectedAt: "2026-08-29T00:00:00Z",
    state: "draft" as SignalState, role: "reviewer" as Role,
  };

  // Derived from the stub: no protected-group impact, so an advance from draft
  // would reach pilot_proposed.
  const derived = buildSignal(args);
  assert.equal(advanceTarget("draft", routingFor("FOLLOWUP_GAP", stub)), "pilot_proposed");
  assert.ok(derived.allowed_actions.includes("propose_pilot"));

  // With the safe routing passed in, the same signal advances into review
  // instead.
  const safe = buildSignal({
    ...args, routing: { affectsProgramContent: true, protectedGroupImpact: true },
  });
  assert.equal(
    advanceTarget("draft", { affectsProgramContent: true, protectedGroupImpact: true }),
    "clinical_review",
  );
  assert.ok(safe.allowed_actions.includes("propose_pilot"));

  // Where the fail-safe is actually ENFORCED is `recordReview`, which resolves
  // the cohort itself and defaults the same way — checked behaviourally
  // further down. The `routing` argument here keeps the object a screen reads
  // consistent with the transition the server will allow; it is not the guard
  // on its own, and this test does not pretend it is.
});

test("a signal id is derived, so re-detection is idempotent", () => {
  const a = signalId("FOLLOWUP_GAP", "spanish_preferred.v1", "demo-population-v1", "t");
  const b = signalId("FOLLOWUP_GAP", "spanish_preferred.v1", "demo-population-v1", "t");
  assert.equal(a, b);
  assert.notEqual(a, signalId("FOLLOWUP_GAP", "spanish_preferred.v1", "demo-population-v2", "t"));
  assert.notEqual(a, signalId("ACCESS_GAP", "spanish_preferred.v1", "demo-population-v1", "t"));
  assert.notEqual(a, signalId("FOLLOWUP_GAP", "region_south.v1", "demo-population-v1", "t"));
});

// ---------------------------------------------------------------------------
// Wave 6's exit evidence: no person-level actions
// ---------------------------------------------------------------------------

test("nothing in the planning engine reaches a person", () => {
  // p46 gives this service "versioned aggregate triggers and signal lifecycle"
  // and denies it "safety gates or person routing". The subject of every query
  // is a cohort. The one individual named anywhere is the REVIEWER on a
  // transition, which is an accountability record, so `actor_id` is permitted
  // and nothing else is.
  const offenders: string[] = [];
  for (const f of walk("src/lib/planning")) {
    const src = code(read(f));
    for (const [pattern, what] of [
      [/\bperson_id\b|\bpersonId\b/, "a person id"],
      [/\buser_id\b|\buserId\b/, "a user id"],
      [/\bdisplay_name\b|\bdisplayName\b/, "a person's name"],
    ] as [RegExp, string][]) {
      if (pattern.test(src)) offenders.push(`${f} — names ${what}`);
    }
  }
  assert.deepEqual(offenders, [],
    "the planning engine reached for a person:\n  " + offenders.join("\n  "));
});

test("the planning engine cannot import the systems that act on a person", () => {
  // p35: no state transition changes a patient's permitted activity. Enforced
  // by what this directory cannot reach, rather than by what it declines to
  // do — a transition writes one row, and there is no code path from that row
  // to a gate because the gate is not importable from here.
  const banned = [
    "@/lib/safety", "@/lib/gating", "@/lib/member", "@/lib/clinical",
    "@/lib/actions", "@/lib/entitlements", "@/lib/autopilot",
  ];
  const offenders: string[] = [];
  for (const f of walk("src/lib/planning")) {
    const src = read(f);
    for (const b of banned) {
      if (new RegExp(`from "${b}(/|")`).test(src)) offenders.push(`${f} imports ${b}`);
    }
  }
  assert.deepEqual(offenders, [],
    "the planning engine imported a system that acts on a person:\n  " + offenders.join("\n  "));
});

test("the detail screen renders the server's action set rather than one of its own", () => {
  // p49: the client never invents or widens the action set. A page that listed
  // four buttons and let the server sort it out would be inventing one —
  // correctly today, and for exactly as long as nobody adds a fifth.
  const src = read("src/app/review/planning/[id]/page.tsx");
  assert.match(src, /signal\.allowed_actions\.map/,
    "the detail page does not render the server's action list");
  const body = code(src);
  for (const a of ["reject", "request_analysis", "propose_pilot", "approve", "revise"]) {
    assert.doesNotMatch(body, new RegExp(`["']${a}["']`),
      `the detail page names the action "${a}" itself instead of rendering what the server allowed`);
  }
  // And the blocked actions are shown, because p44 gives them a section.
  assert.match(src, /BLOCKED_ACTIONS/);
});

test("the review route re-checks the action on the server", () => {
  const src = read("src/app/api/planning/signals/[id]/review/route.ts");
  assert.match(src, /recordReview/,
    "the review route does not go through the function that re-derives the permitted set");
  assert.doesNotMatch(code(src), /allowed_actions/,
    "the review route reads an action list off the request instead of computing one");
  // A blocked action gets its own status, because "not from this state" and
  // "this system does not do that" are different answers.
  assert.match(src, /status: 403/);
});

test("the planning screens carry the required phrase", () => {
  for (const f of ["src/app/review/planning/page.tsx", "src/app/review/planning/[id]/page.tsx"]) {
    const src = read(f);
    assert.ok(
      /REQUIRED_PHRASE/.test(src) || /required_phrase/.test(src),
      `${f} does not render p44's required phrase`,
    );
  }
});

// ---------------------------------------------------------------------------
// Against a real database
// ---------------------------------------------------------------------------

import { getDb } from "../src/lib/db";
import { data } from "../src/lib/data";
import { seedPolicyThresholds, loadThresholdRecords, loadThresholds } from "../src/lib/planning/policy";
import { detectSignals, getSignal, listSignals, recordReview, signalHistory, signalLineage } from "../src/lib/planning/service";
import { PLANNING_TENANT_ID, populationTenantIds, readableSignalTenants } from "../src/lib/planning/scope";

test("the policy table refuses a quiet edit and refuses a delete", async () => {
  const db = getDb();
  seedPolicyThresholds(db);

  // p34: "prevent quiet edits". Enforced by the schema, not by a code path
  // that happens to be the only writer today.
  assert.throws(
    () => db.prepare("UPDATE policy_thresholds SET value = 99 WHERE key = ?").run("followup_gap.difference_pp"),
    /append-only/,
    "a threshold's value could be changed in place, leaving the owner and approval date attached to a number they never approved",
  );
  assert.throws(
    () => db.prepare("UPDATE policy_thresholds SET owner = 'somebody else' WHERE key = ?").run("followup_gap.difference_pp"),
    /append-only/,
  );
  assert.throws(
    () => db.prepare("DELETE FROM policy_thresholds WHERE key = ?").run("followup_gap.difference_pp"),
    /append-only/,
  );

  // Superseding IS permitted — that is how a threshold changes. The old row
  // stays readable so a signal raised under it can still be read against the
  // number that was in force.
  db.prepare("UPDATE policy_thresholds SET superseded_at = '2026-09-01' WHERE key = ?")
    .run("data_quality.max_drift_pp");
  const live = await loadThresholdRecords();
  assert.ok(!live.some((r) => r.key === "data_quality.max_drift_pp"), "a superseded row is still in force");
  db.prepare("UPDATE policy_thresholds SET superseded_at = NULL WHERE key = ?")
    .run("data_quality.max_drift_pp");
});

test("seeding is insert-if-absent, so a redeploy cannot overwrite an owner", () => {
  const db = getDb();
  seedPolicyThresholds(db);
  const before = seedPolicyThresholds(db);
  assert.equal(before.inserted, 0, "a second boot re-wrote rows that already carried an owner and a date");
});

test("every threshold in the table carries an owner and an approval date", async () => {
  getDb();
  const records = await loadThresholdRecords();
  assert.equal(records.length, THRESHOLD_DEFAULTS.length);
  for (const r of records) {
    assert.ok(r.owner.length > 3, `${r.key} has no owner`);
    assert.match(r.approvedAt, /^\d{4}-\d{2}-\d{2}$/, `${r.key} has no approval date`);
    assert.equal(r.owner, PLANNING_OWNER.name);
  }
});

test("no rule may fire against an empty policy table", async () => {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM policy_thresholds").all() as Record<string, unknown>[];
  db.prepare("DROP TRIGGER IF EXISTS policy_thresholds_no_delete").run();
  db.prepare("DELETE FROM policy_thresholds").run();
  try {
    // A fallback to the defaults in the source would make the owner record
    // optional in practice while appearing mandatory in the schema — the rules
    // would fire on unowned numbers and nothing would say so.
    await assert.rejects(() => loadThresholds(), /policy_thresholds is empty/);
  } finally {
    const ins = db.prepare(
      `INSERT INTO policy_thresholds (key, version, rule_id, value, unit, owner, approved_at, basis, superseded_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const r of rows) {
      ins.run(r.key, r.version, r.rule_id, r.value, r.unit, r.owner, r.approved_at, r.basis, r.superseded_at, r.created_at);
    }
    db.exec(`CREATE TRIGGER IF NOT EXISTS policy_thresholds_no_delete
      BEFORE DELETE ON policy_thresholds
      BEGIN
        SELECT RAISE(ABORT, 'policy_thresholds is append-only: a threshold is superseded, never deleted');
      END;`);
  }
});

test("detection over the fabricated population raises signals, and repeats produce no new ones", async () => {
  getDb();
  const first = await detectSignals(populationTenantIds(), PLANNING_TENANT_ID, "reviewer");
  assert.ok(first.signals.length > 0,
    "no rule fired on the 240 — the planning screens have never had anything to render");

  // Every signal that fired is an aggregate finding with a cohort behind it.
  for (const s of first.signals) {
    assert.ok(s.cohort_ref.length > 0);
    assert.equal(s.state, "draft");
    assert.equal(s.evidence_level, CURRENT_LEVEL);
    assert.equal(wordingViolation(s.statement, s.evidence_level), null);
  }

  // p34's no-output column, evaluated rather than described. Three rules have
  // no input in this deployment and each names the one it does not have.
  const reasons = Object.fromEntries(first.withheld.map((w) => [w.ruleId, w.reason]));
  assert.match(String(reasons.REGION_CAPACITY), /open-slot feed/);
  assert.match(String(reasons.SAFETY_REVIEW_LOAD), /coverage schedule/);
  assert.match(String(reasons.MODULE_SIGNAL), /confidence interval/);

  // Ids derive from the rule, the cohort and the dataset version, so a second
  // pass re-raises nothing.
  const before = await listSignals([PLANNING_TENANT_ID], "reviewer");
  await detectSignals(populationTenantIds(), PLANNING_TENANT_ID, "reviewer");
  const after = await listSignals([PLANNING_TENANT_ID], "reviewer");
  assert.equal(after.length, before.length, "re-running detection duplicated the signals");
  assert.deepEqual(after.map((s) => s.signal_id), before.map((s) => s.signal_id));
});

test("a signal moves through p35's machine, and every step is audited", async () => {
  getDb();
  await detectSignals(populationTenantIds(), PLANNING_TENANT_ID, "reviewer");
  const signals = await listSignals([PLANNING_TENANT_ID], "reviewer");
  const target = signals.find((s) => s.state === "draft");
  assert.ok(target, "no draft signal to review");

  const c = await data();
  const reviewer = (await c.get("SELECT id FROM users WHERE role = 'reviewer' LIMIT 1", [])) as
    { id: string } | undefined;
  assert.ok(reviewer, "no reviewer account exists");

  const countAudit = async () => Number(((await c.get(
    "SELECT COUNT(*) AS n FROM audit_log WHERE event_type = 'planning_signal_state_changed'", [],
  )) as { n: number }).n);
  const auditBefore = await countAudit();

  const moved = await recordReview({
    signalId: target!.signal_id, tenantIds: [PLANNING_TENANT_ID],
    actorId: reviewer!.id, role: "reviewer", action: "propose_pilot",
    comment: "Reviewed the cohort definition and the missingness breakdown.",
  });
  assert.equal(moved.ok, true, `the transition was refused: ${JSON.stringify(moved)}`);

  const after = await getSignal(target!.signal_id, [PLANNING_TENANT_ID], "reviewer");
  assert.notEqual(after!.state, "draft", "the signal did not move");
  assert.equal(await countAudit(), auditBefore + 1, "the state change was not audited");

  const history = await signalHistory(target!.signal_id, [PLANNING_TENANT_ID]);
  assert.ok(history.length >= 1);
  assert.equal(history[history.length - 1].fromState, "draft");
  assert.equal(history[history.length - 1].actorRole, "reviewer");

  // The action set moved with the state, and it came from the server.
  assert.notDeepEqual(after!.allowed_actions, target!.allowed_actions);
  assert.ok(!after!.allowed_actions.some((a) => (BLOCKED_ACTIONS as readonly string[]).includes(a)));
});

test("a blocked action is refused and recorded, and changes nothing", async () => {
  getDb();
  await detectSignals(populationTenantIds(), PLANNING_TENANT_ID, "reviewer");
  const signals = await listSignals([PLANNING_TENANT_ID], "reviewer");
  assert.ok(signals.length > 0);
  const s = signals[0];

  const c = await data();
  const reviewer = (await c.get("SELECT id FROM users WHERE role = 'reviewer' LIMIT 1", [])) as { id: string };

  for (const blocked of BLOCKED_ACTIONS) {
    const out = await recordReview({
      signalId: s.signal_id, tenantIds: [PLANNING_TENANT_ID],
      actorId: reviewer.id, role: "reviewer", action: blocked,
    });
    assert.equal(out.ok, false);
    assert.equal((out as { reason: string }).reason, "blocked", `${blocked} was not refused as blocked`);
  }
  const recorded = Number(((await c.get(
    "SELECT COUNT(*) AS n FROM audit_log WHERE event_type = 'planning_blocked_action'", [],
  )) as { n: number }).n);
  assert.ok(recorded >= BLOCKED_ACTIONS.length, "an attempt at a blocked action was refused silently");

  // And the signal is where it was.
  const unchanged = await getSignal(s.signal_id, [PLANNING_TENANT_ID], "reviewer");
  assert.equal(unchanged!.state, s.state);
});

test("a role without planning authority is offered nothing and can do nothing", async () => {
  getDb();
  await detectSignals(populationTenantIds(), PLANNING_TENANT_ID, "reviewer");
  const signals = await listSignals([PLANNING_TENANT_ID], "payer");
  for (const s of signals) {
    assert.deepEqual(s.allowed_actions, [], "a payer was offered an action on a planning signal");
  }
  // And the scope resolves to nothing, so the console is closed rather than
  // empty — a different answer, and the one the screen checks.
  for (const role of ["member", "clinician", "organization", "payer"] as Role[]) {
    assert.deepEqual(readableSignalTenants(role), [], `${role} can read stored planning signals`);
  }
  for (const role of ["reviewer", "demo_admin"] as Role[]) {
    assert.deepEqual(readableSignalTenants(role), [PLANNING_TENANT_ID]);
  }
});

test("a stored signal whose cohort has been retired is still routed through review", async () => {
  // A signal is filed with a cohort id that is not in the registry — which is
  // what a retired cohort looks like from the database's side. `recordReview`
  // resolves the cohort to decide where an advance goes, and a cohort it
  // cannot resolve has no filters: routing derived from it reports no
  // protected-group impact, and the signal walks straight to a pilot because
  // somebody deleted its definition. It defaults the other way instead, and
  // this is the test that says so — verified by flipping that default, which
  // fails it.
  getDb();
  const c = await data();
  const id = "sig-retiredcohort";
  await c.run(
    `INSERT INTO planning_signals
       (id, tenant_id, signal_type, state, rule_version, evidence_level, statement,
        cohort_ref, cohort_hash, reference_ref, threshold_json, observed_json,
        metric_refs_json, limitations_json, detected_at, data_version)
     VALUES (?, ?, 'FOLLOWUP_GAP', 'draft', ?, 1, ?, 'retired_cohort.v1', ?, 'all_eligible.v1',
             '{}', '{}', '[]', '[]', '2026-08-29T00:00:00Z', 'demo-population-v1')
     ON CONFLICT(id) DO NOTHING`,
    [id, PLANNING_TENANT_ID, RULE_VERSION,
     "Observed among this cohort: follow-up completion is lower.", "0".repeat(16)],
  );

  const s = await getSignal(id, [PLANNING_TENANT_ID], "reviewer");
  assert.ok(s, "the signal did not rebuild");
  // It advances into a review state, not past one. Derived from the stub
  // cohort — which has no filters — the routing would report no
  // protected-group impact and send it straight to pilot_proposed.
  const reached = advanceTarget("draft", { affectsProgramContent: true, protectedGroupImpact: true });
  assert.equal(reached, "clinical_review");
  assert.ok(s!.allowed_actions.includes("propose_pilot"));

  const reviewer = (await c.get("SELECT id FROM users WHERE role = 'reviewer' LIMIT 1", [])) as { id: string };
  const moved = await recordReview({
    signalId: id, tenantIds: [PLANNING_TENANT_ID],
    actorId: reviewer.id, role: "reviewer", action: "propose_pilot",
  });
  assert.equal(moved.ok, true);
  const after = await getSignal(id, [PLANNING_TENANT_ID], "reviewer");
  assert.notEqual(after!.state, "pilot_proposed",
    "a signal whose cohort was retired skipped review on its way to a pilot");
  assert.ok(["clinical_review", "fairness_review"].includes(after!.state), after!.state);
});

test("lineage returns definitions and evidence, and no person", async () => {
  getDb();
  await detectSignals(populationTenantIds(), PLANNING_TENANT_ID, "reviewer");
  const signals = await listSignals([PLANNING_TENANT_ID], "reviewer");
  const l = await signalLineage(signals[0].signal_id, [PLANNING_TENANT_ID], "reviewer");
  assert.ok(l);
  assert.equal(l!.required_phrase, REQUIRED_PHRASE);
  assert.ok("filters" in l!.cohort, "the lineage does not return the executable cohort definition");
  assert.ok(Object.keys(l!.threshold).length > 0, "the lineage does not say what was compared against");

  // Minimum necessary: everything here is about a cohort or about a
  // reviewer's decision. Serialised and checked, because a field added later
  // is exactly how a person leaks into a response nobody re-reads.
  const json = JSON.stringify(l);
  for (const banned of ["person_id", "personId", "display_name", "email"]) {
    assert.doesNotMatch(json, new RegExp(banned), `the lineage response carries ${banned}`);
  }
});
