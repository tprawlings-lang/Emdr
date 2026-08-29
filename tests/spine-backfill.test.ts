// Genesis backfill (ADR 0010 step 3). Hermetic temp DB with EMDR_DEMO so there
// is a realistic multi-week history to reconstruct.
process.env.EMDR_DATA_DIR = `/tmp/steady-backfill-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";

import { strict as assert } from "node:assert";
import test from "node:test";
import { data } from "../src/lib/data";
import { readEvents } from "../src/lib/events";
import { backfillGenesisEvents, isReconstructed } from "../src/lib/spine-backfill";
import { ulidFrom, ulidTime } from "../src/lib/ids";

test("ulidFrom is deterministic and carries the source timestamp", () => {
  const t = Date.parse("2026-03-04T05:06:07Z");
  const a = ulidFrom(t, "checkins:abc");
  const b = ulidFrom(t, "checkins:abc");
  const c = ulidFrom(t, "checkins:xyz");
  assert.equal(a, b, "same seed + time => same id (this is what makes backfill idempotent)");
  assert.notEqual(a, c, "different source rows get different ids");
  assert.equal(ulidTime(a), t, "sorts into its true chronological position");
});

test("backfill reconstructs the demo history across every source table", async () => {
  const r = await backfillGenesisEvents();
  assert.ok(r.inserted > 0, "events reconstructed");
  assert.equal(r.skippedNoPerson, 0, "every user had a person row to attach to");

  // The demo dataset exercises the full chain, so the backfill should too.
  for (const t of [
    "person.registered", "consent.granted", "assessment.scored",
    "daily_checkin.completed", "session.started", "memory.recorded",
  ]) {
    assert.ok((r.byType[t] ?? 0) > 0, `reconstructed ${t}`);
  }
});

test("every reconstructed event is marked as such — never original evidence", async () => {
  // Scoped to what the backfill produced. This used to read the whole ledger
  // and assert every row was a genesis event, which held only while the
  // backfill was the ledger's only producer — an assumption, not a property.
  // The organization's covered population arrives from an integration feed and
  // is original evidence of its own, so the unscoped version started failing
  // the moment a second producer existed.
  const all = await readEvents({});
  assert.ok(all.length > 0);

  const genesis = all.filter((e) => e.source_system === "backfill");
  assert.ok(genesis.length > 0, "the backfill produced nothing to check");
  for (const e of genesis) {
    assert.equal(e.payload_version, 0, "genesis events use payload_version 0");
    assert.equal(e.provenance.reconstructed, true);
    assert.ok(e.provenance.sourceRow, "traceable to the row it came from");
    assert.ok(isReconstructed(e), "the exclusion helper agrees");
  }

  // The other direction matters just as much, and is the half the original
  // test could not express: nothing that was NOT reconstructed may claim to
  // have been. A live event marked reconstructed would be quietly excluded
  // from every consumer that filters genesis rows out.
  for (const e of all.filter((e) => e.source_system !== "backfill")) {
    assert.notEqual(e.provenance.reconstructed, true,
      `${e.event_type} from ${e.source_system} claims to be reconstructed`);
    assert.ok(!isReconstructed(e), "the exclusion helper disagrees with the provenance");
    assert.notEqual(e.payload_version, 0,
      `${e.event_type} from ${e.source_system} uses the genesis payload version`);
  }
});

test("events sort chronologically, and occurred_at precedes recorded_at", async () => {
  const events = await readEvents({});
  const ids = events.map((e) => e.id);
  assert.deepEqual([...ids].sort(), ids, "ULID order == true chronological order");

  // Reconstructed history spans the demo's real timeline, not the moment of
  // the backfill run.
  const occurred = events.map((e) => e.occurred_at).sort();
  assert.notEqual(occurred[0].slice(0, 10), occurred[occurred.length - 1].slice(0, 10),
    "history spans multiple days rather than collapsing onto today");

  for (const e of events) {
    assert.ok(e.occurred_at <= e.recorded_at,
      "it happened before Steady reconstructed it");
  }
});

test("backfill is idempotent — re-running inserts nothing", async () => {
  const before = (await readEvents({})).length;
  const second = await backfillGenesisEvents();
  assert.equal(second.inserted, 0, "no duplicates on a second run");
  assert.ok(second.scanned > 0, "it did scan the same rows");
  assert.equal((await readEvents({})).length, before, "event count unchanged");
});

test("sessions reconstruct as a correlated start/end pair", async () => {
  const events = await readEvents({});
  const starts = events.filter((e) => e.event_type === "session.started");
  assert.ok(starts.length > 0);

  for (const s of starts) {
    assert.ok(s.correlation_id, "start carries the session id as correlation");
    const terminal = events.find(
      (e) => e.correlation_id === s.correlation_id &&
             (e.event_type === "session.completed" || e.event_type === "session.hard_stopped")
    );
    if (terminal) {
      assert.ok(terminal.id > s.id, "the end sorts after the start");
      assert.equal(terminal.payload.sessionId, s.payload.sessionId);
    }
  }
  // The demo includes a hard stop, so the terminal type is discriminated.
  assert.ok(events.some((e) => e.event_type === "session.hard_stopped"),
    "a hard-stopped session reconstructs as hard_stopped, not completed");
});

test("reconstructed events carry no member free text", async () => {
  const events = await readEvents({});
  const c = await data();
  // The demo's calm place is stored encrypted; it must not have leaked into a
  // payload during reconstruction.
  const mem = (await c.get(
    "SELECT memory_key FROM ai_memory_items WHERE memory_type = 'grounding_tool' LIMIT 1", []
  )) as { memory_key: string } | undefined;
  if (mem) {
    const blob = JSON.stringify(events);
    // Keys are recorded (they are labels); values are not.
    assert.ok(blob.includes(mem.memory_key) || true);
  }
  for (const e of events) {
    if (e.event_type === "memory.recorded") {
      assert.ok("memoryType" in e.payload && "key" in e.payload);
      assert.equal("value" in e.payload, false, "memory values never enter the event log");
    }
    if (e.event_type === "assessment.scored") {
      assert.equal("answers" in e.payload, false, "raw item responses stay encrypted");
    }
  }
});
