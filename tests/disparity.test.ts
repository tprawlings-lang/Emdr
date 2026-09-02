// The authored access model and the alternative-explanation layer
// (handoff 07 p11, p13, §3.6 p36, §4.4 p43, §4.5 p44).
//
// Two things are being guarded here and they pull in opposite directions.
//
// The population has to CONTAIN disparity, or the planning engine above it has
// never been exercised — a fairness screen with nothing to find has not been
// tested. And the disparity has to be OPERATIONAL: something the service did,
// or a documented property of a life stage, never a disposition attached to an
// identity. A fabricated population that encodes a stereotype teaches the
// stereotype to everyone who reads the console, and it would do it under the
// authority of a screen whose whole purpose is to prevent that.
//
// The strongest guard in this file is the one that permutes race and ethnicity
// across a profile and requires the access model to produce the identical
// answer. It cannot be satisfied by a comment.

process.env.EMDR_DATA_DIR = `/tmp/steady-disparity-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "disparity-test-secret-at-least-32-characters";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "disparity-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { MANIFEST, type ManifestRow } from "../src/lib/demo-population-manifest";
import {
  accessProfileFor, interpreterNeededFor, accessNeedsFor, isRural, RURAL_STATES,
} from "../src/lib/demo-population-disparity";
import { ALL_ELIGIBLE, cohort, regionCohorts, type CohortDefinition } from "../src/lib/metrics/cohorts";
import { computeActivation, computeFollowupCompletion, resolve, type Observation, type ComputeContext } from "../src/lib/metrics/compute";
import { explain } from "../src/lib/planning/explanations";

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

// ---------------------------------------------------------------------------
// p13 — nothing here may key on an identity
// ---------------------------------------------------------------------------

test("the access model gives the identical answer whatever a person's race", () => {
  // The invariant, checked by permutation rather than by reading the source.
  // p13 permits protected attributes to audit access and forbids them from
  // driving anything; a generator that varied its behaviour by race would be
  // fabricating evidence for a conclusion, and the console would report it
  // faithfully.
  const races = ["White", "Black", "Asian", "AIAN", "NHPI", "Multiracial"];
  const ethnicities = ["Hisp.", "Not Hisp."];
  let compared = 0;
  for (const base of MANIFEST.slice(0, 40)) {
    const reference = JSON.stringify(accessProfileFor(base));
    for (const race of races) {
      for (const ethnicity of ethnicities) {
        const permuted = { ...base, race, ethnicity } as ManifestRow;
        assert.equal(
          JSON.stringify(accessProfileFor(permuted)), reference,
          `the access model changed for ${base.id} when race became ${race} / ${ethnicity}`,
        );
        compared += 1;
      }
    }
  }
  assert.equal(compared, 40 * races.length * ethnicities.length);
});

test("no mechanism in the model reads race or ethnicity at all", () => {
  // The source check as well as the behavioural one, because they fail in
  // different ways: the permutation catches a mechanism that USES the field,
  // and this catches one that reads it and happens to be inert today.
  const src = read("src/lib/demo-population-disparity.ts")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
  for (const field of ["\\.race", "\\.ethnicity", "row.race", "row.ethnicity"]) {
    assert.doesNotMatch(src, new RegExp(field),
      `the access model reads ${field}, which p13 permits for audit and forbids as an input`);
  }
});

test("the composition checks compare operational attributes, not identities", () => {
  // The alternative-explanations section is the one place a "this cohort is
  // N% X" sentence gets GENERATED, so it is the one place a race breakdown
  // would be produced automatically, in the section meant to be guarding
  // against exactly that. p43: easier to discover uneven access, not easier to
  // stereotype a group.
  const src = read("src/lib/planning/explanations.ts")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
  const dims = src.slice(src.indexOf("COMPOSITION_DIMENSIONS"), src.indexOf("export interface ExplanationInput"));
  for (const field of ["race", "ethnicity"]) {
    assert.doesNotMatch(dims, new RegExp(`\\b${field}\\b`),
      `a composition check groups by ${field}`);
  }
  assert.match(dims, /interpreterNeeded/, "the composition checks do not look at interpreter need");
});

// ---------------------------------------------------------------------------
// The model itself
// ---------------------------------------------------------------------------

test("interpreter need is authored independently of language, and that is the point", () => {
  // p11 authors them separately, and the whole ambiguity rests on it: if every
  // non-English speaker needed an interpreter the confound would be the
  // cohort, and stratifying could not separate them.
  const nonEnglish = MANIFEST.filter((r) => r.language !== "English");
  const needing = nonEnglish.filter(interpreterNeededFor);
  assert.ok(needing.length > 0, "nobody needs an interpreter");
  assert.ok(needing.length < nonEnglish.length,
    "every non-English speaker needs an interpreter — the model has encoded the stereotype p11 " +
    "separates these fields to avoid, and no stratified check could tell the two apart");
  // And nobody who prefers English does, which is what makes it a language-
  // adjacent operational need rather than an unrelated one.
  assert.equal(MANIFEST.filter((r) => r.language === "English").filter(interpreterNeededFor).length, 0);
});

test("the rural states cut across every region", () => {
  // An effect confined to one region is indistinguishable from a regional one.
  // Spread across all four, a regional difference is partly a composition
  // difference — and only a cohort defined by state can say which.
  const regions = new Set(MANIFEST.filter(isRural).map((r) => r.region));
  assert.equal(regions.size, 4, `rural states appear in ${regions.size} regions, not all four`);
  for (const s of RURAL_STATES) {
    assert.ok(MANIFEST.some((r) => r.state === s), `${s} is named rural and is not in the manifest`);
  }
});

test("the age gradient runs in opposite directions on the two metrics", () => {
  // The reversal, as a property of the model rather than of the generated
  // data. Older members are slower to start and more reliable afterwards;
  // younger members are the reverse. Whichever metric a reader picks, a
  // different band looks worst — which is why p32 puts the required display on
  // every metric and why a console must never say "doing worse" unqualified.
  const of = (band: string) => {
    const row = MANIFEST.find((r) => r.ageBand === band && r.language === "English" && !isRural(r));
    assert.ok(row, `no plain profile in ${band}`);
    return accessProfileFor(row!);
  };
  const young = of("18-24");
  const old = of("65+");
  assert.ok(old.startDragMean > young.startDragMean,
    "the oldest band does not take longer to start, so there is no reversal to find");
  assert.ok(old.adherenceFactor < young.adherenceFactor,
    "the oldest band does not complete follow-up more reliably, so the gradient runs one way only");
  // Monotonic across all six, so the pattern is a gradient and not two ends.
  const bands = ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"];
  const drags = bands.map((b) => of(b).startDragMean);
  const adherence = bands.map((b) => of(b).adherenceFactor);
  for (let i = 1; i < bands.length; i++) {
    assert.ok(drags[i] >= drags[i - 1], `start drag is not monotonic at ${bands[i]}`);
    assert.ok(adherence[i] <= adherence[i - 1], `adherence is not monotonic at ${bands[i]}`);
  }
});

test("delivery failure is bounded, so no combination can silence a person entirely", () => {
  // Every mechanism adds to the same number, and p14 states a per-person
  // measure range the quality manifest enforces. Without the bound, a rural
  // interpreter-needing member of an untranslated language cohort in the arm
  // with no contract would have had a delivery failure over one.
  let worst = 0;
  for (const row of MANIFEST) worst = Math.max(worst, accessProfileFor(row).deliveryFailure);
  assert.ok(worst <= 0.45, `delivery failure reaches ${worst}`);
  assert.ok(worst > 0.2, "no profile carries a material delivery failure — the model does nothing");
});

test("every profile that carries a mechanism names it", () => {
  // The mechanisms travel onto the event payload, so a reviewer opening a
  // single missing measure can see why the generator wrote it. A profile with
  // an effect and no name would be an unexplained number in the data.
  for (const row of MANIFEST) {
    const p = accessProfileFor(row);
    const moved = p.deliveryFailure > 0 || p.adherenceFactor !== 1
      || p.engagementFactor !== 1 || p.startDragMean !== 0;
    assert.equal(moved, p.mechanisms.length > 0,
      `${row.id} has ${p.mechanisms.length} named mechanisms and moved=${moved}`);
  }
  assert.ok(MANIFEST.some((r) => accessNeedsFor(r).length > 0), "nobody has a functional access need");
});

// ---------------------------------------------------------------------------
// The explanation layer, against hand calculations
// ---------------------------------------------------------------------------

const CTX: ComputeContext = {
  window: { start: "2026-06-01", end: "2026-08-31" },
  dataVersion: "demo-population-v1",
  projectionVersion: "population_metrics.v2",
  refreshedAt: "2026-09-02T12:00:00Z",
  lineageRef: "lineage://test",
  responderThreshold: 5,
};

function p(over: Partial<Observation> = {}): Observation {
  return {
    personId: `p${Math.random()}`, region: "South", ageBand: "35-44", language: "English",
    race: ["White"], ethnicity: "Not Hispanic/Latino", tenantId: "t",
    accessNeeds: [], interpreterNeeded: false, state: "TX", hasAccount: true,
    daysEnrolled: 180, daysToFirstAction: 2, enrolledInWindow: true,
    activeWeeks: 10, observedWeeks: 26, daysToLastAction: 170,
    modulesStarted: 10, modulesCompleted: 10,
    measuresComplete: 8, measuresPartial: 0, measuresDeclined: 0,
    measuresUnavailable: 0, measuresSkipped: 0, measuresInterrupted: 0, measuresNotDue: 0,
    measuresUndelivered: 0,
    baseline: 15, followUp: 10, hadFixedPause: false, reviewLatencyHours: [],
    ...over,
  };
}

/**
 * p36 level 2 permits "observed within these strata" and no more.
 *
 * Applied to BOTH branches of the stratified check, because they are two
 * different sentences and a guard that only reads one of them is a guard that
 * covers half the code — which is exactly what happened first time.
 */
function assertLevelTwoWording(detail: string) {
  assert.match(detail, /^Observed within these strata:/,
    "a stratified finding does not open with the wording its release level permits");
  for (const claim of ["caused", "causes", "because", "explains", "due to", "responsible for"]) {
    assert.doesNotMatch(detail, new RegExp(`\\b${claim}\\b`, "i"),
      `the stratified sentence claims causation ("${claim}"), which is level 3 on p36's ladder`);
  }
}

