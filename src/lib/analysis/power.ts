import { ALL_ELIGIBLE, type CohortDefinition } from "@/lib/metrics/cohorts";
import type { MetricResult, Observation } from "@/lib/metrics/compute";
import {
  computeActivation, computeFollowupCompletion, metricMissingness,
} from "@/lib/metrics/compute";
import { evaluateRule, type RuleContext, type WindowReading } from "@/lib/planning/rules";
import { defaultThresholds, type RuleId, type ThresholdSource } from "@/lib/planning/policy";

// Detector power analysis.
//
// THE QUESTION THIS ANSWERS, and it is a question about the DETECTOR rather
// than about anybody's health:
//
//   Given a real difference of size E in a cohort of size N, how often does
//   this rule find it? And when there is no difference at all, how often does
//   it fire anyway?
//
// Those two numbers — sensitivity and false-positive rate — decide whether a
// signal on the planning console means anything. Nobody currently knows
// either, and a fairness alert whose false-positive rate is unknown is a
// fairness alert nobody can act on.
//
// WHY THIS IS SOUND WHERE TRAINING A CARE MODEL ON THE SAME DATA WOULD NOT BE.
// The 240 behave the way they do because of magnitudes chosen in
// `demo-population-disparity.ts`. A model trained on their output learns those
// magnitudes; it cannot recover parameters nobody put in. This module does the
// opposite: it puts an effect in DELIBERATELY, at a size it states, and
// measures whether the detector finds it. The generator being ours is the
// experimental control rather than the confound — the ground truth has to be
// known for a sensitivity number to mean anything.
//
// WHERE IT LIVES, AND WHY NOT UNDER `planning/`. It constructs `Observation`s,
// which names a person identifier, and `tests/planning.test.ts` fails the
// build on that anywhere under `src/lib/planning`. That guard is right and
// this module is genuinely a third thing: a study OF the detector, belonging
// to neither the metrics that feed it nor the rules that are its subject.

/** Deterministic PRNG. Written out rather than imported from the demo
 *  generator: this module must not depend on the fabricated population, and a
 *  power curve that moved when the seed data changed would be measuring the
 *  wrong thing. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draw k successes from n trials at probability p. Written as n Bernoulli
 *  draws rather than a normal approximation, because the whole point is small
 *  n — an approximation that is only good at large n would be wrong exactly
 *  where the answer matters. */
function binomial(n: number, p: number, rand: () => number): number {
  let k = 0;
  for (let i = 0; i < n; i++) if (rand() < p) k += 1;
  return k;
}

/** The cohort under test is marked by a region nobody else has, so it can be
 *  selected the same way a real cohort is — by a filter on an attribute — and
 *  compared against an eligible population that CONTAINS it, exactly as the
 *  real comparison does. A reference that excluded the cohort would flatter
 *  every effect size. */
const TEST_REGION = "Cohort under test";

export const TEST_COHORT: CohortDefinition = {
  id: "power.test_cohort.v1",
  version: "1.0.0",
  label: "Cohort under test",
  question: "Synthetic cohort for detector power analysis. Not a finding about anybody.",
  eligibility: { requiresAccount: true },
  filters: { region: [TEST_REGION] },
};

export interface SimSpec {
  /** People in the cohort under test. */
  cohortSize: number;
  /**
   * People OUTSIDE the cohort. The eligible population is the sum of the two,
   * and the cohort is compared against that sum — which INCLUDES IT, exactly
   * as the real comparison does.
   *
   * That containment attenuates every effect, and the factor is the cohort's
   * share of the population: a true gap of E reads as E × (1 − n/N). Holding
   * this fixed while the cohort grows therefore measures two things at once
   * and they pull opposite ways — precision improves, attenuation worsens —
   * and the first version of this harness produced a power curve that went
   * DOWN with cohort size. Use `scaledSpec` to hold the share constant, which
   * is what a power analysis wants.
   */
  referenceSize: number;
  /** Follow-up measures that came due, per person, in the window. */
  measuresPerPerson: number;
  /** The reference group's true completion rate. */
  baseRate: number;
  /** The cohort's TRUE difference from the reference, in percentage points.
   *  Signed: −12 means the cohort genuinely completes 12 points less often.
   *  Zero is the null case that produces the false-positive rate. */
  effectPp: number;
  seed: number;
}

function blank(personId: string, region: string): Observation {
  return {
    personId, region, ageBand: "35-44", language: "English", race: [],
    ethnicity: null, tenantId: "t", accessNeeds: [], interpreterNeeded: false,
    state: null, hasAccount: true,
    daysEnrolled: 180, daysToFirstAction: null, enrolledInWindow: true,
    activeWeeks: 0, observedWeeks: 26, daysToLastAction: null,
    modulesStarted: 0, modulesCompleted: 0,
    measuresComplete: 0, measuresPartial: 0, measuresDeclined: 0,
    measuresUnavailable: 0, measuresSkipped: 0, measuresInterrupted: 0,
    measuresNotDue: 0, measuresUndelivered: 0,
    baseline: null, followUp: null, hadFixedPause: false, reviewLatencyHours: [],
  };
}

