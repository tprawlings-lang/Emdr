process.env.EMDR_DATA_DIR = `/tmp/steady-datascenario-${process.pid}-${Date.now()}`;

// Data scenarios (handoff 07 Wave 8, p9's "Inject data scenario").
//
// The control p9 specifies is "apply an approved, versioned event bundle such
// as a safety pause; reversible by reset". Each of those four words is a
// property somebody could remove without the screen looking any different, so
// each has a guard below.
//
// THE WORD MEANT TWO THINGS BEFORE THIS EXISTED, and the confusion is what let
// the control stay unbuilt while looking built: handoff 09 Package 4 shipped a
// scenario registry of PRESENTATION scenarios — an order of screens and a set
// of claims. A reader who saw `/demo/scenarios` and assumed the data control
// had shipped would go looking for something that was not there. The two are
// held apart here as well as on the screen.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import {
  DATA_SCENARIOS, MAX_COHORT, assertApplicable, dataScenario, resolveCohort,
  type DataScenario,
} from "../src/lib/demo/data-scenario";
import { isEventType } from "../src/lib/events";
import { MANIFEST } from "../src/lib/demo-population-manifest";
import { popPersonId } from "../src/lib/demo-population-seed";

const ROOT = path.join(__dirname, "..");
const code = (rel: string) =>
  fs.readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");

// ---------------------------------------------------------------------------
// Approved
// ---------------------------------------------------------------------------

