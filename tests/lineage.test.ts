// Lineage — trace a screen statement to its source event
// (§26 p44 "/review/lineage", contract lineage_trace.v4, worked example p71;
// pipeline §30.1 p85).
//
// The guard that matters here is the one that proves the trace can tell a real
// chain from a fake one. A lineage screen is only worth having if "complete"
// costs something to earn — otherwise it is a green tick that renders whatever
// the ledger contains, including nothing.
//
// So these tests build both cases in a real database: a row whose event was
// appended when the thing happened, and a row whose event was reconstructed
// from it afterwards by genesis backfill. If the trace reports the same verdict
// for both, it is measuring nothing and the build fails.

process.env.EMDR_DATA_DIR = `/tmp/steady-lineage-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "lineage-test-secret-at-least-32-characters-long";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "lineage-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { getDb, PLATFORM_TENANT_ID } from "../src/lib/db";
import { PROJECTED_TABLES } from "../src/lib/projections";
import {
  traceStatement, traceableStatements, parseStatementId, PIPELINE_STAGES,
} from "../src/lib/clinical/lineage";
import { CHECKIN_ROUTING_VERSION } from "../src/lib/gating";

const db = getDb();
const PERSON = "lineage-person-1";

function seedPerson() {
  db.prepare(
    `INSERT OR IGNORE INTO users (id, tenant_id, email, password_hash, name, role)
     VALUES (?, ?, ?, 'x', 'Lineage Subject', 'member')`
  ).run(PERSON, PLATFORM_TENANT_ID, `${PERSON}@example.test`);
  db.prepare(
    `INSERT OR IGNORE INTO persons (id, tenant_id, display_name, provenance)
     VALUES (?, ?, 'Lineage Subject', 'fabricated')`
  ).run(PERSON, PLATFORM_TENANT_ID);
}

function checkin(id: string, date: string) {
  db.prepare(
    `INSERT OR REPLACE INTO checkins
       (id, user_id, tenant_id, checkin_date, activation, shutdown, harm_urge,
        feels_safe, dissociation, sleep_quality, substance_flag,
        recommended_action, created_at)
     VALUES (?, ?, ?, ?, 2, 2, 0, 1, 1, 4, 0, 'processing_ok', ?)`
  ).run(id, PERSON, PLATFORM_TENANT_ID, date, `${date} 09:15:00`);
}

/** An event appended when the thing happened: original, not a copy of the row. */
function originalEvent(eventId: string, projectionId: string, date: string, supersedes: string | null = null) {
  db.prepare(
    `INSERT OR REPLACE INTO longitudinal_events
       (id, tenant_id, person_id, event_type, payload_version, payload, actor_id,
        actor_type, occurred_at, recorded_at, source_system, provenance,
        correlation_id, supersedes_event_id)
     VALUES (?, ?, ?, 'daily_checkin.completed', 2, ?, ?, 'patient', ?, ?, 'steady', ?, NULL, ?)`
  ).run(
    eventId, PLATFORM_TENANT_ID, PERSON,
    JSON.stringify({ projectionId, checkinDate: date, recommendedAction: "processing_ok" }),
    PERSON, `${date} 09:15:00`, `${date} 09:15:00`,
    JSON.stringify({ ruleVersion: CHECKIN_ROUTING_VERSION }), supersedes
  );
}

/** What genesis backfill writes: source_system "backfill", built FROM the row. */
function reconstructedEvent(eventId: string, projectionId: string, date: string) {
  db.prepare(
    `INSERT OR REPLACE INTO longitudinal_events
       (id, tenant_id, person_id, event_type, payload_version, payload, actor_id,
        actor_type, occurred_at, recorded_at, source_system, provenance,
        correlation_id, supersedes_event_id)
     VALUES (?, ?, ?, 'daily_checkin.completed', 2, ?, ?, 'patient', ?, ?, 'backfill', ?, NULL, NULL)`
  ).run(
    eventId, PLATFORM_TENANT_ID, PERSON,
    JSON.stringify({ projectionId, checkinDate: date, recommendedAction: "processing_ok" }),
    PERSON, `${date} 09:15:00`, `${date} 09:15:00`,
    JSON.stringify({ reconstructed: true, sourceRow: `checkins:${projectionId}` })
  );
}

seedPerson();
checkin("ln-original", "2026-08-01");
originalEvent("ev-original", "ln-original", "2026-08-01");
checkin("ln-reconstructed", "2026-08-02");
reconstructedEvent("ev-reconstructed", "ln-reconstructed", "2026-08-02");
checkin("ln-orphan", "2026-08-03");
checkin("ln-corrected", "2026-08-04");
originalEvent("ev-corrected", "ln-corrected", "2026-08-04");
originalEvent("ev-correction", "ln-corrected", "2026-08-04", "ev-corrected");

test("an original chain traces complete", async () => {
  const t = await traceStatement("checkins:ln-original");
  assert.ok(t, "no trace produced");
  assert.equal(t!.state, "complete");
  assert.ok(t!.steps.every((s) => s.resolved || s.notApplicable),
    `a complete trace has an unresolved stage: ${t!.steps.filter((s) => !s.resolved && !s.notApplicable).map((s) => s.stage).join(", ")}`);
});

test("a reconstructed chain does NOT trace complete", async () => {
  // This is the whole point. Genesis backfill wrote the event FROM the row, so
  // the row is not evidence-backed — it is its own evidence. If this returned
  // "complete", the screen would be confidently wrong about the majority of the
  // demonstration's history.
  const t = await traceStatement("checkins:ln-reconstructed");
  assert.ok(t);
  assert.equal(t!.state, "gap");
  const src = t!.steps.find((s) => s.stage === "Source events")!;
  assert.equal(src.resolved, false);
  assert.match(src.gap, /reconstructed/i);
  // And the ledger stage still resolves: the event exists, it just is not a
  // source. Collapsing the two would lose the distinction the screen is for.
  assert.equal(t!.steps.find((s) => s.stage === "Event ledger")!.resolved, true);
});

test("the two verdicts actually differ", async () => {
  // A fixture that cannot distinguish two implementations is not a fixture.
  const a = await traceStatement("checkins:ln-original");
  const b = await traceStatement("checkins:ln-reconstructed");
  assert.notEqual(a!.state, b!.state,
    "an original chain and a reconstructed one produce the same verdict — the trace is measuring nothing");
});

test("a row no event names is a gap at the ledger, not a crash", async () => {
  const t = await traceStatement("checkins:ln-orphan");
  assert.ok(t);
  assert.equal(t!.state, "gap");
  assert.equal(t!.events.length, 0);
  const ledger = t!.steps.find((s) => s.stage === "Event ledger")!;
  assert.equal(ledger.resolved, false);
  assert.match(ledger.gap, /written directly|no event/i);
});

test("a correction supersedes without erasing", async () => {
  const t = await traceStatement("checkins:ln-corrected");
  assert.ok(t);
  assert.equal(t!.state, "superseded");
  // p71: "Corrections append and supersede. They never erase history." Both
  // events must still be in the trace.
  assert.equal(t!.events.length, 2);
  const corrected = t!.events.find((e) => e.id === "ev-corrected")!;
  assert.equal(corrected.supersededBy, "ev-correction");
  const correction = t!.events.find((e) => e.id === "ev-correction")!;
  assert.equal(correction.supersedes, "ev-corrected");
});

test("every projected table is traceable", async () => {
  // PROJECTED_TABLES is the definition of "has a projector". A table that gains
  // one and is not given a statement here becomes silently untraceable, and the
  // screen would go on looking complete while covering less.
  for (const t of PROJECTED_TABLES) {
    const list = await traceableStatements({ table: t, limit: 1 });
    assert.ok(Array.isArray(list), `${t} is not traceable`);
  }
});

test("a bad statement address is refused rather than guessed", async () => {
  assert.equal(parseStatementId("users:whatever"), null, "a non-projected table was accepted");
  assert.equal(parseStatementId("checkins:"), null);
  assert.equal(parseStatementId("nonsense"), null);
  assert.equal(await traceStatement("checkins:does-not-exist"), null);
});

test("the pipeline is walked in §30.1's order, backwards from the screen", async () => {
  const t = await traceStatement("checkins:ln-original");
  assert.deepEqual(t!.steps.map((s) => s.stage), [...PIPELINE_STAGES]);
  assert.equal(PIPELINE_STAGES[0], "Role views");
  assert.equal(PIPELINE_STAGES[PIPELINE_STAGES.length - 1], "Source events");
});

test("the routing rule has one version, stamped by every writer", () => {
  // The live path and the demo agent both run evaluateCheckin. If they stamp
  // different strings, the ledger records that two versions of a rule ran when
  // one function decided both.
  const src = (p: string) =>
    fs.readFileSync(path.join(process.cwd(), p), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  for (const f of ["src/lib/spine.ts", "src/lib/agents/runner.ts"]) {
    assert.ok(!src(f).includes(`"${CHECKIN_ROUTING_VERSION}"`),
      `${f} writes the routing version as a literal instead of importing CHECKIN_ROUTING_VERSION`);
    assert.match(src(f), /CHECKIN_ROUTING_VERSION/, `${f} does not stamp the routing version at all`);
  }
});

test("the demo agent records the schema version it actually used", () => {
  // It wrote a literal 1 for every event, and daily_checkin.completed is on
  // schema 2. A schema version that is present and wrong is worse than one that
  // is absent: a reader who trusts it parses the payload by the wrong shape.
  const src = fs.readFileSync(path.join(process.cwd(), "src/lib/agents/runner.ts"), "utf8");
  assert.doesNotMatch(src, /VALUES \(\?, \?, \?, \?, 1,/,
    "the agent still hard-codes payload_version 1");
  assert.match(src, /currentPayloadVersion\(/,
    "the agent does not look the payload version up from the event's registered schema");
});

test("a withheld name stays withheld in the statement list", async () => {
  // Organization and payer populations carry a NULL display_name on purpose.
  // A lineage list is not the place that gets to reverse that.
  db.prepare(`INSERT OR IGNORE INTO users (id, tenant_id, email, password_hash, name, role)
              VALUES ('ln-anon', ?, 'anon@example.test', 'x', 'x', 'member')`).run(PLATFORM_TENANT_ID);
  db.prepare(`INSERT OR IGNORE INTO persons (id, tenant_id, display_name, provenance)
              VALUES ('ln-anon', ?, NULL, 'fabricated')`).run(PLATFORM_TENANT_ID);
  db.prepare(
    `INSERT OR REPLACE INTO checkins
       (id, user_id, tenant_id, checkin_date, activation, shutdown, harm_urge,
        feels_safe, dissociation, sleep_quality, substance_flag, recommended_action, created_at)
     VALUES ('ln-anon-c', 'ln-anon', ?, '2026-08-05', 2, 2, 0, 1, 1, 4, 0, 'processing_ok', '2026-08-05 09:15:00')`
  ).run(PLATFORM_TENANT_ID);
  const list = await traceableStatements({ personId: "ln-anon", table: "checkins", limit: 1 });
  assert.equal(list.length, 1);
  assert.doesNotMatch(list[0].personLabel, /ln-anon/);
  assert.match(list[0].personLabel, /withheld/i);
});
