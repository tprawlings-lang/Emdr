// Replay against a realistic multi-week dataset (ADR 0010 steps 3–4).
//
// tests/projections.test.ts proves the LIVE path replays: write through the
// product, rebuild, compare. This file proves the other half — that history
// reconstructed by the genesis backfill also replays.
//
// That matters because the two producers are different. Dual-write records an
// event at the moment something happens; the backfill reconstructs one after
// the fact from a row. If the second is lossy, every member who existed before
// the spine shipped has a history that cannot be rebuilt — and nobody would
// notice, because the live path would keep passing.
//
// The demo dataset is the fixture: three weeks of check-ins, nine sessions
// including a hard stop, consents, unlock requests, and clinician decisions.
// It is also what a reviewer actually sees when they open the demo, so a pass
// here is a claim about the thing being demonstrated.
//
// Hermetic temp DB, seeded with the demo dataset.
process.env.EMDR_DATA_DIR = `/tmp/steady-projdemo-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";

import { strict as assert } from "node:assert";
import test from "node:test";
import { data } from "../src/lib/data";
import { backfillGenesisEvents, isReconstructed } from "../src/lib/spine-backfill";
import { readEvents } from "../src/lib/events";
import { verifyProjections, formatVerifyResult } from "../src/lib/projections";

test("setup: the demo dataset backfills into genesis events", async () => {
  const c = await data();
  const sessions = (await c.get("SELECT COUNT(*) AS n FROM therapy_sessions", [])) as { n: number };
  assert.ok(Number(sessions.n) >= 8, "the demo dataset really is seeded");

  const r = await backfillGenesisEvents();
  assert.ok(r.inserted > 0, "events were reconstructed");
  assert.equal(r.skippedNoPerson, 0, "every row's subject exists on the identity spine");
});

test("a realistic multi-week history replays byte-identically", async () => {
  const v = await verifyProjections();
  assert.equal(v.identical, true, formatVerifyResult(v));

  // Guard against a vacuous pass: the tables this dataset actually populates
  // must have had rows to compare.
  for (const t of ["checkins", "therapy_sessions", "consents", "module_unlocks"]) {
    assert.ok((v.compared[t] ?? 0) > 0, `${t} had no rows — the comparison would prove nothing`);
  }
  assert.ok(v.compared.therapy_sessions >= 8);
});

test("a hard-stopped session replays as hard-stopped, with its reason intact", async () => {
  const c = await data();
  const live = (await c.get(
    "SELECT id, status, hard_stop_reason, peak_suds FROM therapy_sessions WHERE status = 'hard_stop'", []
  )) as { id: string; status: string; hard_stop_reason: string; peak_suds: number };
  assert.ok(live, "the demo dataset includes a hard stop");

  const built = (await c.get(
    "SELECT status, hard_stop_reason, peak_suds, ended_at, started_at FROM spine_rebuild_therapy_sessions WHERE id = ?",
    [live.id]
  )) as { status: string; hard_stop_reason: string; peak_suds: number; ended_at: string; started_at: string };

  assert.equal(built.status, "hard_stop");
  assert.equal(built.hard_stop_reason, live.hard_stop_reason);
  assert.equal(Number(built.peak_suds), Number(live.peak_suds));
  // The safety-relevant ordering: a session cannot end before it began. Source
  // timestamps are second-resolution, so a session that starts and stops inside
  // one second used to reconstruct in an arbitrary order.
  assert.ok(built.ended_at >= built.started_at);
});

test("an undecided unlock request replays as still pending", async () => {
  const c = await data();
  const live = (await c.get(
    "SELECT id, status, member_note FROM module_unlocks WHERE status = 'requested'", []
  )) as { id: string; status: string; member_note: string | null };
  assert.ok(live, "the demo dataset includes a pending request");

  const built = (await c.get(
    "SELECT status, member_note, decided_at, clinician_id FROM spine_rebuild_module_unlocks WHERE id = ?",
    [live.id]
  )) as { status: string; member_note: string | null; decided_at: string | null; clinician_id: string | null };

  assert.equal(built.status, "requested");
  assert.equal(built.member_note, live.member_note);
  assert.equal(built.decided_at, null, "a request nobody has answered has no decision");
  assert.equal(built.clinician_id, null);
});

test("reconstructed events are marked as such and never pass as original evidence", async () => {
  const events = await readEvents({});
  assert.ok(events.length > 0);
  const genesis = events.filter((e) => isReconstructed(e));
  assert.ok(genesis.length > 0);

  for (const e of genesis) {
    assert.equal(e.payload_version, 0);
    assert.equal(e.source_system, "backfill");
    assert.equal(e.provenance.reconstructed, true);
  }
});

test("re-running the backfill inserts nothing and the replay still matches", async () => {
  const again = await backfillGenesisEvents();
  assert.equal(again.inserted, 0, "idempotent: identical ids, so the second run is a no-op");

  const v = await verifyProjections();
  assert.equal(v.identical, true, formatVerifyResult(v));
});
