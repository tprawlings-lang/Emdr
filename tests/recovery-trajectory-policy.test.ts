// The recovery-trajectory state machine (expansion handoff 04 §3, §4, §6).
//
// Everything in this file is against `classify`, which is pure: the cutoff and
// the policy are both arguments, so a state can be constructed rather than
// seeded. That is not a testing convenience — it is §13's "trajectory state is
// reproducible from evidence, cutoff, and policy version" being checkable at
// all. A classifier that read a clock inside could not be tested for it.
//
// THE FAILURES THIS FILE IS AIMED AT, each one a way the engine could look
// right and be wrong:
//
//   ONE BAD DAY BECOMING A REVERSAL. §4: "require persistence for
//   slowing/stalled/reversing. One bad day remains one observation." A single
//   extreme reading can move a median far enough to clear a threshold, and the
//   resulting label is indistinguishable from a real reversal on the screen.
//
//   MISSING DATA BECOMING A GOOD READING. The cross-feature invariant:
//   "missing observations do not become zero, normal, compliant, or
//   recovered." A window with two check-ins in it must produce
//   `insufficient_data`, not a confident state computed from two numbers.
//
//   A SCALE READ BACKWARDS. Sleep quality runs the other way from activation,
//   and an engine that applied one direction everywhere would report a person
//   sleeping worse as improving. That failure is silent and it is plausible.
//
//   AN UNCALIBRATED INSTRUMENT GETTING A VERDICT. An instrument with no
//   registered meaningful-change threshold must produce no state, because a
//   generic default would manufacture a clinical judgement wearing the same
//   badge as a real one.
//
//   FUTURE DATA LEAKING IN. Observations after the cutoff must not appear in
//   any window, which is what makes a point-in-time reconstruction honest.
//
//   TWO DOMAINS BEING NETTED OFF. §4: "a patient can improve in one domain and
//   worsen in another. Preserve the disagreement."

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";

import {
  classify, windowStat, median, iqr, improvement,
  isDeviation, DEVIATION_STATES,
  type DomainSeries, type TrajectoryPoint,
} from "../src/lib/clinical/recovery-trajectory";
import {
  TRAJECTORY_POLICY, DOMAIN_META, STATE_LABEL, STATE_NOTE, TRAJECTORY_STATES,
  policyFor, measurePolicy, betterFor, stateLabelFor, stateNoteFor,
  type DomainType,
} from "../src/lib/clinical/trajectory-policy";

const CUTOFF = "2026-09-01T00:00:00.000Z";
const CUTOFF_MS = Date.parse(CUTOFF);
const DAY = 86_400_000;

/** A point `daysAgo` before the cutoff. */
function p(daysAgo: number, value: number, over: Partial<TrajectoryPoint> = {}): TrajectoryPoint {
  return {
    at: new Date(CUTOFF_MS - daysAgo * DAY).toISOString(),
    value,
    evidenceType: "longitudinal_event",
    evidenceId: `ev-${daysAgo}-${value}`,
    reconstructed: false,
    ...over,
  };
}

function series(over: Partial<DomainSeries> = {}): DomainSeries {
  return {
    domainType: "activation",
    domainKey: "activation",
    label: "Activation",
    unit: "0–10",
    better: "lower",
    points: [],
    ...over,
  };
}

/** A run of readings, one every `every` days, starting `from` days ago. */
function run(from: number, count: number, value: number | ((i: number) => number), every = 3): TrajectoryPoint[] {
  return Array.from({ length: count }, (_, i) =>
    p(from - i * every, typeof value === "function" ? value(i) : value)
  );
}

// ---------------------------------------------------------------------------
// The primitives
// ---------------------------------------------------------------------------

test("the centre is a median, never a mean", () => {
  // The sample where they disagree, and where the mean is the wrong answer:
  // four ordinary days and one catastrophic one.
  const values = [3, 3, 4, 3, 10];
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  assert.equal(median(values), 3);
  assert.ok(Math.abs(mean - 4.6) < 0.001, "the mean moves 1.6 on the one bad day");
  assert.notEqual(median(values), mean);
});

test("the IQR needs enough readings to mean anything", () => {
  assert.equal(iqr([1, 2, 3]), null, "three readings do not have quartiles worth reporting");
  assert.equal(iqr([1, 2, 3, 4]), 1.5);
});