/** One trial's population, for a completion-rate comparison. */
export function simulateCompletion(spec: SimSpec): Observation[] {
  const rand = mulberry32(spec.seed);
  const rows: Observation[] = [];
  const cohortRate = Math.max(0, Math.min(1, spec.baseRate + spec.effectPp / 100));

  for (let i = 0; i < spec.cohortSize; i++) {
    const done = binomial(spec.measuresPerPerson, cohortRate, rand);
    rows.push({
      ...blank(`c${i}`, TEST_REGION),
      measuresComplete: done,
      // The remainder came due and was not completed, so it lands in the
      // denominator the same way a real miss does.
      measuresSkipped: spec.measuresPerPerson - done,
    });
  }
  for (let i = 0; i < spec.referenceSize; i++) {
    const done = binomial(spec.measuresPerPerson, spec.baseRate, rand);
    rows.push({
      ...blank(`r${i}`, "Elsewhere"),
      measuresComplete: done,
      measuresSkipped: spec.measuresPerPerson - done,
    });
  }
  return rows;
}

/** One trial's population, for a stage-conversion comparison. Activation is a
 *  per-person yes or no rather than a count of measures, so it is its own
 *  simulation rather than a parameter of the one above. */
export function simulateActivation(spec: SimSpec): Observation[] {
  const rand = mulberry32(spec.seed);
  const rows: Observation[] = [];
  const cohortRate = Math.max(0, Math.min(1, spec.baseRate + spec.effectPp / 100));
  const person = (id: string, region: string, rate: number): Observation => ({
    ...blank(id, region),
    // Acted on day 2 or on day 30: within the seven-day window or outside it.
    daysToFirstAction: rand() < rate ? 2 : 30,
  });
  for (let i = 0; i < spec.cohortSize; i++) rows.push(person(`c${i}`, TEST_REGION, cohortRate));
  for (let i = 0; i < spec.referenceSize; i++) rows.push(person(`r${i}`, "Elsewhere", spec.baseRate));
  return rows;
}

const CTX = {
  window: { start: "2026-06-04", end: "2026-09-02" },
  dataVersion: "power-analysis",
  projectionVersion: "power.v1",
  refreshedAt: "2026-09-02T00:00:00Z",
  lineageRef: "lineage://power",
  responderThreshold: 5,
};

function reading(
  rows: Observation[], label: string,
  compute: (r: Observation[], c: CohortDefinition, ctx: typeof CTX) => MetricResult,
): WindowReading {
  const cohort = compute(rows, TEST_COHORT, CTX);
  return {
    label,
    cohort,
    reference: compute(rows, ALL_ELIGIBLE, CTX),
    // THE SERVICE'S OWN FUNCTION, not a copy of it. The first version of this
    // harness reimplemented the formula and got activation wrong in exactly
    // the way the service originally had — returning the non-activation rate,
    // so a cohort with genuinely poor activation read as one with missing data
    // and ACCESS_GAP withheld instead of firing. A power analysis running
    // against a reimplementation measures the reimplementation.
    missingness: metricMissingness(cohort),
  };
}

/** A context carrying only what the rule under test reads. The operational
 *  feeds are null because no rule in this analysis touches them, and a
 *  fabricated capacity reading would put a second effect into an experiment
 *  measuring one. */
function contextFor(access: WindowReading[], followup: WindowReading[]): RuleContext {
  return {
    cohortId: TEST_COHORT.id,
    cohortHash: "power",
    referenceId: ALL_ELIGIBLE.id,
    access, followup, change: [],
    fairness: null, capacity: null, reviewLoad: null,
    dataQuality: { missingness: 0.1, projectionMismatches: 0, driftPp: 0, checksFailed: 0, checksTotal: 3 },
    followupDueLogicDiffers: false,
    exposureDefinitionChanged: false,
    changeIntervalIsConfidence: false,
  };
}

/**
 * A spec at a given cohort size, holding the cohort's SHARE of the population
 * constant.
 *
 * One in six by default, which is roughly what a real cohort here looks like —
 * the Mandarin-preferred group is 40 of 240. Keeping the share fixed isolates
 * statistical power from the attenuation above, so the resulting curve answers
 * the question an analyst is actually asking: how many people do I need.
 */
export function scaledSpec(
  base: Omit<SimSpec, "seed" | "cohortSize" | "effectPp" | "referenceSize">,
  cohortSize: number, effectPp: number, cohortShare = 1 / 6,
): Omit<SimSpec, "seed"> {
  return {
    ...base,
    cohortSize,
    effectPp,
    referenceSize: Math.max(1, Math.round(cohortSize * (1 / cohortShare - 1))),
  };
}