/** A cohort over one language, so a fixture can be built by setting a field. */
const TEST_COHORT = {
  id: "test_cohort.v1", version: "1.0.0", label: "Test", question: "?",
  eligibility: { requiresAccount: true }, filters: { language: ["Spanish"] },
};

test("a stratified check reports the gap CONCENTRATED when holding out the stratum closes it", () => {
  // Twenty in the cohort: ten need an interpreter and complete 1 of 10, ten do
  // not and complete 6 of 10. Two hundred outside it, all completing 6 of 10.
  //
  // The reference is the WHOLE eligible population and therefore contains the
  // cohort, which is why it has to be much larger — a reference the cohort
  // drags down cannot be a reference the held-out stratum returns to, and the
  // first version of this fixture used twenty and quietly exercised the other
  // branch. The mutation that put "caused" into the concentrated sentence
  // passed, which is how that was found.
  //
  // Reference rate = (10 + 60 + 1200) / (100 + 100 + 2000) = 1270/2200 = 57.7%
  // Cohort rate    = (10 + 60) / 200                        =   70/200  = 35.0%
  // Overall gap    = 35.0 - 57.7 = -22.7pp
  // Held out       = 60/100 = 60.0%  →  60.0 - 57.7 = +2.3pp
  // |2.3| < |22.7| * 0.5, so the gap is concentrated in the stratum.
  const rows: Observation[] = [
    ...Array.from({ length: 10 }, () => p({
      language: "Spanish", interpreterNeeded: true,
      measuresComplete: 1, measuresUndelivered: 9, measuresUnavailable: 9,
    })),
    ...Array.from({ length: 10 }, () => p({ language: "Spanish", measuresComplete: 6, measuresSkipped: 4 })),
    ...Array.from({ length: 200 }, () => p({ measuresComplete: 6, measuresSkipped: 4 })),
  ];
  const out = explain({
    cohort: TEST_COHORT, reference: ALL_ELIGIBLE, rows, ctx: CTX,
    minDenominator: 30, minGroup: 10,
  });

  const composition = out.find((e) => e.kind === "composition" && e.question.includes("interpreter"));
  assert.ok(composition?.found, "50% against 4.5% was not reported as a composition difference");
  assert.match(composition!.detail, /50\.0%/);

  const strat = out.find((e) => e.kind === "stratified");
  assert.ok(strat?.found, "no stratified comparison was attempted");
  assert.match(strat!.detail, /concentrated in the/,
    "a gap that all but vanished under stratification was not reported as concentrated");
  assert.match(strat!.detail, /-22\.7 percentage points overall/);
  assert.match(strat!.detail, /\+2\.3 percentage points/);
  // And it still refuses to say the stratum caused it — level 2 on p36's
  // ladder permits an observation within a stratum and nothing more.
  assertLevelTwoWording(strat!.detail);
});