test("a bundle is declared in code, never composed from a request", () => {
  // The failure this prevents: an admin console that can write arbitrary
  // events into a clinical spine can fabricate a safety history, and the
  // fabrication would be indistinguishable from a real one two tables away.
  // BOUNDED TO THE FUNCTION, not to a character count. The first version took
  // a fixed 1200-character window, which quietly grew to include the NEXT
  // action in the file the moment one was added below it — so the QA export's
  // `formData.get("purpose")` read as this function composing a bundle. A
  // window that depends on what happens to sit after it is not a guard.
  const action = code("src/lib/demo-reset-actions.ts");
  const at = action.indexOf("export async function applyDemoDataScenario");
  assert.ok(at > 0, "there is no data-scenario action");
  const nextFn = action.indexOf("\nexport ", at + 1);
  const body = action.slice(at, nextFn > 0 ? nextFn : undefined);

  // The form supplies an ID and a REASON. Anything else — an event type, a
  // payload, a person id, a cohort — would be a caller composing a bundle.
  const supplied = [...body.matchAll(/formData\.get\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.deepEqual(
    supplied.sort(), ["reason", "scenarioId"],
    `the action reads ${supplied.join(", ")} from the request; a bundle is declared, not composed`
  );
});

test("every declared bundle is applicable, checked at import rather than at use", () => {
  // `assertApplicable` runs over every bundle at module load, so a bundle that
  // would write an unregistered event type fails the BUILD rather than the
  // demonstration. Importing the module above already proved that; this checks
  // the check is real by feeding it bundles that should be refused.
  const base = DATA_SCENARIOS[0];

  const bad: Array<[string, DataScenario]> = [
    ["an unregistered event type", {
      ...base, id: "x", version: "x.1.0.0",
      events: [{ type: "not.a.real.event" as never, daysAgo: 1, actorType: "system" }],
    }],
    ["a future-dated event", {
      ...base, id: "x", version: "x.1.0.0",
      events: [{ ...base.events[0], daysAgo: -1 }],
    }],
    ["no events at all", { ...base, id: "x", version: "x.1.0.0", events: [] }],
    ["a version that names a different scenario", { ...base, id: "x", version: "y.1.0.0" }],
    ["a cohort that selects nobody", {
      ...base, id: "x", version: "x.1.0.0", cohort: { ids: ["ST-XX-999"] },
    }],
    ["a cohort over the bound", {
      ...base, id: "x", version: "x.1.0.0", cohort: {},
    }],
  ];
  for (const [why, s] of bad) {
    assert.throws(() => assertApplicable(s), `${why} was accepted`);
  }

  // And the real ones pass.
  for (const s of DATA_SCENARIOS) assertApplicable(s);
});

test("a bundle only writes event types the spine already registers", () => {
  for (const s of DATA_SCENARIOS) {
    for (const e of s.events) {
      assert.ok(isEventType(e.type), `${s.id} writes "${e.type}", which the spine does not know`);
    }
  }
});

// ---------------------------------------------------------------------------
// Versioned
// ---------------------------------------------------------------------------

test("applying the same version twice is refused rather than doubled", () => {
  // A demonstration where the safety pause happened twice is not the
  // demonstration anybody rehearsed, and it is the specific way an append-only
  // bundle goes wrong: nothing errors, the events simply arrive again.
  const src = code("src/lib/demo/data-scenario.ts");
  assert.match(
    src, /appliedScenarios\(\)\.find\(\(a\) => a\.scenarioVersion === s\.version\)/,
    "nothing checks whether this version is already applied"
  );
  // Keyed on the VERSION, not the id: a corrected bundle is a new bundle and
  // must be appliable over the old one's record.
  assert.doesNotMatch(
    src, /find\(\(a\) => a\.scenarioId === s\.id\)/,
    "the duplicate check is keyed on the id, so a corrected bundle could never be applied"
  );
});

test("every bundle version is unique and names its own scenario", () => {
  const versions = DATA_SCENARIOS.map((s) => s.version);
  assert.equal(new Set(versions).size, versions.length, "two bundles share a version");
  for (const s of DATA_SCENARIOS) {
    assert.ok(s.version.startsWith(`${s.id}.`), `${s.version} does not name ${s.id}`);
  }
});

// ---------------------------------------------------------------------------
// Event bundle — appends, never mutates
// ---------------------------------------------------------------------------

test("a bundle appends to the spine and touches nothing else", () => {
  // The whole point of having an event spine: a bundle cannot invent a state
  // the replay would not produce. If it wrote a projection directly, a
  // `verifyProjections` run would immediately disagree with it — and the
  // demonstration would be of a dataset that fails its own reproducibility
  // gate.
  const src = code("src/lib/demo/data-scenario.ts");
  assert.doesNotMatch(src, /\bDELETE\b/i, "a data scenario deletes");
  assert.doesNotMatch(src, /\bUPDATE\b/i, "a data scenario mutates a row");

  // The one INSERT it makes is its own record of having run.
  const inserts = [...src.matchAll(/INSERT INTO (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(
    inserts, ["demo_data_scenario_applications"],
    `a data scenario writes to ${inserts.join(", ")}; it may only append events and record itself`
  );
  assert.match(src, /await appendEvent\(/, "it does not append through the spine");
});

test("a bundle files each event under its own person's tenant", () => {
  // FOUND BY DRIVING IT, and it is the same defect the dataset manifest's
  // cross-tenant check caught in the genesis backfill — reproduced by somebody
  // who had read the comment describing it.
  //
  // `appendEvent` falls back to the platform tenant when none is given. An
  // event filed under a different tenant from its person is read by a query
  // scoped to the wrong tenant and missed by one scoped to the right one; the
  // first version of this bundle defaulted, wrote eighteen events into the
  // platform tenant, and the manifest failed the moment the bundle was applied.
  const src = code("src/lib/demo/data-scenario.ts");
  assert.match(
    src, /tenantId: tenantOf\.get\(personId\)/,
    "bundle events take the default tenant instead of their person's"
  );
  assert.match(
    src, /SELECT id, tenant_id FROM persons WHERE id IN/,
    "nothing resolves each target's tenant"
  );
  // A person with no row has no tenant to belong to, and guessing one is how
  // the defect happens. Refused instead.
  assert.match(src, /have no person row/, "a target with no person row is written anyway");
});

test("bundle events say they are fabricated in the row, not only on the screen", () => {
  // A query three layers away sees `source_system`, not a console. A bundle
  // that wrote "steady" would be indistinguishable from the generated history
  // the moment anybody reads the table instead of the page.
  const src = code("src/lib/demo/data-scenario.ts");
  assert.match(src, /sourceSystem: "demo-data-scenario"/, "bundle events do not name their source");
  assert.match(src, /fabricated: true/, "bundle events do not mark themselves fabricated");
});

// ---------------------------------------------------------------------------
// Reversible by reset
// ---------------------------------------------------------------------------

test("the applications table is cleared by reset, which is the whole of the reversal promise", () => {
  // p9 calls a bundle "reversible by reset". There is no undo on purpose — an
  // undo that removed events would mutate history, which this spine refuses to
  // do for anybody — so reset IS the reversal, and this line is what makes that
  // true rather than claimed.
  const reset = code("src/lib/demo-reset.ts");
  assert.match(
    reset, /"demo_data_scenario_applications"/,
    "reset does not clear the applications table, so a reset environment would report a " +
    "bundle in force over a population that no longer carries it"
  );

  // And there is no undo path anywhere.
  const src = code("src/lib/demo/data-scenario.ts");
  assert.doesNotMatch(src, /export (async )?function (undo|revert|remove)/,
    "a data scenario offers an undo, which would rewrite history");
});

// ---------------------------------------------------------------------------
// It cannot reach a real person
// ---------------------------------------------------------------------------

test("every target resolves inside the fabricated population", () => {
  // Fabricated by construction — every id comes from `popPersonId` over the
  // manifest — and checked anyway, because "by construction" is an argument
  // and this is a stop condition.
  const fabricated = new Set(MANIFEST.map((r) => popPersonId(r)));
  for (const s of DATA_SCENARIOS) {
    for (const row of resolveCohort(s.cohort)) {
      assert.ok(fabricated.has(popPersonId(row)), `${s.id} targets ${row.id}, which is not fabricated`);
    }
  }
  // Matched on the FILTER and its refusal, not on the helper being called.
  // A first version of this guard matched `fabricatedPersonIds()`, which
  // survives the check being deleted — the set is still built, it is simply
  // never consulted. That is the same import-versus-call mistake this codebase
  // has made in several source-reading guards.
  const src = code("src/lib/demo/data-scenario.ts");
  assert.match(
    src, /targets\.filter\(\(id\) => !fabricated\.has\(id\)\)/,
    "nothing filters the targets against the fabricated population"
  );
  assert.match(
    src, /if \(foreign\.length > 0\)/,
    "a target outside the fabricated population is found and not refused"
  );
  assert.match(src, /process\.env\.EMDR_DEMO !== "1"/, "a bundle can run outside a demo environment");
});

test("a selector reads the manifest, never an outcome", () => {
  // A selector that could express "the ten people whose scores fell most"
  // could be tuned until the demonstration says what somebody wanted it to
  // say. Every field names a manifest column, and the resolution is a filter
  // over MANIFEST in declared order — no query, no sort, no computed input.
  const src = code("src/lib/demo/data-scenario.ts");
  const at = src.indexOf("export function resolveCohort");
  const body = src.slice(at, src.indexOf("\n}", at));
  assert.match(body, /MANIFEST\.filter/, "the cohort is not resolved from the manifest");
  for (const forbidden of ["SELECT", "prepare(", ".sort(", "score", "outcome"]) {
    assert.ok(!body.includes(forbidden),
      `the selector reads "${forbidden}"; a cohort must be declared, not searched`);
  }
});

test("a bundle cannot quietly grow to the whole population", () => {
  // A quarter of the population is a demonstration; all of it is a second
  // dataset wearing the first one's name. The bound lives on the module rather
  // than in each bundle, so adding a bundle cannot raise it.
  assert.ok(MAX_COHORT > 0 && MAX_COHORT <= MANIFEST.length / 4,
    `MAX_COHORT of ${MAX_COHORT} is not a bound on a demonstration`);
  for (const s of DATA_SCENARIOS) {
    assert.ok(resolveCohort(s.cohort).length <= MAX_COHORT, `${s.id} exceeds the cohort bound`);
  }
});

// ---------------------------------------------------------------------------
// The two meanings of "scenario"
// ---------------------------------------------------------------------------

test("a data scenario and a presentation scenario are different things, and stay different", () => {
  // The confusion this holds apart is the reason the control stayed unbuilt
  // while looking built.
  const dataIds = new Set(DATA_SCENARIOS.map((s) => s.id));
  const registry = code("src/lib/demo/scenario-registry.ts");
  for (const id of dataIds) {
    assert.ok(!registry.includes(`id: "${id}"`),
      `"${id}" is both a data scenario and a presentation scenario`);
  }
  // A data scenario grants nothing and opens no screen: it has no hrefs.
  const src = code("src/lib/demo/data-scenario.ts");
  assert.doesNotMatch(src, /href:/, "a data scenario carries a route, which is a presentation concern");
});

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

test("the console shows the consequence before the control, and what is already applied", () => {
  const page = code("src/app/admin/demo/page.tsx");
  assert.match(page, /\{sc\.whatChanges\}/, "the console never says what the dataset looks like afterwards");
  assert.match(page, /applyDemoDataScenario/, "the console has no control");
  assert.match(page, /applied\.length > 0/, "the console never says the dataset has been altered");
  // An applied bundle offers no button. A control a presenter might click
  // mid-demonstration is worse than a sentence saying why it is not there.
  assert.match(page, /on \?/, "an applied bundle still renders its form");

  // And it is off the not-built list, which is a claim the screen makes about
  // itself. A screen that keeps a record of what it used to lack is a screen
  // nobody trusts to be current.
  const at = page.indexOf("const PENDING");
  assert.ok(at > 0);
  assert.ok(!page.slice(at).includes('control: "Inject data scenario"'),
    "the console still lists the data-scenario control as not built");
});

test("the bundle a presenter is most likely to want is the one p9 names", () => {
  // p9's own example is a safety pause, and it is the one most likely to be
  // faked by hand if this control does not exist — which is the row-editing
  // p29 forbids in exactly those words.
  const s = dataScenario("safety-pause");
  assert.ok(s, "p9's own example bundle is not declared");
  const types = s!.events.map((e) => e.type);
  // The full sequence, not just the gate. A gate with no rule firing before it
  // and no state change after it is a row, not a story.
  assert.deepEqual(
    types, ["safety_rule.triggered", "safety_state.changed", "coverage.gate_recorded"],
    "the safety-pause bundle is not the full sequence, so the queue item would explain nothing"
  );
  // It targets people who had no gate, or it changes nothing observable.
  assert.equal(s!.cohort.safety, "No active gate");
});