/**
 * How much a cohort's own share of the population flattens the gap it is
 * measured against.
 *
 * Not a limitation of this harness — a property of comparing a group against a
 * population that contains it, and one worth a number: a cohort that is a
 * third of the eligible population cannot show more than two thirds of its own
 * true gap, however large the study.
 */
export function attenuation(cohortSize: number, referenceSize: number): number {
  return referenceSize / (cohortSize + referenceSize);
}

export interface TrialOutcome {
  fired: number;
  withheld: number;
  evaluated: number;
  trials: number;
}

export interface PowerPoint extends TrialOutcome {
  rule: RuleId;
  cohortSize: number;
  effectPp: number;
  /** Of the trials where the rule was ABLE to run, the share that fired.
   *  Separated from the raw rate because "withheld" and "did not trigger" are
   *  different answers and averaging them together hides which limit is
   *  binding — a cohort too small to compare looks identical to one where
   *  there was nothing to find. */
  detectionRate: number | null;
  withholdRate: number;
}

/**
 * Run one cell of the grid: a rule, at an effect size, at a cohort size.
 *
 * The rule is the REAL one, evaluated through `evaluateRule` against the real
 * thresholds. A reimplementation here would measure a reimplementation.
 */
export function trial(
  rule: RuleId, spec: Omit<SimSpec, "seed">, trials: number,
  thresholds: ThresholdSource = defaultThresholds(),
  seed0 = 1,
): PowerPoint {
  let fired = 0;
  let withheld = 0;
  for (let t = 0; t < trials; t++) {
    const seed = seed0 + t * 7919;
    let ctx: RuleContext;
    if (rule === "ACCESS_GAP") {
      // Two windows, drawn independently. p34 requires the gap to hold in both
      // and in the same direction, so a rule that fires on one window's noise
      // is exactly what this measures.
      const w1 = simulateActivation({ ...spec, seed });
      const w2 = simulateActivation({ ...spec, seed: seed + 104729 });
      ctx = contextFor(
        [reading(w1, "w1", computeActivation), reading(w2, "w2", computeActivation)], []);
    } else {
      const rows = simulateCompletion({ ...spec, seed });
      ctx = contextFor([], [reading(rows, "w1", computeFollowupCompletion)]);
    }
    const out = evaluateRule(rule, ctx, thresholds);
    if (out.withheld !== null) withheld += 1;
    else if (out.fired) fired += 1;
  }
  const evaluated = trials - withheld;
  return {
    rule,
    cohortSize: spec.cohortSize,
    effectPp: spec.effectPp,
    fired, withheld, evaluated, trials,
    detectionRate: evaluated === 0 ? null : fired / evaluated,
    withholdRate: withheld / trials,
  };
}

/** The grid. Cohort sizes across the range a 240-person fixture can produce,
 *  and effect sizes either side of p34's thresholds. */
export function powerCurve(
  rule: RuleId,
  cohortSizes: number[],
  effects: number[],
  base: Omit<SimSpec, "seed" | "cohortSize" | "effectPp" | "referenceSize">,
  trials = 300,
  thresholds: ThresholdSource = defaultThresholds(),
  cohortShare = 1 / 6,
): PowerPoint[] {
  const out: PowerPoint[] = [];
  for (const cohortSize of cohortSizes) {
    for (const effectPp of effects) {
      out.push(trial(rule, scaledSpec(base, cohortSize, effectPp, cohortShare), trials, thresholds));
    }
  }
  return out;
}

/**
 * The false-positive rate: how often the rule fires when there is genuinely no
 * difference at all.
 *
 * The number that decides whether a signal means anything. A rule that fires
 * on one null cohort in five is a rule that will produce a fairness alert
 * about a group where nothing is happening, and somebody will act on it.
 */
export function falsePositiveRate(
  rule: RuleId, cohortSize: number,
  base: Omit<SimSpec, "seed" | "cohortSize" | "effectPp" | "referenceSize">,
  trials = 1000,
  thresholds: ThresholdSource = defaultThresholds(),
  cohortShare = 1 / 6,
): PowerPoint {
  return trial(rule, scaledSpec(base, cohortSize, 0, cohortShare), trials, thresholds);
}

/** The smallest cohort at which the rule reaches a stated detection rate for a
 *  stated true effect, or null if it never does within the sizes offered. This
 *  is the number an analyst actually wants: "how many people do I need". */
export function minimumCohortFor(
  rule: RuleId, effectPp: number, targetRate: number,
  cohortSizes: number[],
  base: Omit<SimSpec, "seed" | "cohortSize" | "effectPp" | "referenceSize">,
  trials = 300,
  thresholds: ThresholdSource = defaultThresholds(),
  cohortShare = 1 / 6,
): number | null {
  for (const cohortSize of [...cohortSizes].sort((a, b) => a - b)) {
    const p = trial(rule, scaledSpec(base, cohortSize, effectPp, cohortShare), trials, thresholds);
    if (p.detectionRate !== null && p.detectionRate >= targetRate) return cohortSize;
  }
  return null;
}