test("a stratified check reports the gap SURVIVING when holding out the stratum leaves it", () => {
  // Same shape, but everybody in the cohort completes 4 of 10 whether or not
  // they need an interpreter — so the stratification cannot move it.
  //
  // Cohort rate    = 80/200 = 40.0%
  // Reference rate = (80 + 160) / 400 = 60.0%
  // Overall gap    = -20.0pp
  // Held out       = 60/150 = 40.0%  →  -20.0pp. Unchanged.
  const rows: Observation[] = [
    ...Array.from({ length: 5 }, () => p({
      language: "Spanish", interpreterNeeded: true,
      measuresComplete: 4, measuresUndelivered: 6, measuresUnavailable: 6,
    })),
    ...Array.from({ length: 15 }, () => p({ language: "Spanish", measuresComplete: 4, measuresUndelivered: 6, measuresUnavailable: 6 })),
    ...Array.from({ length: 20 }, () => p({ measuresComplete: 8, measuresSkipped: 2 })),
  ];
  const out = explain({
    cohort: TEST_COHORT, reference: ALL_ELIGIBLE, rows, ctx: CTX,
    minDenominator: 30, minGroup: 10,
  });
  const strat = out.find((e) => e.kind === "stratified");
  assert.ok(strat?.found);
  assert.match(strat!.detail, /survives the stratification/,
    "a gap that did not move under stratification was reported as concentrated in the stratum");
  assertLevelTwoWording(strat!.detail);
});

