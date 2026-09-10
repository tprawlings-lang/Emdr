process.env.EMDR_DATA_DIR = `/tmp/steady-perfbudget-${process.pid}-${Date.now()}`;

// Per-surface performance budgets (handoff 06 §31.2, wave 6).
//
// The load gate beside this one measures ONE path under concurrency and answers
// "does the server stand up". These budgets answer a different question — is
// each surface fast enough for what somebody is doing on it — and the two
// cannot be averaged into one number without answering neither.
//
// WHAT THESE GUARDS ARE ABOUT is the budget being a decision rather than an
// observation. The failure mode for a performance budget is not that it is
// breached; it is that somebody measures a slow screen, writes the measurement
// down as the budget, and the gate goes green forever. So every class states
// what it is for, the numbers are ordered by who is waiting rather than by how
// much work the server does, and the measurement carries the conditions it was
// taken under.
//
// AND A MEASUREMENT HAS TO BE ONE. A p95 over five samples is the largest of
// five. The gate refuses a run below the floor rather than reporting a
// confident number from too little — the same rule the aggregate consoles apply
// to a small cell, for the same reason.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import {
  BUDGETS, MIN_SAMPLES, budgetClassFor, budgetFor, measurable, measure, p95,
} from "../src/lib/performance/budget";
import { PERFORMANCE_RUN } from "../src/lib/performance/run.generated";

const ROOT = path.join(__dirname, "..");
const code = (rel: string) =>
  fs.readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");

// ---------------------------------------------------------------------------
// The budgets
// ---------------------------------------------------------------------------

test("every budget says what it is for", () => {
  // A number with no rationale is a number the next person will move. The
  // rationale is what makes moving it an argument rather than an edit.
  for (const [cls, b] of Object.entries(BUDGETS)) {
    assert.equal(b.cls, cls);
    assert.ok(b.ttfbMs > 0, `${cls} has no budget`);
    assert.equal(b.percentile, 95, `${cls} is not set at the 95th percentile`);
    assert.ok(b.why.trim().length > 80, `${cls} does not say what its number is for`);
  }
  // And the reasons are DISTINCT. Five classes with the same justification is
  // one class with five names, and the argument for moving any of the numbers
  // would then apply to all of them.
  const reasons = Object.values(BUDGETS).map((b) => b.why.trim());
  assert.equal(new Set(reasons).size, reasons.length, "two budget classes share a reason");
});

test("support is the tightest budget in the product", () => {
  // THE ORDERING IS THE POINT. Grounding and crisis resources carry the least
  // data and get the least time, because somebody opens them because they are
  // activated. A budget table ordered by how much work the server does would
  // put them last.
  const support = BUDGETS.support.ttfbMs;
  for (const [cls, b] of Object.entries(BUDGETS)) {
    if (cls === "support") continue;
    assert.ok(support < b.ttfbMs, `${cls} is at least as tight as support (${b.ttfbMs} vs ${support})`);
  }
  // And the decision surfaces are tighter than the ones nobody opens mid-crisis.
  assert.ok(BUDGETS.decision.ttfbMs < BUDGETS.aggregate.ttfbMs);
  assert.ok(BUDGETS.decision.ttfbMs < BUDGETS.review.ttfbMs);
});

test("every surface gets a class without anybody remembering to give it one", () => {
  // Rules rather than a per-route list, so a route added tomorrow has a budget.
  assert.equal(budgetClassFor("/app/ground"), "support");
  assert.equal(budgetClassFor("/crisis"), "support");
  assert.equal(budgetClassFor("/app/today"), "decision");
  assert.equal(budgetClassFor("/clinician/today"), "decision");
  assert.equal(budgetClassFor("/clinician/member/[id]/measures"), "record");
  assert.equal(budgetClassFor("/organization/overview"), "aggregate");
  assert.equal(budgetClassFor("/payer/cohorts"), "aggregate");
  assert.equal(budgetClassFor("/review/audit"), "review");
  // A route nobody has classified still gets the decision budget rather than
  // no budget — the strictest sensible default for an unknown surface.
  assert.equal(budgetClassFor("/something/new"), "decision");
  assert.equal(budgetFor("/something/new").ttfbMs, BUDGETS.decision.ttfbMs);
});

// ---------------------------------------------------------------------------
// The measurement
// ---------------------------------------------------------------------------

test("a percentile needs enough samples to be one", () => {
  // A p95 over five samples is the largest of five.
  assert.ok(!measurable([1, 2, 3, 4, 5]));
  assert.ok(!measurable(Array(MIN_SAMPLES - 1).fill(10)));
  assert.ok(measurable(Array(MIN_SAMPLES).fill(10)));
});

test("the percentile is a number that was actually measured", () => {
  // Nearest-rank, not interpolated: interpolating reports a figure that was
  // never observed, which is the wrong habit for something a release gate reads.
  assert.equal(p95([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]), 100);
  assert.equal(p95([1, 1, 1, 1, 1, 1, 1, 1, 1, 99]), 99);
  const twenty = Array.from({ length: 20 }, (_, i) => i + 1);
  assert.ok(twenty.includes(p95(twenty)), "the percentile is a value nobody measured");
  assert.equal(p95([]), 0);
});