test("improvement is signed toward better, whichever way the scale runs", () => {
  // The failure this exists to stop: an engine that applied one direction
  // everywhere would call a person sleeping worse "improving", silently.
  assert.equal(improvement(6, 4, "lower"), 2, "activation falling is improvement");
  assert.equal(improvement(6, 4, "higher"), -2, "sleep quality falling is not");
  assert.equal(improvement(4, 6, "higher"), 2);
  assert.equal(improvement(4, 6, "none"), 0, "a domain with no direction has no improvement");
});

test("a window is half-open and excludes anything after the cutoff", () => {
  const points = [p(-1, 9), p(1, 3), p(5, 3), p(40, 3)];
  const w = windowStat(points, CUTOFF_MS - 21 * DAY, CUTOFF_MS + 1);
  assert.equal(w.n, 2, `future and out-of-window points leaked in: ${w.evidenceIds.join(",")}`);
  assert.ok(!w.evidenceIds.some((id) => id.includes("--1")), "a point after the cutoff was counted");
});

// ---------------------------------------------------------------------------
// Insufficient data (§3)
// ---------------------------------------------------------------------------

test("a thin window is insufficient_data and says what is missing", () => {
  const c = classify(series({ points: run(2, 2, 5) }), { asOf: CUTOFF });
  assert.equal(c.state, "insufficient_data");
  assert.match(c.explanation[0], /observations? in the last 21 days/);
  assert.match(c.explanation[0], /4 are needed/, "§3: say what is missing");
  assert.equal(c.improvementDelta, null, "no delta may be computed below threshold");
});

test("readings crowded into a few days do not span a window", () => {
  // Five readings, all inside four days. Enough observations, not enough time —
  // and a state computed from them would describe one week as a trajectory.
  const c = classify(series({ points: run(3, 5, 5, 1) }), { asOf: CUTOFF });
  assert.equal(c.state, "insufficient_data");
  assert.match(c.explanation[0], /span/i);
  assert.match(c.explanation[0], /one reading taken more than once/);
});

test("a recent picture with nothing before it is insufficient, not stable", () => {
  // The failure: a person who started checking in three weeks ago reads as
  // "holding steady", which is a claim about a course nobody has observed.
  const c = classify(series({ points: run(18, 6, 5) }), { asOf: CUTOFF });
  assert.equal(c.state, "insufficient_data");
  assert.match(c.explanation[0], /nothing comparable to set it against/);
});

// ---------------------------------------------------------------------------
// Persistence (§4)
// ---------------------------------------------------------------------------

test("a meaningful median shift on one adverse observation is not a reversal", () => {
  // THE CASE PERSISTENCE EXISTS FOR, and it is not the same as the median's
  // robustness. On the function domain a window is two accepted observations,
  // so a single goal dropping two rungs while another holds moves the median
  // by a whole rung — past the meaningful threshold — on one adverse reading.
  // §4: "one bad day remains one observation."
  const points = [
    p(70, 0), p(60, 0), // comparison window
    p(35, 0), p(10, -2), // recent: one held, one dropped two rungs
  ];
  const goal = series({
    domainType: "function", domainKey: "goal-1", label: "Back to the shop",
    unit: "goal ladder", better: "higher", points,
  });
  const c = classify(goal, { asOf: CUTOFF });
  const spec = TRAJECTORY_POLICY.domains.function;
  assert.ok(
    c.improvementDelta! <= -spec.meaningfulDelta,
    `the median did move past the threshold: ${c.improvementDelta}`
  );
  assert.equal(c.adverseCount, 1, "exactly one observation moved against");
  assert.notEqual(c.state, "reversing", "one observation named a state");
});

test("one bad day cannot produce a reversal", () => {
  // A stable comparison window, then a recent window that is four ordinary
  // readings and one catastrophic one. The mean would move; the median does
  // not, and the persistence count is 1.
  const points = [
    ...run(40, 6, 3),                       // comparison window: settled
    p(18, 3), p(14, 3), p(10, 10), p(6, 3), p(2, 3), // recent: one bad day
  ];
  const c = classify(series({ points }), { asOf: CUTOFF });
  assert.notEqual(c.state, "reversing", "one observation named a state");
  assert.equal(c.state, "stable");
  assert.ok(c.adverseCount <= 1, `persistence counted ${c.adverseCount} from one bad day`);
});

test("repeated adverse readings do produce a reversal", () => {
  const points = [
    ...run(40, 6, 3),
    ...run(18, 5, 7, 4), // five readings, all four points worse
  ];
  const c = classify(series({ points }), { asOf: CUTOFF });
  assert.equal(c.state, "reversing");
  assert.ok(c.adverseCount >= TRAJECTORY_POLICY.domains.activation.persistence);
  assert.match(c.explanation[1], /individually sit worse/);
});

