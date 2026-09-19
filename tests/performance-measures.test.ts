// Which of P7's seven performance measures this run actually covers.
//
// The handoff names seven: "time to usable queue, time to usable patient
// overview, action acknowledgment, evidence-panel opening, large-list
// navigation, export completion, and projection freshness."
//
// THE RUN MEASURES TIME TO FIRST BYTE, which is two of the seven and is not
// quite either of them — "time to usable" includes the render and the data
// arriving, and first byte is the server's part of it. Reporting the two as the
// same would make the fastest number the headline for the slowest question.

import { strict as assert } from "node:assert";
import test from "node:test";

import { NAMED_MEASURES, measureCoverage, BUDGETS, budgetFor } from "../src/lib/performance/budget";
import { PERFORMANCE_RUN } from "../src/lib/performance/run.generated";

test("all seven named measures are listed, covered or not", () => {
  assert.equal(NAMED_MEASURES.length, 7, "the handoff names seven measures");
  const c = measureCoverage();
  assert.equal(c.total, 7);
  assert.ok(c.covered > 0, "nothing is measured at all");
  assert.ok(c.missing.length > 0, "every measure is claimed as covered, which is not true of this run");
});

test("an uncovered measure says what it would take", () => {
  // "Not measured" with no next step is a row that will still be here at the
  // next release.
  for (const m of NAMED_MEASURES) {
    assert.ok(m.note.length > 40, `${m.name} says nothing useful`);
    if (!m.covered) {
      assert.match(m.note, /Not measured/, `${m.name} does not say it is unmeasured`);
    }
  }
});

test("the two covered measures say they are first byte, not time to usable", () => {
  // The distinction is the honest part. A reader who takes "time to usable
  // queue: 94ms" at face value has been told the server's share of a number
  // nobody measured.
  const covered = NAMED_MEASURES.filter((m) => m.covered);
  assert.equal(covered.length, 2);
  assert.match(covered[0].note, /first byte/i);
  assert.match(covered[0].note, /NOT the same as/);
  assert.match(covered[1].note, /first byte/i);
});

test("the committed run states its conditions, including the dataset it ran against", () => {
  // "Record device, network, dataset size, environment, and percentile." A
  // number with no conditions is a number somebody will quote in a year.
  const c = PERFORMANCE_RUN.conditions;
  assert.match(c, /samples/i, "the run does not say how many samples");
  assert.match(c, /persons|events/i, "the run does not say what dataset it measured against");
  assert.match(c, /p95|percentile/i, "the run does not state its percentile");
  assert.match(c, /concurrency/i, "the run does not say whether anything else was running");
  assert.ok(PERFORMANCE_RUN.takenAt > "2026-09-18", `the committed run is stale: ${PERFORMANCE_RUN.takenAt}`);
});

test("every measured surface is measured against a budget with a stated reason", () => {
  for (const m of PERFORMANCE_RUN.measurements) {
    const budget = budgetFor(m.path);
    assert.equal(m.budgetMs, budget.ttfbMs, `${m.path} was measured against a budget it does not have`);
    assert.ok(BUDGETS[budget.cls].why.length > 40, `${budget.cls} is a number with no rationale`);
  }
  assert.deepEqual(PERFORMANCE_RUN.breaches, [], `surfaces over budget: ${PERFORMANCE_RUN.breaches.join("; ")}`);
});
