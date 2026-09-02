// The fabricated/real boundary.
//
// The prerequisite for running synthetic agents alongside a study with real
// participants, and the reason it did not exist before is that it did not need
// to: every environment this code had run in was entirely fabricated, so three
// conventions — the EMDR_DEMO flag, a `fabricated` key in an event's
// provenance JSON, and a manifest check counting unmarked rows — were enough.
//
// None of them stops a cohort query spanning both populations. `Observation`
// carried no provenance at all, so a follow-up completion rate computed over a
// mixed set returned one number with no way to tell.
//
// The boundary has two halves and this file checks both. The WRITE half is
// three triggers, so a synthetic agent cannot write into a real participant's
// ledger. The READ half is a refusal in the metric layer, so a cohort cannot
// span the two populations that now legitimately coexist.

process.env.EMDR_DATA_DIR = `/tmp/steady-prov-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "provenance-test-secret-at-least-32-chars";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "provenance-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import { getDb, PLATFORM_TENANT_ID } from "../src/lib/db";
import { data } from "../src/lib/data";
import { ALL_ELIGIBLE } from "../src/lib/metrics/cohorts";
import {
  assertSingleProvenance, computeFollowupCompletion, resolve,
  type ComputeContext, type Observation,
} from "../src/lib/metrics/compute";
import { loadObservations } from "../src/lib/metrics/population-metrics";
import { populationTenantIds } from "../src/lib/planning/scope";
import { runQualityChecks } from "../src/lib/demo-quality";

const CTX: ComputeContext = {
  window: { start: "2026-06-04", end: "2026-09-02" },
  dataVersion: "test", projectionVersion: "test", refreshedAt: "2026-09-02T00:00:00Z",
  lineageRef: "lineage://test", responderThreshold: 5,
};

function person(over: Partial<Observation> = {}): Observation {
  return {
    personId: `p${Math.random()}`, region: "South", ageBand: "35-44", language: "English",
    race: [], ethnicity: null, tenantId: "t", accessNeeds: [], interpreterNeeded: false,
    state: null, hasAccount: true, provenance: "fabricated",
    daysEnrolled: 180, daysToFirstAction: 2, enrolledInWindow: true,
    activeWeeks: 10, observedWeeks: 26, daysToLastAction: 170,
    modulesStarted: 0, modulesCompleted: 0,
    measuresComplete: 3, measuresPartial: 0, measuresDeclined: 0,
    measuresUnavailable: 0, measuresSkipped: 1, measuresInterrupted: 0,
    measuresNotDue: 0, measuresUndelivered: 0,
    baseline: null, followUp: null, hadFixedPause: false, reviewLatencyHours: [],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// The write half
// ---------------------------------------------------------------------------

test("a person cannot be created without stating which they are", async () => {
  getDb();
  const c = await data();
  await assert.rejects(
    () => c.run("INSERT INTO persons (id, tenant_id, display_name) VALUES (?, ?, ?)",
      ["prov-unstated", PLATFORM_TENANT_ID, "Nobody"]),
    /must be stated as fabricated or real/,
    "a person was created with no provenance, so the first metric over them guesses",
  );
  await assert.rejects(
    () => c.run(
      "INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, ?, ?)",
      ["prov-nonsense", PLATFORM_TENANT_ID, "Nobody", "probably real"]),
    /must be stated as fabricated or real/,
  );
});

test("a person does not become real", async () => {
  getDb();
  const c = await data();
  await c.run(
    "INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, ?, 'fabricated')",
    ["prov-immutable", PLATFORM_TENANT_ID, "Fabricated person"]);
  // Relabelling a fabricated cohort after the fact would join its whole
  // history to a real denominator — the thing this boundary exists to prevent,
  // done deliberately and in one statement.
  await assert.rejects(
    () => c.run("UPDATE persons SET provenance = 'real' WHERE id = ?", ["prov-immutable"]),
    /provenance is immutable/,
  );
  const row = (await c.get("SELECT provenance FROM persons WHERE id = ?", ["prov-immutable"])) as
    { provenance: string };
  assert.equal(row.provenance, "fabricated");
});

test("a fabricated event cannot be written into a real person's ledger", async () => {
  getDb();
  const c = await data();
  await c.run(
    "INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, ?, 'real')",
    ["prov-real-person", PLATFORM_TENANT_ID, "A real participant"]);

  const insert = (provenance: string) => c.run(
    `INSERT INTO longitudinal_events
       (id, tenant_id, person_id, event_type, payload_version, payload, actor_type,
        occurred_at, recorded_at, source_system, provenance)
     VALUES (?, ?, ?, 'checkin.recorded', 1, '{}', 'system', ?, ?, 'agent', ?)`,
    [`ev-${Math.random()}`, PLATFORM_TENANT_ID, "prov-real-person",
     "2026-09-01 10:00:00", "2026-09-01 10:00:00", provenance]);

  // THE DIRECTION THAT MATTERS: a synthetic agent writing into a real
  // participant's record.
  await assert.rejects(
    () => insert(JSON.stringify({ fabricated: true, dataset_version: "agents-v1" })),
    /cannot be written into a real person/,
  );
  // A real event into the same ledger is fine, which is what makes the trigger
  // a boundary rather than a lock.
  await insert(JSON.stringify({ fabricated: false }));
  const n = (await c.get(
    "SELECT COUNT(*) AS n FROM longitudinal_events WHERE person_id = ?", ["prov-real-person"],
  )) as { n: number };
  assert.equal(Number(n.n), 1);
});

// ---------------------------------------------------------------------------
// The read half
// ---------------------------------------------------------------------------

test("a metric over a mixed population is refused, not filtered", () => {
  // THROWS rather than filters, and the difference is the whole point. A
  // filtered metric is a metric with an undisclosed denominator: the number
  // comes back looking ordinary, nothing says half the cohort was dropped, and
  // a reader cannot tell a suppressed population from a small one.
  const mixed = [
    ...Array.from({ length: 5 }, () => person({ provenance: "fabricated" })),
    ...Array.from({ length: 5 }, () => person({ provenance: "real" })),
  ];
  assert.throws(() => resolve(mixed, ALL_ELIGIBLE),
    /spans 5 fabricated people and 5 real ones/);
  assert.throws(() => computeFollowupCompletion(mixed, ALL_ELIGIBLE, CTX),
    /spans 5 fabricated people and 5 real ones/);

  // Either population alone computes normally.
  const fabricated = mixed.filter((r) => r.provenance === "fabricated");
  assert.equal(computeFollowupCompletion(fabricated, ALL_ELIGIBLE, CTX).denominator, 20);
  const real = mixed.filter((r) => r.provenance === "real");
  assert.equal(computeFollowupCompletion(real, ALL_ELIGIBLE, CTX).denominator, 20);
});

test("the refusal is on the eligible population, not on the resolved group", () => {
  // A group filter that happened to select only fabricated people would pass a
  // check on the group and still be computing against a REFERENCE that spans
  // both — so the comparison would be a fabricated cohort against a mixed
  // population, which is the failure wearing a disguise.
  const mixed = [
    ...Array.from({ length: 5 }, () => person({ provenance: "fabricated", region: "South" })),
    ...Array.from({ length: 5 }, () => person({ provenance: "real", region: "West" })),
  ];
  const southOnly = {
    id: "south.v1", version: "1.0.0", label: "South", question: "?",
    eligibility: { requiresAccount: true }, filters: { region: ["South"] },
  };
  assert.throws(() => resolve(mixed, southOnly), /spans 5 fabricated people and 5 real ones/,
    "a filter that lands on one population masked a mixed reference");
});

test("the refusal names where it happened, so it can be acted on", () => {
  const mixed = [person({ provenance: "fabricated" }), person({ provenance: "real" })];
  try {
    resolve(mixed, ALL_ELIGIBLE);
    assert.fail("no refusal");
  } catch (e) {
    const m = String((e as Error).message);
    assert.match(m, /cohort "all_eligible\.v1"/, "the refusal does not say which cohort");
    assert.match(m, /Scope the query to one population/, "the refusal does not say what to do");
  }
});

test("assertSingleProvenance permits either population alone, and an empty one", () => {
  assert.doesNotThrow(() => assertSingleProvenance([], "empty"));
  assert.doesNotThrow(() =>
    assertSingleProvenance([person({ provenance: "real" })], "all real"));
  assert.doesNotThrow(() =>
    assertSingleProvenance([person({ provenance: "fabricated" })], "all fabricated"));
});

// ---------------------------------------------------------------------------
// The seeded environment
// ---------------------------------------------------------------------------

test("every seeded person states a provenance, and the demo population is fabricated", async () => {
  getDb();
  const c = await data();
  const unstated = (await c.get(
    "SELECT COUNT(*) AS n FROM persons WHERE provenance IS NULL", [])) as { n: number };
  assert.equal(Number(unstated.n), 0, "a seeded person has no provenance");

  const rows = await loadObservations(populationTenantIds());
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.provenance === "fabricated"),
    "part of the demonstration population is labelled real");
  // And the loader joins persons rather than left-joining, so a user with no
  // person row cannot arrive with an undefined provenance and be counted as
  // real by default.
  assert.ok(rows.every((r) => r.provenance === "fabricated" || r.provenance === "real"));
});

test("the manifest reports the boundary, and reports real people rather than forbidding them", () => {
  // A human signing up in a demonstration environment is legitimate — it is
  // the reason the column distinguishes generated-by-the-system from
  // originated-by-a-person rather than demo from production. So the check
  // REPORTS the count and does not fail on it; what it fails on is a
  // fabricated event inside a real ledger, which has no benign reading.
  const checks = runQualityChecks(getDb());
  const names = checks.map((c) => c.check);
  for (const name of [
    "Provenance stated", "Fabricated events in a real ledger", "Real people in this environment",
  ]) {
    assert.ok(names.includes(name), `the manifest does not check "${name}"`);
  }
  assert.ok(checks.every((c) => c.pass), "the seeded environment fails a boundary check");
});