test("a reversal names what the previous window was doing", () => {
  // §3 describes reversing against "the prior favorable direction". Whether
  // this is a turn or a continuation is reported rather than used to suppress
  // the state — a course that was already declining and keeps declining is
  // still moving the wrong way, and dropping it would file the worse case
  // under nothing.
  const turning = classify(series({ points: [
    ...run(60, 5, 8),      // prior: bad
    ...run(40, 6, 3),      // comparison: much better
    ...run(18, 5, 7, 4),   // recent: worse again
  ] }), { asOf: CUTOFF });
  assert.equal(turning.state, "reversing");
  assert.ok(
    turning.explanation.some((l) => /a turn rather than a continuation/.test(l)),
    turning.explanation.join(" | ")
  );

  const continuing = classify(series({ points: [
    ...run(60, 5, 2),
    ...run(40, 6, 4),
    ...run(18, 5, 8, 4),
  ] }), { asOf: CUTOFF });
  assert.equal(continuing.state, "reversing");
  assert.ok(
    continuing.explanation.some((l) => /already moving this way/.test(l)),
    continuing.explanation.join(" | ")
  );
});

// ---------------------------------------------------------------------------
// The other states (§3)
// ---------------------------------------------------------------------------

test("meaningful favourable movement is improving", () => {
  const c = classify(series({ points: [...run(40, 6, 7), ...run(18, 6, 3)] }), { asOf: CUTOFF });
  assert.equal(c.state, "improving");
  assert.ok(c.improvementDelta! >= TRAJECTORY_POLICY.domains.activation.meaningfulDelta);
});

test("stable does not call itself not-improving", () => {
  const c = classify(series({ points: [...run(40, 6, 5), ...run(18, 6, 5)] }), { asOf: CUTOFF });
  assert.equal(c.state, "stable");
  // §3's display requirement, verbatim: "Do not call 'not improving'."
  const words = [STATE_LABEL.stable, STATE_NOTE.stable, ...c.explanation].join(" ");
  assert.ok(!/not improving|no progress|failed to/i.test(words), words);
  assert.match(STATE_NOTE.stable, /state in its own right/);
});

test("slowing needs three windows and a materially smaller gain", () => {
  // Prior 8 → comparison 4 (gain 4) → recent 3.5 (gain 0.5). The reduction is
  // 3.5, which clears the 1.5 threshold.
  const c = classify(series({ points: [
    ...run(58, 6, 8, 3),
    ...run(40, 6, 4, 3),
    ...run(18, 6, 3.5, 3),
  ] }), { asOf: CUTOFF });
  assert.equal(c.state, "slowing");
  assert.match(c.explanation[1], /previous window gained/);
  assert.match(STATE_NOTE.slowing, /trajectory, not a failure/);
});

test("a course that improves slightly less than before is not slowing", () => {
  // Prior gain 3, recent gain 2. Real, and not a material reduction — an
  // engine without this bound would make every improving course a finding the
  // month it improved a little less.
  const c = classify(series({ points: [
    ...run(58, 6, 8, 3),
    ...run(40, 6, 5, 3),
    ...run(18, 6, 3, 3),
  ] }), { asOf: CUTOFF });
  assert.notEqual(c.state, "slowing");
  assert.equal(c.state, "improving");
});

test("stalled needs three populated windows inside a narrow band", () => {
  const stalled = classify(series({ points: [
    ...run(58, 6, 5, 3),
    ...run(40, 6, 5, 3),
    ...run(18, 6, 5, 3),
  ] }), { asOf: CUTOFF });
  assert.equal(stalled.state, "stalled");
  assert.match(stalled.explanation[1], /stayed between/);

  // The same flatness with only two windows is `stable`, not `stalled`. §3
  // requires "adequate observation density", and a person who has been quiet
  // must not be reported as stuck on the strength of having been quiet.
  const thin = classify(series({ points: [
    ...run(40, 6, 5, 3),
    ...run(18, 6, 5, 3),
  ] }), { asOf: CUTOFF });
  assert.equal(thin.state, "stable");
});

test("a wide swing between flat windows is not a narrow band", () => {
  // Every window's median is 5 and the readings run 1 to 9. A "stalled" label
  // here would describe someone whose weeks are wildly different as stuck.
  const c = classify(series({ points: [
    ...run(58, 6, (i) => (i % 2 ? 1 : 9), 3),
    ...run(40, 6, (i) => (i % 2 ? 1 : 9), 3),
    ...run(18, 6, (i) => (i % 2 ? 1 : 9), 3),
  ] }), { asOf: CUTOFF });
  assert.notEqual(c.state, "stalled");
  assert.ok(
    c.explanation.some((l) => /disagree with each other/.test(l)),
    "the disagreement between readings must be reported: " + c.explanation.join(" | ")
  );
});