test("a measurement is judged against its own class, not a single number", () => {
  const support = measure("/app/ground", Array(MIN_SAMPLES).fill(500));
  const aggregate = measure("/organization/overview", Array(MIN_SAMPLES).fill(500));
  assert.equal(support.withinBudget, false, "500ms passes the support budget");
  assert.equal(aggregate.withinBudget, true, "500ms fails the aggregate budget");
});

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

test("the gate refuses to time a redirect", () => {
  // A 307 to the login page comes back in single-digit milliseconds and looks
  // like the fastest screen in the product. The first run of this gate recorded
  // /review/audit at 13ms that way — the route bounced the reviewer to the
  // console's landing page, and the gate caught the defect by refusing the
  // measurement.
  const gate = code("scripts/perfcheck.ts");
  assert.match(gate, /status >= 300/, "a redirect is recorded as a measurement");
  assert.match(gate, /redirect: "manual"/);
  // And it discards a warm-up, so the budget is not a statement about the first
  // visitor of the day. Matched on the DISCARDED CALL rather than on the word
  // "warm-up", which lives in a comment the stripper removes — a guard that
  // read the comment would pass on a gate that had deleted the call.
  assert.match(
    gate, /await timeOnce\(url, cookies\[role\]\);\s*const samples/,
    "the first request to each surface is recorded rather than discarded"
  );
});

test("the gate fails the run rather than reporting a thin measurement", () => {
  const gate = code("scripts/perfcheck.ts");
  assert.match(gate, /measurable\(samples\)/, "the sample floor is not enforced by the gate");
  assert.match(gate, /process\.exit\(1\)/);
  // The budgets are not decided here.
  assert.ok(
    !/ttfbMs\s*[:=]\s*\d/.test(gate),
    "the gate carries a budget of its own instead of reading the declared ones"
  );
});

// ---------------------------------------------------------------------------
// The run and the screen
// ---------------------------------------------------------------------------

test("the committed run carries the conditions it was taken under", () => {
  // A number with no conditions is a number somebody will quote in a year.
  assert.ok(PERFORMANCE_RUN.takenAt.length >= 20, "the run has no timestamp");
  assert.ok(
    PERFORMANCE_RUN.conditions.length > 40,
    "the run does not say what it was measured against"
  );
  assert.ok(PERFORMANCE_RUN.measurements.length >= 8, "too few surfaces to be a baseline");
  for (const m of PERFORMANCE_RUN.measurements) {
    assert.ok(measurable(m.samples), `${m.path} was recorded from ${m.samples.length} samples`);
    assert.equal(m.budgetMs, budgetFor(m.path).ttfbMs, `${m.path} was judged against a stale budget`);
    assert.equal(m.withinBudget, m.p95Ms <= m.budgetMs, `${m.path} disagrees with its own verdict`);
  }
});

test("every declared budget class has been measured at least once", () => {
  // A declared budget nobody has ever tested is a number, not a gate — and the
  // screen said exactly that about the record class until a chart was added to
  // the run. The support budget matters most and is the easiest to leave
  // untested, because those pages are simple.
  const measured = new Set(PERFORMANCE_RUN.measurements.map((m) => m.cls));
  const unmeasured = Object.keys(BUDGETS).filter((c) => !measured.has(c as keyof typeof BUDGETS));
  assert.deepEqual(unmeasured, [], `declared and never measured: ${unmeasured.join(", ")}`);
  const support = PERFORMANCE_RUN.measurements.filter((m) => m.cls === "support");
  assert.ok(support.length >= 2, "the tightest budget in the product rests on fewer than two surfaces");
});

test("the run names routes, not the people they were measured on", () => {
  // The record budget is measured against one fabricated person's chart. What
  // is committed and rendered is the route pattern: the artefact should not
  // churn on every reseed, and a review screen has no reason to print an id.
  for (const m of PERFORMANCE_RUN.measurements) {
    assert.ok(
      !/\/[0-9A-Fa-f-]{16,}/.test(m.path),
      `${m.path} carries a record id into the committed measurement`
    );
  }
  assert.ok(
    PERFORMANCE_RUN.measurements.some((m) => m.path.includes("[id]")),
    "no dynamic route was measured, so the record budget rests on nothing"
  );
});

test("the screen says what it does not measure", () => {
  // A performance page that reports only its own numbers invites somebody to
  // read them as capacity.
  const page = code("src/app/review/performance/page.tsx");
  assert.match(page, /What this does not measure/);
  assert.match(page, /Concurrency/, "the screen does not distinguish itself from the load gate");
  assert.match(page, /deployed instance/i, "the screen lets local numbers read as capacity");
  assert.match(page, /\{run\.conditions\}/, "the conditions are not rendered");
  assert.match(page, /\{b\.why\}/, "the budgets are shown without their reasons");
  assert.match(page, /requireReviewAccess\(/);
  assert.match(code("src/lib/app/route-register.ts"), /path: "\/review\/performance"/);
  assert.match(code("src/components/clinical/ReviewPage.tsx"), /href: "\/review\/performance"/);
});

test("a class with no measurement is reported as unverified, not as passing", () => {
  const page = code("src/app/review/performance/page.tsx");
  assert.match(page, /declared and unverified/, "an unmeasured budget reads as a met one");
});
