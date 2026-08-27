// Demo reset, deterministic seed, and baseline (Demo-First handoff §5, §7).
//
// These properties are easy to lose silently: one `crypto.randomUUID()` added
// to the seed, one table missing from DEMO_DATA_TABLES, one autoincrement
// counter left climbing, and the environment stops returning to a known state
// while every surface still looks fine. The e2e suite already failed this way
// once — a spec that passed on a fresh database and failed on every re-run.
//
// Hermetic temp DB, demo mode on.
process.env.EMDR_DATA_DIR = `/tmp/steady-demoreset-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "demo-reset-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import { getDb, newId } from "../src/lib/db";
import {
  resetDemoData, demoBaseline, demoHealth, DEMO_DATA_TABLES,
} from "../src/lib/demo-reset";
import { DEMO_SEED_VERSION, demoId } from "../src/lib/demo-seed";

test("the seeded environment is healthy on first boot", () => {
  const h = demoHealth(getDb());
  assert.equal(h.ok, true, h.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join("; "));
});

test("seed identifiers are deterministic, not random", () => {
  assert.equal(demoId(0), demoId(0));
  assert.notEqual(demoId(0), demoId(1));
  // Version is part of the derivation, so bumping it moves every id.
  assert.notEqual(demoId(0), demoId(0, "some-other-version"));
});

test("two resets produce the same baseline hash", () => {
  const db = getDb();
  const a = resetDemoData(db);
  const b = resetDemoData(db);
  assert.equal(b.baseline.hash, a.baseline.hash,
    "the seed is not deterministic — a reset cannot be verified to have restored the same state");
  assert.equal(a.baseline.version, DEMO_SEED_VERSION);
  assert.deepEqual(b.baseline.counts, a.baseline.counts);
});

test("a reset removes activity created after seeding", () => {
  const db = getDb();
  const before = demoBaseline(db);

  // Simulate a viewer, a test, or a reviewer using the demo.
  const user = (db.prepare("SELECT id FROM users LIMIT 1").get() as { id: string }).id;
  db.prepare(
    `INSERT INTO lesson_reads (id, user_id, lesson_id) VALUES (?, ?, 'left-behind-by-a-viewer')`
  ).run(newId(), user);
  db.prepare(
    `INSERT INTO autonomous_signoffs (id, rule_id, config_version, verdict)
     VALUES (?, 'SOME_RULE', 'v-test', 'agree')`
  ).run(newId());

  const dirty = demoBaseline(db);
  assert.notEqual(dirty.hash, before.hash, "the baseline must notice added activity");

  const after = resetDemoData(db);
  assert.equal(after.baseline.hash, before.hash, "the reset did not restore the baseline");
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM lesson_reads WHERE lesson_id = 'left-behind-by-a-viewer'")
      .get() as { n: number }).n,
    0, "prior synthetic activity survived the reset"
  );
});

test("autoincrement counters restart, so the environment is genuinely fresh", () => {
  const db = getDb();
  resetDemoData(db);
  const first = db.prepare("SELECT MAX(id) AS m FROM audit_log").get() as { m: number | null };
  resetDemoData(db);
  const second = db.prepare("SELECT MAX(id) AS m FROM audit_log").get() as { m: number | null };
  assert.equal(second.m, first.m,
    "audit_log ids kept climbing across resets — the sequence was not cleared");
});

test("the baseline is stable across a boot, not merely within one", () => {
  // Nothing about the process should be load-bearing: the same database opened
  // again must fingerprint identically.
  const db = getDb();
  const a = demoBaseline(db);
  const b = demoBaseline(db);
  assert.equal(b.hash, a.hash);
});

test("every data table is covered by the reset", () => {
  const db = getDb();
  const known = new Set<string>(DEMO_DATA_TABLES);
  const actual = (db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table'
       AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'spine_rebuild_%'`
  ).all() as { name: string }[]).map((r) => r.name);

  const uncovered = actual.filter((t) => !known.has(t));
  assert.deepEqual(uncovered, [],
    `these tables would survive a reset: ${uncovered.join(", ")}. ` +
    "Add them to DEMO_DATA_TABLES, in an order that respects their foreign keys.");
});

test("reset refuses to run outside a demo environment", () => {
  const db = getDb();
  const saved = process.env.EMDR_DEMO;
  process.env.EMDR_DEMO = "0";
  try {
    assert.throws(() => resetDemoData(db), /EMDR_DEMO is not 1/,
      "the one operation that deletes every row must not depend on the caller having checked");
  } finally {
    process.env.EMDR_DEMO = saved;
  }
});