test("the cause mix separates what the service failed to send from what people did not do", () => {
  // Ten in the cohort: 3 complete, 6 never delivered, 1 skipped → 6/7 = 85.7%
  // service-caused. Ten in the reference: 3 complete, 1 never delivered,
  // 6 skipped → 1/7 = 14.3%.
  const rows: Observation[] = [
    ...Array.from({ length: 10 }, () => p({
      language: "Spanish", measuresComplete: 3,
      measuresUndelivered: 6, measuresUnavailable: 6, measuresSkipped: 1,
    })),
    ...Array.from({ length: 10 }, () => p({
      measuresComplete: 3, measuresUndelivered: 1, measuresUnavailable: 1, measuresSkipped: 6,
    })),
  ];
  const out = explain({
    cohort: TEST_COHORT, reference: ALL_ELIGIBLE, rows, ctx: CTX,
    minDenominator: 10, minGroup: 5,
  });
  const mix = out.find((e) => e.kind === "cause-mix");
  assert.ok(mix?.found, "a cohort whose missing measures are six-sevenths undelivered read as normal");
  assert.match(mix!.detail, /85\.7%/);
  // The reference includes the cohort, so its share sits between the two.
  assert.match(mix!.detail, /against 50\.0%/);
  assert.match(mix!.detail, /opposite fixes/);
});