// ---------------------------------------------------------------------------
// Direction, calibration and domains with no direction
// ---------------------------------------------------------------------------

test("sleep quality is read the right way up", () => {
  const worse = classify(series({
    domainType: "sleep", domainKey: "sleep", label: "Sleep quality", better: "higher",
    points: [...run(40, 6, 7), ...run(18, 6, 3)],
  }), { asOf: CUTOFF });
  // The identical numbers that read as "improving" on activation.
  assert.equal(worse.state, "reversing", "falling sleep quality was read as improvement");
});

test("an instrument with no registered threshold gets no verdict", () => {
  const c = classify(series({
    domainType: "measure", domainKey: "made-up-scale", label: "MADE-UP", unit: "observed 0–40",
    points: [...run(200, 4, 30, 20), ...run(100, 4, 10, 20)],
  }), { asOf: CUTOFF });
  assert.equal(c.state, "insufficient_data");
  assert.match(c.explanation[0], /no registered meaningful-change threshold/);
  assert.match(c.limitations[0], /still plot/, "the data is not the thing that is missing");
  assert.equal(measurePolicy("made-up-scale"), null);
  assert.ok(measurePolicy("phq-9"), "a registered instrument does have one");
});

test("registered instruments keep their own thresholds, never a shared one", () => {
  const phq = measurePolicy("phq-9")!;
  const pcl = measurePolicy("pcl-5")!;
  assert.notEqual(
    phq.meaningfulDelta, pcl.meaningfulDelta,
    "two points of PHQ-9 and two of PCL-5 are not the same amount of anything"
  );
  assert.equal(betterFor("measure", "phq-9"), "lower");
});

test("engagement is context and can never become a recovery state", () => {
  const busy = classify(series({
    domainType: "engagement", domainKey: "checkins", label: "Check-ins",
    unit: "count", better: "none",
    points: [...run(50, 10, 1, 3), ...run(20, 10, 1, 2)],
  }), { asOf: CUTOFF });
  assert.equal(busy.state, "stable");
  assert.ok(
    busy.explanation.some((l) => /not adherence/.test(l)),
    busy.explanation.join(" | ")
  );
  // §6: "never label an engagement gap as predicted deterioration."
  const quiet = classify(series({
    domainType: "engagement", domainKey: "checkins", label: "Check-ins",
    unit: "count", better: "none",
    points: [...run(50, 10, 1, 3), p(26, 1)],
  }), { asOf: CUTOFF });
  assert.ok(["stable", "insufficient_data"].includes(quiet.state), quiet.state);
  assert.equal(quiet.improvementDelta, null, "a domain with no direction has no delta");
  assert.equal(DOMAIN_META.engagement.signalEligible, false, "§8: engagement is not queue work");
});

// ---------------------------------------------------------------------------
// The invariants
// ---------------------------------------------------------------------------

test("two domains disagreeing both keep their own state", () => {
  // §4: "a patient can improve in one domain and worsen in another. Preserve
  // the disagreement." Classification is per-series, so there is nowhere for a
  // netting-off to happen — this asserts that stays true.
  const better = classify(series({ points: [...run(40, 6, 8), ...run(18, 6, 3)] }), { asOf: CUTOFF });
  const worse = classify(series({
    domainType: "dissociation", domainKey: "dissociation", label: "Dissociation",
    points: [...run(40, 6, 2), ...run(18, 6, 7)],
  }), { asOf: CUTOFF });
  assert.equal(better.state, "improving");
  assert.equal(worse.state, "reversing");
});

test("the same series at the same cutoff classifies identically", () => {
  // §13's reproducibility clause, at the level it is decided.
  const s = series({ points: [...run(40, 6, 7), ...run(18, 6, 3)] });
  const a = classify(s, { asOf: CUTOFF });
  const b = classify(s, { asOf: CUTOFF });
  assert.deepEqual(a, b);
});

test("an earlier cutoff cannot see later observations", () => {
  const points = [...run(40, 6, 7), ...run(18, 6, 3)];
  const later = classify(series({ points }), { asOf: CUTOFF });
  const earlier = classify(series({ points }), {
    asOf: new Date(CUTOFF_MS - 25 * DAY).toISOString(),
  });
  assert.equal(later.state, "improving");
  assert.notEqual(
    earlier.state, "improving",
    "the improving readings had not been recorded yet at the earlier cutoff"
  );
  for (const id of earlier.current.evidenceIds) {
    assert.ok(!points.find((x) => x.evidenceId === id && Date.parse(x.at) > CUTOFF_MS - 25 * DAY));
  }
});

