// The detector power analysis (handoff 07 §3.4 p34, §3.7 p37).
//
// A harness that measures how often the planning rules find an effect of known
// size. Everything it reports is only worth having if the harness itself is
// right, so this file checks the harness the way the metrics are checked —
// against arithmetic and against properties that must hold whatever the
// implementation.
//
// The distinction this rests on, and it is the whole reason the harness is
// legitimate where training a care model on the same data would not be: the
// ground truth is PUT IN deliberately, at a stated size, and the question is
// whether the detector finds it. The generator being ours is the experimental
// control, not the confound.

process.env.EMDR_DATA_DIR = `/tmp/steady-power-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "power-test-secret-at-least-32-characters-x";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "power-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import { ALL_ELIGIBLE } from "../src/lib/metrics/cohorts";
import {
  computeActivation, computeFollowupCompletion, metricMissingness,
} from "../src/lib/metrics/compute";
import {
  TEST_COHORT, attenuation, falsePositiveRate, minimumCohortFor, scaledSpec,
  simulateActivation, simulateCompletion, trial,
} from "../src/lib/analysis/power";
import { THRESHOLD_DEFAULTS, thresholdsFrom } from "../src/lib/planning/policy";

const BASE = { measuresPerPerson: 3, baseRate: 0.78 };
const SHARE = 1 / 6;

const CTX = {
  window: { start: "2026-06-04", end: "2026-09-02" },
  dataVersion: "power-analysis", projectionVersion: "power.v1",
  refreshedAt: "2026-09-02T00:00:00Z", lineageRef: "lineage://power",
  responderThreshold: 5,
};

// ---------------------------------------------------------------------------
// The simulator produces what it says it produces
// ---------------------------------------------------------------------------

test("the simulated cohort has the effect size it was asked for", () => {
  // Large n, so sampling noise is small enough to check the mean directly.
  const spec = scaledSpec(BASE, 4000, -12, SHARE);
  const rows = simulateCompletion({ ...spec, seed: 42 });
  const cohort = computeFollowupCompletion(rows, TEST_COHORT, CTX);
  const reference = computeFollowupCompletion(rows, ALL_ELIGIBLE, CTX);

  assert.equal(cohort.denominator, 4000 * 3, "the cohort does not have the measures it was given");
  // The cohort is 1 in 6, so the reference contains it and the observed gap is
  // the true one times (1 − share): −12 × 5/6 = −10.
  const observed = (cohort.value! - reference.value!) * 100;
  assert.ok(Math.abs(observed - -10) < 1.0,
    `observed ${observed.toFixed(2)}pp against an expected −10pp — the simulator is not ` +
    "producing the effect it was asked for, or the attenuation is not what it claims");
  // And the cohort's own rate is the base plus the effect.
  assert.ok(Math.abs(cohort.value! - (0.78 - 0.12)) < 0.01);
});

test("a zero effect produces no difference beyond noise", () => {
  const spec = scaledSpec(BASE, 4000, 0, SHARE);
  const rows = simulateCompletion({ ...spec, seed: 7 });
  const cohort = computeFollowupCompletion(rows, TEST_COHORT, CTX);
  const reference = computeFollowupCompletion(rows, ALL_ELIGIBLE, CTX);
  assert.ok(Math.abs((cohort.value! - reference.value!) * 100) < 1.5,
    "the null case is not null, so every false-positive rate this harness reports is wrong");
});

test("the simulator is deterministic in its seed", () => {
  const a = simulateCompletion({ ...scaledSpec(BASE, 50, -15, SHARE), seed: 99 });
  const b = simulateCompletion({ ...scaledSpec(BASE, 50, -15, SHARE), seed: 99 });
  const c = simulateCompletion({ ...scaledSpec(BASE, 50, -15, SHARE), seed: 100 });
  assert.deepEqual(a.map((r) => r.measuresComplete), b.map((r) => r.measuresComplete));
  assert.notDeepEqual(a.map((r) => r.measuresComplete), c.map((r) => r.measuresComplete),
    "two different seeds produced the same population, so every trial is the same trial");
});

test("attenuation is the cohort's share of the population, stated as arithmetic", () => {
  // A cohort of 60 inside a population of 360 shows 300/360 = 83% of its gap.
  assert.equal(Math.round(attenuation(60, 300) * 100), 83);
  assert.equal(attenuation(100, 100), 0.5);
  assert.ok(attenuation(1, 999) > 0.99);
  // And `scaledSpec` holds it constant, which is what makes a power curve
  // measure power rather than power tangled with attenuation.
  for (const n of [20, 60, 200]) {
    const s = scaledSpec(BASE, n, -12, SHARE);
    assert.ok(Math.abs(attenuation(n, s.referenceSize) - 5 / 6) < 0.02,
      `at cohort ${n} the share moved, so the curve measures two things at once`);
  }
});

// ---------------------------------------------------------------------------
// What the harness reports about the detector
// ---------------------------------------------------------------------------

test("detection rises with the true effect", () => {
  const rates = [-5, -12, -20, -30].map(
    (e) => trial("FOLLOWUP_GAP", scaledSpec(BASE, 60, e, SHARE), 300).detectionRate!);
  for (let i = 1; i < rates.length; i++) {
    assert.ok(rates[i] >= rates[i - 1],
      `detection fell as the effect grew: ${rates.map((r) => r.toFixed(2)).join(", ")}`);
  }
  assert.ok(rates[3] > 0.9, "a 30-point gap is missed more than one time in ten");
});

test("detection rises with cohort size for an effect past the threshold", () => {
  // Past the threshold ONCE ATTENUATED: a true 20pp gap in a cohort that is
  // one in six reads as 16.7pp observed, comfortably past 12. More people
  // should mean a more reliable answer.
  const rates = [30, 60, 200].map(
    (n) => trial("FOLLOWUP_GAP", scaledSpec(BASE, n, -20, SHARE), 300).detectionRate!);
  assert.ok(rates[2] >= rates[0],
    `detection did not improve with cohort size: ${rates.map((r) => r.toFixed(2)).join(", ")}`);
  assert.ok(rates[2] > 0.9);
});

test("an effect that attenuates BELOW the threshold is detected less as n grows", () => {
  // The finding that most changes how a threshold should be read. A true gap
  // of 12pp in a cohort that is one in six reads as 10pp observed, which never
  // crosses a 12-point threshold. At small n, noise pushes some trials past
  // it; as n grows the estimate converges on 10 and detection goes to zero.
  //
  // So the threshold applies to the OBSERVED gap, and the true gap needed to
  // trip it is threshold / (1 − share) — about 14.4pp here, not 12.
  const small = trial("FOLLOWUP_GAP", scaledSpec(BASE, 20, -12, SHARE), 400).detectionRate!;
  const large = trial("FOLLOWUP_GAP", scaledSpec(BASE, 400, -12, SHARE), 400).detectionRate!;
  assert.ok(small > large + 0.1,
    `detection at n=20 was ${small.toFixed(2)} and at n=400 was ${large.toFixed(2)} — the ` +
    "attenuation effect is not present, so the threshold reads as if it applied to the true gap");
});

test("the false-positive rate is low, and it is a measured number rather than an assumption", () => {
  // The number that decides whether a signal means anything. A rule that fires
  // on one null cohort in five produces a fairness alert about a group where
  // nothing is happening, and somebody acts on it.
  for (const rule of ["FOLLOWUP_GAP", "ACCESS_GAP"] as const) {
    for (const n of [40, 200]) {
      const p = falsePositiveRate(rule, n, BASE, 500, undefined, SHARE);
      assert.ok(p.evaluated > 0, `${rule} could not run at all at n=${n}`);
      assert.ok(p.detectionRate! < 0.05,
        `${rule} fires on ${(p.detectionRate! * 100).toFixed(1)}% of cohorts with no true ` +
        "difference at all");
    }
  }
});

test("below the minimum analysis size the answer is 'withheld', not a low rate", () => {
  // p37's minimum is a refusal to compare, and a harness that averaged those
  // trials in with the ones that ran would report a rule as insensitive when
  // it was actually never asked.
  const tiny = trial("ACCESS_GAP", scaledSpec(BASE, 20, -30, SHARE), 200);
  assert.ok(tiny.withholdRate > 0.9,
    `a 20-person cohort was compared ${((1 - tiny.withholdRate) * 100).toFixed(0)}% of the time`);
  const enough = trial("ACCESS_GAP", scaledSpec(BASE, 60, -30, SHARE), 200);
  assert.ok(enough.withholdRate < 0.1, "a 60-person cohort is being withheld");
  assert.ok(enough.detectionRate! > 0.8, "a 30-point activation gap is missed at n=60");
});

test("the minimum cohort for a target detection rate is reported, or honestly not", () => {
  const easy = minimumCohortFor("FOLLOWUP_GAP", -25, 0.8, [20, 30, 60, 200], BASE, 200, undefined, SHARE);
  assert.ok(easy !== null && easy <= 60, `a 25-point gap needs ${easy} people to detect`);
  // And an effect that attenuates below the threshold is never reliably
  // detected at any size, which the function says by returning null rather
  // than by returning the largest size it tried.
  const impossible = minimumCohortFor("FOLLOWUP_GAP", -12, 0.8, [20, 30, 60, 200], BASE, 200, undefined, SHARE);
  assert.equal(impossible, null,
    "a true gap that reads as 10pp is reported as reliably detectable by a 12pp threshold");
});

// ---------------------------------------------------------------------------
// The harness measures the real detector
// ---------------------------------------------------------------------------

test("missingness is a property of the metric, not of which keys happen to be set", () => {
  // THE BUG THE POWER ANALYSIS FOUND, and it was in the production path rather
  // than in the harness. `metricMissingness` inferred its formula from whether
  // any exclusion key was non-zero, so when nothing was excluded it fell
  // through to "what did not complete" — which for ACTIVATION is the
  // non-activation rate. A cohort with genuinely poor activation therefore
  // read as a cohort with missing data, and ACCESS_GAP withheld instead of
  // firing. Invisible in a code review; a row of zeros in a power table.
  const rows = simulateActivation({ ...scaledSpec(BASE, 200, -30, SHARE), seed: 3 });
  const activation = computeActivation(rows, TEST_COHORT, CTX);
  assert.ok(activation.value! < 0.55, "the simulated activation gap is not present");
  assert.equal(metricMissingness(activation), 0,
    "a cohort where everybody's window has elapsed reports missing data, so the rule that " +
    "reads it will withhold exactly when it has something to say");

  // Follow-up completion is a completion rate, so what did not complete IS
  // what is missing — the same function, a different answer, on purpose.
  const completion = computeFollowupCompletion(
    simulateCompletion({ ...scaledSpec(BASE, 200, -30, SHARE), seed: 3 }), TEST_COHORT, CTX);
  assert.ok(metricMissingness(completion) > 0.3);
});

test("the harness evaluates the real rules against the real thresholds", () => {
  // A reimplementation would measure a reimplementation. Checked by moving a
  // threshold and requiring the reported power to move with it.
  const map = Object.fromEntries(THRESHOLD_DEFAULTS.map((t) => [t.key, t.value]));

  const strict = trial("FOLLOWUP_GAP", scaledSpec(BASE, 60, -20, SHARE), 200,
    thresholdsFrom({ ...map, "followup_gap.difference_pp": 30 }));
  const loose = trial("FOLLOWUP_GAP", scaledSpec(BASE, 60, -20, SHARE), 200,
    thresholdsFrom({ ...map, "followup_gap.difference_pp": 5 }));
  assert.ok(loose.detectionRate! > strict.detectionRate!,
    "moving the threshold did not move the reported power, so the harness is not reading it");
});