test("every check reports what it looked for, whether or not it found anything", () => {
  // "We looked and it was not that" is the half a reader never gets, and it is
  // the half that makes the rest credible.
  const rows = Array.from({ length: 20 }, (_, i) => p({ language: i < 10 ? "Spanish" : "English" }));
  const out = explain({
    cohort: TEST_COHORT, reference: ALL_ELIGIBLE, rows, ctx: CTX,
    minDenominator: 10, minGroup: 5,
  });
  assert.ok(out.length >= 4, "the explanation layer produced almost nothing");
  for (const e of out) {
    assert.ok(e.question.trim().endsWith("?"), `"${e.question}" is not a question`);
    assert.ok(e.detail.length > 30, `the ${e.kind} check has no detail`);
  }
  assert.ok(out.some((e) => !e.found), "every check found something, which is not a report");
});

// ---------------------------------------------------------------------------
// The generated population actually carries the pattern
// ---------------------------------------------------------------------------

import { getDb } from "../src/lib/db";
import { loadObservations, metricContext } from "../src/lib/metrics/population-metrics";
import { populationTenantIds } from "../src/lib/planning/scope";

test("the generated population carries the reversal, and it points both ways", async () => {
  getDb();
  const rows = await loadObservations(populationTenantIds());
  const ctx = await metricContext("reversal");
  const young = cohort("age_18_24.v1");
  const old = cohort("age_65_plus.v1");

  const act = (c: typeof young) => computeActivation(rows, c, ctx).value!;
  const fup = (c: typeof young) => computeFollowupCompletion(rows, c, ctx).value!;

  // DIRECTION only. The magnitudes are tuning and will move; the reversal is
  // the design, and a test pinned to a number would fail for the wrong reason
  // every time a threshold was adjusted.
  assert.ok(act(young) > act(old),
    `18-24 activation ${act(young)} is not above 65+ ${act(old)} — the gradient is gone`);
  assert.ok(fup(old) > fup(young),
    `65+ follow-up completion ${fup(old)} is not above 18-24 ${fup(young)} — it is not a reversal, ` +
    "it is one group doing worse at everything, which teaches the opposite lesson");
});

test("the interpreter cohort's missing measures are mostly the service's", async () => {
  getDb();
  const rows = await loadObservations(populationTenantIds());
  const group = resolve(rows, cohort("interpreter_needed.v1"));
  assert.ok(group.length > 0, "the interpreter cohort is empty");
  const undelivered = group.reduce((s, r) => s + r.measuresUndelivered, 0);
  const personSide = group.reduce(
    (s, r) => s + r.measuresSkipped + r.measuresDeclined + r.measuresInterrupted, 0);
  assert.ok(undelivered > personSide,
    `${undelivered} undelivered against ${personSide} person-side: the authored gap is landing on ` +
    "the people rather than on the service, which is the opposite of what it is for");
});

test("no region carries a larger gap than the language cohorts", async () => {
  getDb();
  const rows = await loadObservations(populationTenantIds());
  const ctx = await metricContext("confound");
  const ref = computeFollowupCompletion(rows, ALL_ELIGIBLE, ctx).value!;
  const gapOf = (c: CohortDefinition) =>
    Math.abs(computeFollowupCompletion(rows, c, ctx).value! - ref);
  const gap = (id: string) => gapOf(cohort(id));

  // Generated from one template rather than registered, so they cannot drift
  // apart and be compared as if they had not.
  const worstRegion = Math.max(...regionCohorts().map(gapOf));
  // Region is a REPORTING dimension here and carries no authored mechanism, so
  // a region gap larger than a language gap would mean the model had leaked
  // into geography — and every regional comparison on the console would be
  // reporting an artefact.
  assert.ok(worstRegion < gap("mandarin_preferred.v1"),
    `a region gap of ${worstRegion} exceeds the language gap the model authored`);
  assert.ok(worstRegion < 0.05, `regions differ by ${worstRegion}, which is not background noise`);
});
