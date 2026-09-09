process.env.EMDR_DATA_DIR = `/tmp/steady-wave7-${process.pid}-${Date.now()}`;

// Wave 7 — governance (handoff 07 §3.7, §3.8, §4.4; 07-PLAN.md).
//
// The wave's exit evidence is one sentence: "reviewers can block or retire
// output." Everything below is in service of that being a real capability
// rather than a claim — a reviewer can only block an output they can see
// clearly enough to judge, and §4.4 spends its whole last paragraph on the ways
// a fairness screen makes that harder rather than easier:
//
//   "The screen must make it easier to discover uneven access or harm, not
//    easier to stereotype a group. Do not rank races, assign grades to
//    demographic groups or use red and green labels on protected identities."
//
// THAT SENTENCE IS WHY MOST OF THESE GUARDS EXIST. Every convention that makes
// a dashboard readable — sort worst-first, colour the bad number, badge each
// row — is, applied to protected groups, precisely what it forbids. Those are
// reflexes, not decisions, so they need a test rather than a comment.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import {
  AUDIT_PANELS, AUDIT_DECISIONS, DECISION_MEANING, STOPPING_DECISIONS, stopsOutput,
  PROTECTED_ATTRIBUTES, isProtected, presentationOrder, ordersByMeasurement,
  GROUP_TONE, toneFor, readsAsGrade, WITHHELD_REASONS, WITHHELD_EXPLANATION,
  EXPLORATORY_LABEL, accountsForEveryGroup, trailComplete, appliesCorrection,
  RACE_CORRECTION_PROHIBITED, type GroupReading, type Comparison,
} from "../src/lib/governance/fairness-audit";
import {
  REGISTRY_FIELDS, FIELD_REQUIREMENT, REGISTERED_MODELS, missingFields, mayRun,
  SHADOW_MAY_REACH, SHADOW_MAY_NOT_REACH, shadowOutputMayReach,
  RELEASE_REVIEWS, outstandingReviews, mayLeaveShadowMode, EMPTY_REGISTRY_NOTE,
  type Registration,
} from "../src/lib/governance/model-registry";
import { COMPARABLE_ATTRIBUTES, ATTRIBUTE_QUESTION } from "../src/lib/governance/fairness-read";

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");
const code = (rel: string) =>
  read(rel)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const row = (group: string, value: number | null, n = 100): GroupReading => ({
  group, numerator: value === null ? 0 : Math.round(value * n), denominator: n,
  value, interval: null, suppressed: false, missing: {},
});

// ---------------------------------------------------------------------------
// §4.4 — the screen must not become a ranking
// ---------------------------------------------------------------------------

test("group rows are ordered by something that is not the measurement", () => {
  // The whole prohibition rests here. If rows arrive in an order that has
  // nothing to do with the numbers, no reader can mistake position for rank —
  // and no later edit can introduce one by changing a comparator, because there
  // is no comparator to change.
  const rows = [row("Spanish", 0.4), row("English", 0.9), row("Mandarin", 0.6)];
  const ordered = presentationOrder(rows).map((r) => r.group);
  assert.deepEqual(ordered, ["English", "Mandarin", "Spanish"]);

  // The same rows with the values reversed order identically. That is the
  // property: the order does not consult the measurement.
  const flipped = [row("Spanish", 0.95), row("English", 0.2), row("Mandarin", 0.5)];
  assert.deepEqual(presentationOrder(flipped).map((r) => r.group), ordered);
});

test("the non-answers sort last, in a fixed order, and are never redistributed", () => {
  // §3.7: "Show unknown, declined and missing separately; do not redistribute."
  // Sorting them alphabetically among the real values would scatter a recording
  // gap through the middle of a comparison about people.
  const rows = [row("Declined", null), row("Spanish", 0.4), row("Unknown", null), row("English", 0.9)];
  assert.deepEqual(
    presentationOrder(rows).map((r) => r.group),
    ["English", "Spanish", "Unknown", "Declined"]
  );
});