test("reconstructed readings plot and are counted as reconstructed", () => {
  // ADR 0010: reconstructed history is never presented as original evidence.
  // Dropping it would make a sparse record look complete, so it plots — and it
  // is named in the limitations.
  const c = classify(series({
    points: [
      ...run(40, 6, 7),
      ...run(18, 6, 3).map((pt) => ({ ...pt, reconstructed: true })),
    ],
  }), { asOf: CUTOFF });
  assert.ok(c.current.reconstructedCount > 0);
  assert.ok(
    c.limitations.some((l) => /reconstructed after the fact/.test(l)),
    c.limitations.join(" | ")
  );
});

// The defect this exists to stop, caught on the screen: an engagement lane
// reading "Check-ins — Holding steady" beside "19 in the last 28 days, against
// 0 in the 28 days before". The engine has to give it one of the six states
// because the schema constrains them to six, and "stable" then wore a word
// that is a judgement about a course — over a change in how often somebody
// filled in a form.
test("a domain with no direction never wears a recovery word", () => {
  for (const state of TRAJECTORY_STATES) {
    const label = stateLabelFor("engagement", state);
    const note = stateNoteFor("engagement", state);
    assert.ok(
      !/steady|improving|reversing|stalled|slowing|moving/i.test(`${label} ${note}`),
      `engagement wore a recovery word in "${state}": "${label}" / "${note}"`
    );
  }
  // And the domains that DO have a direction still get the real words.
  assert.equal(stateLabelFor("activation", "stable"), STATE_LABEL.stable);
  assert.equal(stateNoteFor("sleep", "reversing"), STATE_NOTE.reversing);
});

test("every state has a label and a note, and no note grades the person", () => {
  for (const state of TRAJECTORY_STATES) {
    assert.ok(STATE_LABEL[state].length > 0, `${state} has no label`);
    assert.ok(STATE_NOTE[state].length > 30, `${state} has no note`);
    const words = `${STATE_LABEL[state]} ${STATE_NOTE[state]}`;
    assert.ok(
      !/off track|non-?compliant|noncompliance|failing|poor progress|doing badly/i.test(words),
      `${state} grades the person: "${words}"`
    );
  }
});

test("every domain has a policy, and the deviation set is the three that ask for a look", () => {
  for (const domain of Object.keys(DOMAIN_META) as DomainType[]) {
    if (domain === "measure") continue; // per instrument, checked above
    assert.ok(policyFor(domain, domain), `${domain} has no policy`);
  }
  assert.deepEqual([...DEVIATION_STATES].sort(), ["reversing", "slowing", "stalled"]);
  assert.ok(isDeviation("reversing"));
  assert.ok(!isDeviation("stable"), "holding steady is not a deviation");
  assert.ok(!isDeviation("improving"));
  assert.ok(!isDeviation("insufficient_data"), "a thin record is not a finding");
});

test("no threshold is a hidden constant — the policy carries them all", () => {
  // §4: "minimum density and thresholds are versioned per domain... must be
  // configuration, not hidden constants." A number written into the engine
  // would change what every stored snapshot meant with nothing recording it.
  const engine = fs.readFileSync("src/lib/clinical/recovery-trajectory.ts", "utf8");
  // Comments discuss numbers at length; only code is checked. `classify` is the
  // whole state machine and nothing else in the file decides a state, so the
  // check is bounded to it — a guard over the whole file would trip on
  // `slice(0, 26)` and be deleted rather than fixed.
  const stripped = engine.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  const start = stripped.indexOf("export function classify");
  const end = stripped.indexOf("// ---", start);
  const body = stripped.slice(start, end);
  assert.ok(body.length > 1000, "the classifier was not found — this guard is checking nothing");

  // Any comparison against a bare number is a threshold that escaped the
  // policy: change it and every stored snapshot silently means something else.
  // `0` is allowed — a count or a length compared to zero is not a threshold.
  const bare = (body.match(/[<>]=?\s*-?\d+(?:\.\d+)?/g) ?? [])
    .filter((m) => !/[<>]=?\s*-?0$/.test(m));
  assert.deepEqual(bare, [], `a threshold is written into the engine: ${bare.join(", ")}`);
  assert.ok(TRAJECTORY_POLICY.version.startsWith("recovery-trajectory."));
});
