// The payer boundary (§26's ten payer screens, §29.1, p69's prohibition).
//
// These are the riskiest screens in the product, because a payer acts on them
// with money. Two failures matter more than anything else here, and neither is
// caught by types:
//
//   AN ESTIMATE BECOMING A FACT. p69's contract row is a prohibition rather
//   than a requirement — "Never label estimated value as observed savings."
//   A metric and a model look identical on a slide: both are a number with a
//   unit. Only one was counted.
//
//   A PARTIAL MONTH BECOMING A RESULT. Claims arrive ~60 days late, so the
//   most recent months are always incomplete. Count only what has arrived and
//   utilisation falls off a cliff at the right-hand edge — every time, for
//   every payer — and that fall looks exactly like the programme working.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PAYER_APP = path.join(ROOT, "src", "app", "payer");
const PAYER_LIB = path.join(ROOT, "src", "lib", "intelligence", "payer.ts");

function read(p: string): string {
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

/**
 * Drop sentences that DISOWN a term, keeping only affirmative claims.
 *
 * This exists because the same false positive has now bitten four separate
 * guards in this codebase: a screen that says "No predictive risk score",
 * "not adherence", or "nothing here is a savings figure" trips a naive scan
 * for exactly the thing it is refusing to do — the safeguard reads as the
 * violation. Patching an allowlist one phrase at a time loses the next time
 * someone rewords the disclaimer.
 *
 * A term inside a negated sentence is the product being careful. A term in an
 * affirmative one is the product making a claim, and only the second is what
 * these guards are for.
 */
function affirmative(src: string): string {
  return src
    .split(/(?<=[.!?])\s+|\n/)
    .filter((sentence) => !/\b(no|not|never|nothing|neither|without)\b/i.test(sentence))
    .join(" ");
}
function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith(".tsx") || e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

test("all ten payer screens exist", () => {
  const ROUTES = [
    "overview", "engagement", "outcomes", "utilization", "access",
    "cohorts", "population-access", "evidence", "contract", "data-quality",
  ];
  const missing = ROUTES.filter((r) => !fs.existsSync(path.join(PAYER_APP, r, "page.tsx")));
  assert.deepEqual(missing, [], "these payer screens do not exist: " + missing.join(", "));
  // The cost view is its own screen, deliberately not folded into evidence.
  assert.ok(fs.existsSync(path.join(PAYER_APP, "evidence", "cost", "page.tsx")),
    "the cost model has no screen of its own — an estimate rendered beside observed metrics " +
    "is how it stops being read as an estimate");
});

test("no payer screen reaches for a person", () => {
  const offenders = walk(PAYER_APP)
    .filter((f) => /\bperson_?id\b|\bdisplay_?name\b|\buser_?id\b/i.test(code(read(f))))
    .map((f) => path.relative(ROOT, f));
  assert.deepEqual(offenders, [], "an aggregate surface reached for a person: " + offenders.join(", "));
});

test("every payer projection is laundered through assertAggregate", () => {
  const src = read(PAYER_LIB);
  const bodies = src.split(/export async function /).slice(1);
  const unlaundered = bodies
    .filter((b) => /\b(ready|partial|stale)\(/.test(b) && !/assertAggregate</.test(b))
    .map((b) => b.slice(0, b.indexOf("(")));
  assert.deepEqual(unlaundered, [],
    "these payer projections return data without assertAggregate: " + unlaundered.join(", "));
});

// ---------------------------------------------------------------------------
// Observed and modelled never mix
// ---------------------------------------------------------------------------

test("no observed payer screen mentions savings or cost", () => {
  // The one screen allowed to talk about money is the cost model, and it may
  // only do so as an estimate. Everywhere else the words must not appear —
  // that is what "separate surfaces" means in practice.
  const OBSERVED = ["overview", "utilization", "outcomes", "engagement", "access", "contract", "data-quality"];
  const offenders: string[] = [];
  for (const r of OBSERVED) {
    // Only affirmative sentences: a screen saying it is NOT a savings figure
    // is the product being careful, not the product claiming savings.
    const src = affirmative(code(read(path.join(PAYER_APP, r, "page.tsx"))));
    if (/\bsavings\b|\bPMPM\b|\bROI\b/i.test(src)) offenders.push(r);
  }
  assert.deepEqual(offenders, [],
    "these observed screens use cost language: " + offenders.join(", ") +
    "\nOnly the cost model may, and only as an estimate.");
});

test("the cost model never calls its output observed, and shows only approved versions", () => {
  const page = read(path.join(PAYER_APP, "evidence", "cost", "page.tsx"));
  assert.match(page, /[Nn]ot observed savings/,
    "the cost model does not say on screen that it is not observed savings");
  assert.match(page, /modelled|Modelled/, "the cost model does not label itself as modelled");

  const lib = read(PAYER_LIB);
  assert.match(lib, /status === "approved"/,
    "the cost model projection does not filter to approved versions — a draft rendered " +
    "beside an approved one is how a working estimate leaves the building as a finding");
  assert.match(lib, /No cost model version has been approved/,
    "there is no branch for the case where nothing is approved");
});

test("the interval chart draws the range as the mark and labels itself modelled", () => {
  const chart = read(path.join(ROOT, "src", "components", "charts", "aggregate.tsx"));
  // Bounded at the next component. An unbounded slice runs to end of file and
  // picks up the Line chart's observed colours, which is what this asserts the
  // absence of — the check would have failed on the neighbour's code.
  const from = chart.indexOf("export function IntervalChart");
  const to = chart.indexOf("export function Line", from);
  const slice = chart.slice(from, to > from ? to : undefined);
  assert.match(slice, /modelled estimate, not observed/,
    "the interval chart does not label itself on screen");
  // Hatched, in the modelled colour, never the solid sage of an observed series.
  assert.match(slice, /repeating-linear-gradient/,
    "a modelled range is drawn in the same register as an observed value");
  assert.doesNotMatch(slice, /color-sage/,
    "the modelled chart uses the observed series colour");
});

// ---------------------------------------------------------------------------
// A partial month is never a result
// ---------------------------------------------------------------------------

test("incomplete months report no value rather than a low one", async () => {
  const lib = read(PAYER_LIB);
  assert.match(lib, /COMPLETENESS_FLOOR/, "there is no completeness threshold");
  assert.match(lib, /complete \? per1000\(e\.ed\) : null/,
    "an incomplete month contributes a value — a partial month plotted as a value falls, " +
    "and a fall at the right-hand edge reads as the programme working");

  const { COMPLETENESS_FLOOR } = await import("../src/lib/intelligence/payer");
  assert.ok(COMPLETENESS_FLOOR >= 0.8 && COMPLETENESS_FLOOR <= 1,
    `completeness floor of ${COMPLETENESS_FLOOR} is not a meaningful threshold`);
});

test("utilisation renders partial, with the withheld months named", () => {
  const lib = read(PAYER_LIB);
  assert.match(lib, /return partial\(/,
    "utilisation never renders the partial state, so a short chart is unexplained");
  assert.match(lib, /incompleteMonths/, "withheld months are not carried to the screen");
});

test("the contract report uses only complete months, and shows a miss as plainly as a hit", () => {
  const lib = read(PAYER_LIB);
  assert.match(lib, /months\.filter\(\(x\) => x\.complete\)/,
    "the contract report averages incomplete months, so a rate can be flattered by claims " +
    "that have not arrived");

  const page = read(path.join(PAYER_APP, "contract", "page.tsx"));
  // Both outcomes carry a glyph, a word, and the same weight class. A report
  // that softens a miss is worse than no report.
  assert.match(page, /not met/, "a missed measure has no rendering");
  assert.match(page, /text-sm font-medium text-state-support/,
    "a miss is rendered less prominently than a hit");
  assert.match(page, /not computed/,
    "a measure that cannot be computed has no rendering distinct from a miss");
});

test("a measure that cannot be computed is null, never zero", () => {
  const lib = read(PAYER_LIB);
  assert.match(lib, /observed: number \| null/,
    "an uncomputable measure has no way to be absent, so it will be reported as zero");
  assert.match(lib, /withheld\?: string/, "a withheld measure carries no reason");
});

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

test("payer and provider-network scope cannot resolve to the same tenant", () => {
  // Seeding the payer added a second organization-kind tenant. The previous
  // "exactly one organization" rule would have returned null for both.
  const scope = read(path.join(ROOT, "src", "lib", "intelligence", "scope.ts"));
  assert.match(scope, /NOT EXISTS \(SELECT 1 FROM payer_contracts/,
    "resolveOrgTenant does not exclude payer tenants, so adding a plan breaks every " +
    "organization screen");
  assert.match(scope, /export async function resolvePayerTenant/, "there is no payer scope resolver");
});