test("a group carries no tone, whatever its number", () => {
  // §4.4: "do not use red and green labels on protected identities". The honest
  // reading is not "use amber" — a group is not a status. Colour belongs to the
  // audit's DECISION, which is a statement about the output.
  assert.equal(toneFor(row("Spanish", 0.1)), GROUP_TONE);
  assert.equal(toneFor(row("English", 0.99)), GROUP_TONE);
  assert.equal(GROUP_TONE, "neutral");
});

test("the fairness screen gives no group a tone, a badge or a rank", () => {
  // The rule, checked against the surface rather than only against the module —
  // a page can always reintroduce by hand what the module refuses to supply.
  const page = code("app/review/fairness/page.tsx");
  const rowBlock = page.slice(page.indexOf("comparison.rows.map"), page.indexOf("</table>"));
  assert.ok(rowBlock.length > 0, "the performance table moved; this guard is checking nothing");
  for (const banned of ["PriorityBadge", "text-state-support", "text-state-safe", "bg-state-", "StateCell"]) {
    assert.ok(!rowBlock.includes(banned), `a group row carries ${banned}`);
  }
  assert.ok(!/\.sort\(/.test(rowBlock), "the page sorts group rows itself");
});

test("no panel heading or decision label grades a group", () => {
  assert.equal(readsAsGrade("Follow-up completion"), false);
  assert.equal(readsAsGrade("Group score"), true);
  assert.equal(readsAsGrade("Best performing group"), true);
  assert.equal(readsAsGrade("Bottom quartile"), true);
  for (const d of AUDIT_DECISIONS) {
    assert.equal(readsAsGrade(DECISION_MEANING[d]), false, `the ${d} description grades something`);
  }
});

test("a value ordering that happens by coincidence is named as one", () => {
  // The screen cannot stop the data from arriving in value order. What it can
  // do is refuse to let that read as a ranking, and say so when it happens.
  assert.equal(ordersByMeasurement([row("a", 0.1), row("b", 0.5), row("c", 0.9)]), true);
  assert.equal(ordersByMeasurement([row("a", 0.5), row("b", 0.1), row("c", 0.9)]), false);
  assert.equal(ordersByMeasurement([row("a", 0.5)]), false, "one row is not an order");
  // MATCHED ON THE CALL, NOT THE IMPORT — a page that imports this and never
  // consults it passes an import-shaped assertion while saying nothing.
  assert.match(
    code("app/review/fairness/page.tsx"),
    /ordersByMeasurement\(comparison\.rows\)/,
    "the page imports the check and never runs it"
  );
});

// ---------------------------------------------------------------------------
// §4.4's nine panels, and §3.7's controls
// ---------------------------------------------------------------------------

test("all nine panels are on the screen", () => {
  assert.equal(AUDIT_PANELS.length, 9);
  const page = read("app/review/fairness/page.tsx");
  for (const [panel, heading] of [
    ["question", "Question"],
    ["representation", "Representation"],
    ["performance", "Performance"],
    ["missingness", "Missingness"],
    ["errors", "Errors"],
    ["intersection", "Intersection"],
    ["small_cells", "Values not shown"],
    ["decision", "Decision"],
    ["review_trail", "Review trail"],
  ] as const) {
    // Matched on the heading's opening rather than the whole attribute: a
    // panel is allowed a longer title than §4.4's one-word column name, and
    // demanding an exact match would push the screen towards the document's
    // shorthand instead of towards a sentence a reviewer can read.
    assert.ok(page.includes(`title="${heading}`), `§4.4's ${panel} panel is missing`);
  }
});

test("every withholding control keeps its own sentence", () => {
  // "Not shown" covering four causes is how a suppressed cell, an unestimable
  // rate and a policy refusal become one indistinguishable blank — and a reader
  // who cannot tell them apart cannot tell a careful screen from a broken one.
  assert.equal(WITHHELD_REASONS.length, 4);
  const sentences = new Set<string>();
  for (const r of WITHHELD_REASONS) {
    const s = WITHHELD_EXPLANATION[r];
    assert.ok(s && s.trim().length > 0, `${r} has no explanation`);
    sentences.add(s);
  }
  assert.equal(sentences.size, WITHHELD_REASONS.length, "two controls share one sentence");
});

test("a comparison that drops a group without saying so is not complete", () => {
  // The failure: a screen renders four groups, silently omits the fifth because
  // it was small, and the reader believes the population has four groups.
  const c: Comparison = {
    question: "q", metricId: "m", attribute: "language",
    cohortId: "c", cohortVersion: "v", window: { start: "a", end: "b" },
    rows: [row("English", 0.9)],
    withheld: [{ group: "Mandarin", reason: "small_cell" }],
    intersections: [],
  };
  assert.deepEqual(accountsForEveryGroup(c, ["English", "Mandarin"]), { complete: true, unaccounted: [] });
  const gap = accountsForEveryGroup(c, ["English", "Mandarin", "Spanish"]);
  assert.equal(gap.complete, false);
  assert.deepEqual(gap.unaccounted, ["Spanish"]);
});

test("the multiple-testing control is exercised, not skipped", () => {
  // §3.7: "Control false discovery or label the view exploratory." This build
  // takes the second option, because the first implies an inferential frame a
  // deterministic descriptive engine does not have. What it must not do is
  // neither.
  assert.match(EXPLORATORY_LABEL, /[Ee]xploratory/);
  assert.match(EXPLORATORY_LABEL, /no false-discovery correction/i);
  assert.match(
    code("app/review/fairness/page.tsx"),
    /\{EXPLORATORY_LABEL\}/,
    "the page imports the label and renders something else"
  );
});

test("every comparable attribute states why the comparison is being made", () => {
  // §4.4's first panel: "exact metric and reason for comparing groups". A
  // cohort with no stated question is a fishing expedition with a version
  // number.
  for (const a of COMPARABLE_ATTRIBUTES) {
    const q = ATTRIBUTE_QUESTION[a];
    assert.ok(q && q.length > 60, `${a} has no stated reason for the comparison`);
    assert.ok(!readsAsGrade(q), `${a}'s question grades a group`);
  }
});

// ---------------------------------------------------------------------------
// The wave's exit evidence: a reviewer can block or retire output
// ---------------------------------------------------------------------------

test("two of the six decisions stop the output, and they are the two named", () => {
  assert.equal(AUDIT_DECISIONS.length, 6);
  assert.deepEqual([...STOPPING_DECISIONS], ["block", "retire"]);
  assert.equal(stopsOutput("block"), true);
  assert.equal(stopsOutput("retire"), true);
  for (const d of ["no_issue", "monitor", "investigate", "mitigate"] as const) {
    assert.equal(stopsOutput(d), false, `${d} stops the output`);
  }
});

test("a stopping decision needs the reviewer who made it and the date", () => {
  // The decision this wave exists to make possible is also the one somebody
  // will want to record quickly.
  const bare = { owner: "Governance", clinicalReviewer: null, fairnessReviewer: null, comments: "", decidedAt: null };
  assert.equal(trailComplete(bare, "monitor"), true);
  assert.equal(trailComplete(bare, "block"), false);
  assert.equal(
    trailComplete({ ...bare, fairnessReviewer: "Dr X", decidedAt: "2026-09-09" }, "block"),
    true
  );
  assert.equal(trailComplete({ ...bare, owner: "  " }, "monitor"), false, "a trail with no owner is complete");
});

// ---------------------------------------------------------------------------
// §3.8 — the model registry shell
// ---------------------------------------------------------------------------

test("the registry is empty, and the screen says which kind of empty", () => {
  // §9's coverage model: an empty list and a broken one must be tellable apart.
  assert.equal(REGISTERED_MODELS.length, 0);
  assert.match(EMPTY_REGISTRY_NOTE, /No model is registered/);
  assert.match(EMPTY_REGISTRY_NOTE, /descriptive and deterministic/);
  assert.match(code("app/review/models/page.tsx"), /EMPTY_REGISTRY_NOTE/);
});

test("a model may not run until every required field is answered", () => {
  // §7 prohibits "unregistered model execution". This is the predicate a runner
  // would have to call, written before any runner exists so that the runner is
  // written against it rather than around it.
  assert.equal(mayRun({}), false);
  assert.equal(missingFields({}).length, REGISTRY_FIELDS.length);

  const full = Object.fromEntries(REGISTRY_FIELDS.map((f) => [f, "answered"])) as Registration;
  assert.equal(mayRun(full), true);

  // Nine of eleven is not registered.
  const { fairness: _f, monitoring: _m, ...partial } = full;
  assert.equal(mayRun(partial), false);
  assert.deepEqual(missingFields(partial).sort(), ["fairness", "monitoring"]);
});

test("every registry field states what it must contain", () => {
  assert.equal(REGISTRY_FIELDS.length, 11);
  for (const f of REGISTRY_FIELDS) {
    assert.ok(FIELD_REQUIREMENT[f]?.trim().length > 0, `${f} says nothing about what it needs`);
  }
});

test("a shadow output reaches evaluation and nothing a person or a decision touches", () => {
  // §3.8: "The application does not show those outputs to patients or use them
  // for care." The permitted list is exhaustive rather than illustrative, so a
  // surface added next month is refused by default instead of permitted by
  // omission.
  for (const d of SHADOW_MAY_REACH) {
    assert.equal(shadowOutputMayReach(d), true, `${d} is on the permitted list and refused`);
  }
  for (const d of SHADOW_MAY_NOT_REACH) {
    assert.equal(shadowOutputMayReach(d), false, `a shadow output may reach ${d}`);
  }
  // The destinations that matter most, named rather than inferred from a count.
  for (const d of ["member_surface", "clinician_task_queue", "care_decision", "gate_decision"] as const) {
    assert.ok(
      (SHADOW_MAY_NOT_REACH as ReadonlyArray<string>).includes(d),
      `${d} is not on the forbidden list at all`
    );
  }
});

test("all four reviews are required before a shadow output stops being one", () => {
  assert.deepEqual([...RELEASE_REVIEWS], ["clinical", "fairness", "security", "governance"]);
  assert.equal(mayLeaveShadowMode({ completed: [] }), false);
  assert.deepEqual(outstandingReviews({ completed: ["clinical", "fairness", "security"] }), ["governance"]);
  assert.equal(mayLeaveShadowMode({ completed: ["clinical", "fairness", "security"] }), false);
  assert.equal(
    mayLeaveShadowMode({ completed: ["clinical", "fairness", "security", "governance"] }),
    true
  );
});

// ---------------------------------------------------------------------------
// p36 — race correction factors
// ---------------------------------------------------------------------------

test("an adjustment applied to a protected attribute is a defect", () => {
  assert.equal(RACE_CORRECTION_PROHIBITED, true);
  assert.equal(appliesCorrection({ attribute: "race", operation: "adjust by group mean" }), true);
  assert.equal(appliesCorrection({ attribute: "ethnicity", operation: "calibrate offset" }), true);
  // The same operation on something that is not a protected attribute is
  // ordinary arithmetic, and calling it a violation would make the check noise.
  assert.equal(appliesCorrection({ attribute: "window_days", operation: "adjust for season" }), false);
  // And a protected attribute used to GROUP rather than to adjust is the
  // permitted use — that is what the whole audit is.
  assert.equal(appliesCorrection({ attribute: "race", operation: "group by recorded value" }), false);
});

test("the protected attributes are the ones the population actually records", () => {
  for (const a of ["race", "ethnicity", "language"]) {
    assert.ok(isProtected(a), `${a} is not treated as protected`);
  }
  assert.equal(isProtected("region"), false, "region is a reporting dimension, not a protected class");
  assert.equal(isProtected("tenant"), false);
  assert.ok(PROTECTED_ATTRIBUTES.length >= 8);
});

test("both governance screens are reachable from the review navigation", () => {
  // §1.1: a route file alone does not establish usable functionality. A
  // governance screen nobody can reach is governance nobody does.
  const nav = code("components/clinical/ReviewPage.tsx");
  assert.match(nav, /href: "\/review\/fairness"/);
  assert.match(nav, /href: "\/review\/models"/);
  const register = read("lib/app/route-register.ts");
  assert.match(register, /path: "\/review\/fairness"/);
  assert.match(register, /path: "\/review\/models"/);
});
