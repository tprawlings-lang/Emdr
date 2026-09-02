// The metric dictionary and its arithmetic (handoff 07 §3.2 p32, §3.3 p33,
// §5.3 p48, §6.1 p52).
//
// p52's exit evidence for Wave 5 is "metric fixtures match hand calculations",
// and the emphasis matters. A metric checked against its own implementation is
// checked against nothing: the test and the code make the same mistake and
// agree about it. So the fixtures below are TINY and the expected answers are
// worked out in the comments, in arithmetic anyone can follow without running
// the code.
//
// The generated population is used separately, for invariants — that
// denominators are consistent, that missingness sums, that eligibility is
// resolved before group filters. p53 is explicit that the 240 are scenario
// fixtures and "a test population is not a substitute for test assertions".

process.env.EMDR_DATA_DIR = `/tmp/steady-metrics-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "metrics-test-secret-at-least-32-characters";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "metrics-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { METRICS, metric } from "../src/lib/metrics/dictionary";
import {
  COHORTS, ALL_ELIGIBLE, cohort, cohortHash, assertNoActivityInEligibility,
  regionCohorts, type CohortDefinition,
} from "../src/lib/metrics/cohorts";
import {
  suppressExternal,
  computeActivation, computeWeeklyEngagement, computeModuleCompletion,
  computeFollowupCompletion, computeObservedChange, computeResponderRate,
  computeSafetyPauseRate, computeTimeToReview, computeRetention,
  eligible, inGroup, resolve,
  type Observation, type ComputeContext,
} from "../src/lib/metrics/compute";

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

const CTX: ComputeContext = {
  window: { start: "2026-03-01", end: "2026-08-28" },
  dataVersion: "demo-population-v1",
  projectionVersion: "population_metrics.v2",
  refreshedAt: "2026-08-29T12:00:00Z",
  lineageRef: "lineage://metric-run-0092",
  responderThreshold: 5,
};

/** A person with nothing happening, so each fixture below sets ONLY the fields
 *  its own arithmetic depends on and the rest cannot influence the answer. */
function person(over: Partial<Observation> = {}): Observation {
  return {
    personId: "p", region: "South", ageBand: "55-64", language: "English",
    race: ["White"], ethnicity: "Not Hispanic/Latino", tenantId: "t",
    accessNeeds: [], hasAccount: true,
    daysEnrolled: 180, daysToFirstAction: null, enrolledInWindow: true,
    activeWeeks: 0, observedWeeks: 26, daysToLastAction: null,
    modulesStarted: 0, modulesCompleted: 0,
    measuresComplete: 0, measuresPartial: 0, measuresDeclined: 0,
    measuresUnavailable: 0, measuresSkipped: 0, measuresInterrupted: 0, measuresNotDue: 0,
    baseline: null, followUp: null,
    hadFixedPause: false, reviewLatencyHours: [],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Hand calculations
// ---------------------------------------------------------------------------

test("HAND: activation counts only people whose seven days have elapsed", () => {
  // Five people:
  //   A  enrolled 180d, acted on day 2   → activated
  //   B  enrolled 180d, acted on day 7   → activated (7 is within 7)
  //   C  enrolled 180d, acted on day 8   → NOT activated
  //   D  enrolled 180d, never acted      → NOT activated
  //   E  enrolled 3d,   acted on day 1   → EXCLUDED, window has not elapsed
  //
  // Denominator = 4 (A B C D). Numerator = 2 (A B). 2/4 = 0.5.
  const rows = [
    person({ personId: "A", daysToFirstAction: 2 }),
    person({ personId: "B", daysToFirstAction: 7 }),
    person({ personId: "C", daysToFirstAction: 8 }),
    person({ personId: "D", daysToFirstAction: null }),
    person({ personId: "E", daysEnrolled: 3, daysToFirstAction: 1 }),
  ];
  const r = computeActivation(rows, ALL_ELIGIBLE, CTX);
  assert.equal(r.denominator, 4, "someone whose window has not elapsed was counted as a failure");
  assert.equal(r.numerator, 2);
  assert.equal(r.value, 0.5);
  assert.equal(r.missing.excluded_window_not_elapsed, 1);
});

test("HAND: weekly engagement keeps non-users in the denominator", () => {
  // p33's rule, as arithmetic. Three people over 10 observed weeks each:
  //   A active 8 weeks
  //   B active 2 weeks
  //   C active 0 weeks   ← the one a flattering implementation drops
  //
  // Denominator = 30 person-weeks. Numerator = 10. 10/30 = 0.3333…
  // Dropping C gives 10/20 = 0.5, which is the same programme reported 50%
  // better.
  const rows = [
    person({ personId: "A", activeWeeks: 8, observedWeeks: 10 }),
    person({ personId: "B", activeWeeks: 2, observedWeeks: 10 }),
    person({ personId: "C", activeWeeks: 0, observedWeeks: 10 }),
  ];
  const r = computeWeeklyEngagement(rows, ALL_ELIGIBLE, CTX);
  assert.equal(r.denominator, 30);
  assert.equal(r.numerator, 10);
  assert.equal(Math.round(r.value! * 10000) / 10000, 0.3333);
  assert.equal(r.missing.people_with_no_active_week, 1,
    "the person with no active week is invisible, so nobody can tell they were counted");
});

test("HAND: module completion reports abandonment as the remainder", () => {
  // A: 10 started, 7 completed.  B: 5 started, 1 completed.
  // Started = 15, completed = 8, abandoned = 7. 8/15 = 0.5333…
  const rows = [
    person({ personId: "A", modulesStarted: 10, modulesCompleted: 7 }),
    person({ personId: "B", modulesStarted: 5, modulesCompleted: 1 }),
  ];
  const r = computeModuleCompletion(rows, ALL_ELIGIBLE, CTX);
  assert.equal(r.denominator, 15);
  assert.equal(r.numerator, 8);
  assert.equal(r.missing.abandoned, 7);
  assert.equal(Math.round(r.value! * 10000) / 10000, 0.5333);
});

test("HAND: follow-up completion excludes not-due, and keeps six reasons apart", () => {
  // One person: 6 complete, 2 partial, 1 declined, 1 unavailable, 1 skipped,
  // 1 interrupted, 4 not due.
  //
  // DUE = 6 + 2 + 1 + 1 + 1 + 1 = 12. Not-due is not a missed measure, and
  // folding it in would give 6/16 = 0.375 — the same coverage reported as
  // worse the longer someone is enrolled.
  //
  // 6/12 = 0.5.
  //
  // The six reasons stay apart. A refusal, an omission and an outage are
  // different facts, and squeezing them into p32's five display states meant
  // relabelling somebody's skipped measure as unavailable — which made
  // "unavailable" the largest category by construction and pointed an
  // investigation at the delivery pipeline.
  const rows = [person({
    measuresComplete: 6, measuresPartial: 2, measuresDeclined: 1,
    measuresUnavailable: 1, measuresSkipped: 1, measuresInterrupted: 1, measuresNotDue: 4,
  })];
  const r = computeFollowupCompletion(rows, ALL_ELIGIBLE, CTX);
  assert.equal(r.denominator, 12);
  assert.equal(r.numerator, 6);
  assert.equal(r.value, 0.5);
  assert.equal(r.missing.partial, 2);
  assert.equal(r.missing.declined, 1);
  assert.equal(r.missing.unavailable, 1);
  assert.equal(r.missing.skipped, 1);
  assert.equal(r.missing.interrupted, 1);
  assert.equal(r.missing.not_due, 4);
  // The six that came due sum to the denominator, so nothing is dropped.
  const due = r.numerator + r.missing.partial + r.missing.declined +
    r.missing.unavailable + r.missing.skipped + r.missing.interrupted;
  assert.equal(due, r.denominator, "the missingness breakdown does not sum to the denominator");
});

test("HAND: observed change is computed over paired observations only", () => {
  // A: 20 → 12  (−8)
  // B: 15 → 15  ( 0)
  // C: 10 → 14  (+4)
  // D: baseline 18, no follow-up → UNPAIRED, excluded from the change
  //
  // Paired n = 3. Sum = −8 + 0 + 4 = −4. Mean = −4/3 = −1.3333 → −1.33.
  // Sorted deltas [−8, 0, 4] → median 0. Range −8 to +4.
  const rows = [
    person({ personId: "A", baseline: 20, followUp: 12 }),
    person({ personId: "B", baseline: 15, followUp: 15 }),
    person({ personId: "C", baseline: 10, followUp: 14 }),
    person({ personId: "D", baseline: 18, followUp: null }),
  ];
  const r = computeObservedChange(rows, ALL_ELIGIBLE, CTX);
  assert.equal(r.detail.paired_n, 3);
  assert.equal(r.detail.mean_change, -1.33);
  assert.equal(r.detail.median_change, 0);
  assert.equal(r.detail.range_low, -8);
  assert.equal(r.detail.range_high, 4);
  assert.equal(r.missing.unpaired, 1);
});

test("HAND: the responder threshold is a DROP, and the boundary is inclusive", () => {
  // Threshold 5 — a fall of at least five points.
  //   A 20 → 15  (drop 5)  → responder, the boundary case
  //   B 20 → 16  (drop 4)  → not
  //   C 20 →  9  (drop 11) → responder
  //   D 10 → 14  (rose 4)  → not
  //
  // Paired = 4, responders = 2. 2/4 = 0.5.
  const rows = [
    person({ personId: "A", baseline: 20, followUp: 15 }),
    person({ personId: "B", baseline: 20, followUp: 16 }),
    person({ personId: "C", baseline: 20, followUp: 9 }),
    person({ personId: "D", baseline: 10, followUp: 14 }),
  ];
  const r = computeResponderRate(rows, ALL_ELIGIBLE, CTX);
  assert.equal(r.denominator, 4);
  assert.equal(r.numerator, 2);
  assert.equal(r.value, 0.5);
  assert.equal(r.detail.threshold, 5);
  // The sign convention is stated, because a metric whose direction is
  // implicit gets inverted eventually and nothing notices.
  assert.match(String(r.detail.threshold_basis), /not a validated clinical cutoff/);
});

test("HAND: safety pause rate is over ACTIVE people, not everyone enrolled", () => {
  // A active, paused.  B active, not paused.  C active, not paused.
  // D enrolled but never active → excluded from both halves.
  //
  // Active = 3, paused = 1. 1/3 = 0.3333. Including D gives 1/4 = 0.25, which
  // reports a lower pause rate by counting people who could not have been
  // paused because they never used anything.
  const rows = [
    person({ personId: "A", activeWeeks: 4, hadFixedPause: true }),
    person({ personId: "B", activeWeeks: 4 }),
    person({ personId: "C", activeWeeks: 1 }),
    person({ personId: "D", activeWeeks: 0 }),
  ];
  const r = computeSafetyPauseRate(rows, ALL_ELIGIBLE, CTX);
  assert.equal(r.denominator, 3);
  assert.equal(r.numerator, 1);
  assert.equal(Math.round(r.value! * 10000) / 10000, 0.3333);
  assert.equal(r.missing.inactive_excluded, 1);
});

test("HAND: time to review reports median and p90 by nearest rank", () => {
  // Latencies, in hours: 2, 4, 6, 8, 100  (five episodes across two people).
  // Sorted: [2, 4, 6, 8, 100]. Odd count → median is the third value, 6.
  // p90 nearest-rank: ceil(0.9 × 5) = 5 → the fifth value, 100.
  //
  // The mean would be 24 and would describe nobody. That is why p32 asks for a
  // median and a percentile rather than an average.
  const rows = [
    person({ personId: "A", reviewLatencyHours: [2, 4, 6] }),
    person({ personId: "B", reviewLatencyHours: [8, 100] }),
  ];
  const r = computeTimeToReview(rows, ALL_ELIGIBLE, CTX);
  assert.equal(r.detail.median_hours, 6);
  assert.equal(r.detail.p90_hours, 100);
  assert.equal(r.numerator, 5, "the episode count is wrong");
});

test("HAND: retention censors people whose window has not elapsed", () => {
  // Retention at day 90:
  //   A enrolled 180d, last action day 120 → retained
  //   B enrolled 180d, last action day  40 → not retained
  //   C enrolled 180d, never acted         → not retained
  //   D enrolled  50d, last action day  45 → CENSORED, cannot be observed at 90
  //
  // Observable = 3. Retained = 1. 1/3 = 0.3333.
  // Counting D as lost gives 1/4 = 0.25 — the classic survival error, and the
  // reason the last milestone always looks worst when it is made.
  const rows = [
    person({ personId: "A", daysToLastAction: 120 }),
    person({ personId: "B", daysToLastAction: 40 }),
    person({ personId: "C", daysToLastAction: null }),
    person({ personId: "D", daysEnrolled: 50, daysToLastAction: 45 }),
  ];
  const r = computeRetention(rows, ALL_ELIGIBLE, CTX, 90);
  assert.equal(r.denominator, 3);
  assert.equal(r.numerator, 1);
  assert.equal(Math.round(r.value! * 10000) / 10000, 0.3333);
  assert.equal(r.missing.censored_window_not_elapsed, 1);
  // Three observed against one censored, so the rate describes the cohort.
  assert.equal(r.detail.mostly_censored, "false");
});

test("HAND: a mostly-censored milestone says so rather than reporting a low rate", () => {
  // Retention at day 180 over people who mostly enrolled last month. Two are
  // observable, five are not. 0 of 2 is arithmetically a 0% rate and reads as
  // a finding; it is not one, and the flag is what a chart reads to draw it as
  // pending. The demo window is 180 days, so this is the real shape of that
  // milestone on this dataset rather than a contrived case.
  const rows = [
    person({ personId: "A", daysEnrolled: 181, daysToLastAction: 100 }),
    person({ personId: "B", daysEnrolled: 181, daysToLastAction: 20 }),
    ...Array.from({ length: 5 }, (_, i) => person({ personId: `c${i}`, daysEnrolled: 30, daysToLastAction: 25 })),
  ];
  const r = computeRetention(rows, ALL_ELIGIBLE, CTX, 180);
  assert.equal(r.denominator, 2);
  assert.equal(r.missing.censored_window_not_elapsed, 5);
  assert.equal(r.detail.mostly_censored, "true",
    "a milestone with more censored than observed people reports a rate as if it were a result");
});

test("HAND: an empty denominator is null, never zero per cent", () => {
  // Nobody paired. 0/0 is not 0% — "nobody qualified" and "nobody succeeded"
  // are different answers, and a chart drawing 0% reports a failure that did
  // not happen.
  const r = computeResponderRate([person({ baseline: null, followUp: null })], ALL_ELIGIBLE, CTX);
  assert.equal(r.denominator, 0);
  assert.equal(r.value, null);
});

test("HAND: a numerator below the small-cell threshold is suppressed at the boundary", () => {
  // Nine responders out of forty. Nine is below eleven, so the numerator is
  // withheld — and the DENOMINATOR survives, or the suppression itself becomes
  // invisible and the reader cannot tell a withheld cell from a missing one.
  //
  // Suppression is applied by `suppressExternal`, not by the computation.
  // p29 scopes it to "aggregate external views": it decides what may be shown
  // to someone outside, not what is true. Folding it into the arithmetic makes
  // every internal check read a withheld value instead of the answer, which is
  // how a suppression bug hides behind the suppression.
  const rows = [
    ...Array.from({ length: 9 }, (_, i) => person({ personId: `r${i}`, baseline: 20, followUp: 10 })),
    ...Array.from({ length: 31 }, (_, i) => person({ personId: `n${i}`, baseline: 20, followUp: 20 })),
  ];
  const raw = computeResponderRate(rows, ALL_ELIGIBLE, CTX);
  assert.equal(raw.numerator, 9, "the computation itself withheld a value");
  assert.equal(raw.value, 0.225, "9/40 = 0.225");

  const r = suppressExternal(raw);
  assert.equal(r.suppressed, true);
  assert.equal(r.denominator, 40, "the denominator was suppressed too, hiding the suppression");
  assert.equal(r.value, null, "a suppressed count still produced a rate, which reveals it");
  assert.equal(r.numerator, -1, "the suppressed count is still readable");
});

// ---------------------------------------------------------------------------
// p33's cohort rules
// ---------------------------------------------------------------------------

test("eligibility is resolved before group filters", () => {
  // Two people in the South, one of whom has no account.
  const rows = [
    person({ personId: "A", region: "South", hasAccount: true }),
    person({ personId: "B", region: "South", hasAccount: false }),
    person({ personId: "C", region: "West", hasAccount: true }),
  ];
  const c = cohort("south_age_55_64.v1");
  assert.equal(eligible(rows, c).length, 2, "eligibility did not drop the account-less person");
  assert.equal(inGroup(eligible(rows, c), c).length, 1);
  assert.equal(resolve(rows, c).length, 1);
});

test("a cohort cannot resolve eligibility on an activity", () => {
  // p33's rule, made structural. Filter to people who engaged, then report
  // engagement, and the number is near 100% and meaningless.
  assert.throws(
    () => assertNoActivityInEligibility({
      id: "bad.v1", version: "1.0.0", label: "bad", question: "?",
      eligibility: { requiresAccount: true, hasCheckIn: true } as never,
      filters: {},
    }),
    /reports the thing being measured as its own denominator/,
  );
  // And every registered cohort passes.
  for (const c of [...COHORTS, ...regionCohorts()]) assertNoActivityInEligibility(c);
});

test("a cohort's hash changes when any part of its definition does", () => {
  // p33: "a dashboard link opens the exact cohort definition". A hash is how
  // "is this the same cohort as last quarter" becomes a comparison rather than
  // a memory.
  const a = cohort("south_age_55_64.v1");
  const b: CohortDefinition = { ...a, filters: { ...a.filters, ageBand: ["45-54"] } };
  assert.notEqual(cohortHash(a), cohortHash(b));
  assert.equal(cohortHash(a), cohortHash(cohort("south_age_55_64.v1")), "the hash is not stable");
});

test("every result carries its cohort, so two metrics cannot share a denominator by accident", () => {
  // p33: "do not reuse one denominator across measures unless the definitions
  // are identical."
  const rows = [person({ baseline: 20, followUp: 10, measuresComplete: 3 })];
  const a = computeResponderRate(rows, cohort("south_age_55_64.v1"), CTX);
  const b = computeFollowupCompletion(rows, ALL_ELIGIBLE, CTX);
  assert.notEqual(a.cohort_id, b.cohort_id);
  assert.notEqual(a.cohort_hash, b.cohort_hash);
});

// ---------------------------------------------------------------------------
// p48's response contract
// ---------------------------------------------------------------------------

test("every result carries every field p48's response names", () => {
  const r = computeActivation([person({ daysToFirstAction: 1 })], ALL_ELIGIBLE, CTX);
  for (const field of [
    "metric_id", "cohort_id", "window", "grain", "numerator", "denominator",
    "value", "missing", "suppressed", "status", "data_version", "metric_version",
    "projection_version", "refreshed_at", "lineage_ref",
  ]) {
    assert.ok(field in r, `the response has no ${field}`);
  }
  // p48: "if a required definition, denominator, version or refresh time is
  // missing, the chart renders a failed state rather than a number." That is
  // only possible if they are always present to be checked.
  assert.ok(r.metric_version && r.projection_version && r.data_version && r.refreshed_at);
});

test("the dictionary declares all ten metrics, each with its required display", () => {
  assert.equal(METRICS.length, 10, "p32 names ten metrics");
  for (const m of METRICS) {
    assert.ok(m.requiredDisplay.length > 0, `${m.id} says nothing about what must be shown`);
    assert.ok(m.notA.length > 20, `${m.id} does not say what it must not be read as`);
    assert.match(m.version, /^\d+\.\d+\.\d+$/, `${m.id} has no semantic version`);
  }
  // Exactly one modelled metric, and it is the cost one. p32 requires observed
  // and modelled values to be shown separately, and the status field is what a
  // chart reads to pick the register.
  const modelled = METRICS.filter((m) => m.status === "modeled");
  assert.deepEqual(modelled.map((m) => m.id), ["estimated_cost.v1"]);
});

test("the safety pause metric says on itself that it is not a risk score", () => {
  // §29.1 forbids a predictive risk score, and this is the metric most likely
  // to be mistaken for one — a per-person rate of a bad outcome.
  const m = metric("safety_pause_rate.v1");
  assert.match(m.notA, /predicted risk score/i);
  assert.ok(m.requiredDisplay.some((d) => /rule version/i.test(d)),
    "the rule version is not required, so a rate cannot be tied to the rules that produced it");
});

test("no metric is computed anywhere but the dictionary's functions", () => {
  // p48: "the client does not calculate clinical or business metrics from raw
  // records." The rule this codebase can actually enforce is narrower and
  // still useful: a metric's arithmetic lives in one file, so a second
  // definition of "engagement" cannot appear in a component.
  const compute = read("src/lib/metrics/compute.ts");
  assert.match(compute, /export function computeActivation/);
  const views = ["src/components/app/PopulationOverviewView.tsx"];
  for (const v of views) {
    const src = read(v).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
    assert.doesNotMatch(src, /\/\s*data\.\w+\.of|\* 100\b/,
      `${v} computes a rate from raw fields instead of reading a metric result`);
  }
});

// ---------------------------------------------------------------------------
// Invariants over the generated population
// ---------------------------------------------------------------------------
//
// The hand calculations above check the arithmetic. These check the layer that
// turns rows into observations — which the hand calculations cannot reach,
// because they never touch a database. Neither half could catch both kinds of
// mistake, which is why the computation is pure and the loading is separate.

import { getDb } from "../src/lib/db";
import { loadObservations, metricContext, RESPONDER_THRESHOLD } from "../src/lib/metrics/population-metrics";
import { populationTenants } from "../src/lib/intelligence/population";

async function population(): Promise<Observation[]> {
  getDb();
  return loadObservations(await populationTenants());
}

test("POPULATION: every missingness breakdown sums to its denominator", async () => {
  // The property that makes a chart's slices trustworthy: if they do not sum,
  // somebody is being dropped and no total will say so.
  const rows = await population();
  const ctx = metricContext("test");
  const f = computeFollowupCompletion(rows, ALL_ELIGIBLE, ctx);
  const due = f.numerator + f.missing.partial + f.missing.declined +
    f.missing.unavailable + f.missing.skipped + f.missing.interrupted;
  assert.equal(due, f.denominator,
    `the six due states sum to ${due} against a denominator of ${f.denominator}`);

  const m = computeModuleCompletion(rows, ALL_ELIGIBLE, ctx);
  assert.equal(m.numerator + m.missing.abandoned, m.denominator);
});

test("POPULATION: a subgroup's denominator never exceeds the whole cohort's", async () => {
  // p33: "do not reuse one denominator across measures unless the definitions
  // are identical." The weaker check available here is containment — a
  // subgroup that reports MORE people than the population it is drawn from
  // means the group filter is running before eligibility, or not at all.
  const rows = await population();
  const ctx = metricContext("test");
  const all = computeFollowupCompletion(rows, ALL_ELIGIBLE, ctx);
  for (const c of regionCohorts()) {
    const r = computeFollowupCompletion(rows, c, ctx);
    assert.ok(r.denominator <= all.denominator,
      `${c.label} reports ${r.denominator} due measures against ${all.denominator} for everyone`);
    assert.ok(r.denominator > 0, `${c.label} is empty, so the cohort filter matches nothing`);
  }
  // And the regions partition the population: their denominators sum to the
  // whole, because every person has exactly one region.
  const sum = regionCohorts().reduce(
    (s, c) => s + computeFollowupCompletion(rows, c, ctx).denominator, 0);
  assert.equal(sum, all.denominator,
    `the four regions account for ${sum} due measures out of ${all.denominator}`);
});

test("POPULATION: engagement counts weeks nobody was active in", async () => {
  // p33's rule against the real data. If the denominator were people-who-acted
  // rather than observed person-weeks, the rate would be near 100%.
  const rows = await population();
  const r = computeWeeklyEngagement(rows, ALL_ELIGIBLE, metricContext("test"));
  assert.ok(r.denominator > rows.length,
    "the denominator is smaller than one week per person, so weeks are not being counted");
  assert.ok(r.value !== null && r.value < 0.98,
    `weekly engagement reports ${((r.value ?? 0) * 100).toFixed(1)}% — a rate that high usually ` +
    "means the denominator was filtered to people who engaged");
});

test("POPULATION: the responder rate is a subset of the paired population", async () => {
  const rows = await population();
  const ctx = metricContext("test");
  const change = computeObservedChange(rows, ALL_ELIGIBLE, ctx);
  const responders = computeResponderRate(rows, ALL_ELIGIBLE, ctx);
  assert.equal(responders.denominator, change.detail.paired_n,
    "the responder rate and the observed change disagree about who is paired");
  assert.ok(responders.numerator <= responders.denominator);
  // And the threshold travels with the number, every time.
  assert.equal(responders.detail.threshold, RESPONDER_THRESHOLD);
});

test("POPULATION: retention at the window's edge is flagged, not reported as zero", async () => {
  // The demo window is 180 days, so day-180 retention is structurally
  // unobservable: nobody can have an action at day 180 of a 180-day window.
  // It reports 0 of 18 with 224 censored, which is arithmetically right and
  // reads as a finding unless something says otherwise.
  const rows = await population();
  const ctx = metricContext("test");
  const late = computeRetention(rows, ALL_ELIGIBLE, ctx, 180);
  assert.equal(late.detail.mostly_censored, "true",
    "day-180 retention on a 180-day window reports a rate with no flag, so 0% reads as a result");

  // The earlier milestones are observable and are not flagged.
  const early = computeRetention(rows, ALL_ELIGIBLE, ctx, 30);
  assert.equal(early.detail.mostly_censored, "false");
  assert.ok(early.denominator > 200, `only ${early.denominator} people are observable at day 30`);
});

test("POPULATION: time to review measures a response to the gate, not the next action", async () => {
  // The first version paired a pause with the next clinician action of any
  // kind, and the median read 593 hours — the average distance between two
  // unrelated things rather than a latency.
  const rows = await population();
  const r = computeTimeToReview(rows, ALL_ELIGIBLE, metricContext("test"));
  assert.ok(r.numerator > 20, `only ${r.numerator} review episodes — the join matches nothing`);
  const median = Number(r.detail.median_hours);
  assert.ok(median > 0 && median < 72,
    `the median review latency is ${median} hours, which is not a response time`);
  assert.ok(Number(r.detail.p90_hours) >= median, "p90 is below the median");
});

test("POPULATION: every observation carries the attributes a cohort filters on", async () => {
  const rows = await population();
  const manifest = rows.filter((r) => r.region !== null);
  assert.ok(manifest.length >= 240, `only ${manifest.length} people carry a region`);
  for (const r of manifest.slice(0, 50)) {
    assert.ok(r.ageBand, `${r.personId} has no age band, so no age cohort can include them`);
    assert.ok(r.language, `${r.personId} has no language`);
    assert.ok(r.observedWeeks > 0, `${r.personId} has no observed weeks, so engagement is 0/0`);
  }
});
