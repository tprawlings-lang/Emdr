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
  resetDemoData, demoBaseline, demoHealth, DEMO_DATA_TABLES, PRESERVED_TABLES,
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

test("no seeded value carries sub-day time precision outside the excluded columns", () => {
  // The determinism guarantee failed intermittently once: `current_period_end`
  // was seeded from Date.now() WITHOUT pinning the time of day, and the column
  // does not end in `_at`, so the baseline's timestamp exclusion never covered
  // it. Two resets a second apart then produced different data and the hash
  // disagreed with itself — roughly one run in three, which is the worst way
  // for this property to fail.
  //
  // Repeating the reset is not enough to catch it: the values only diverge when
  // the two runs straddle a second boundary. So this scans the seeded data for
  // any hashed value that looks like a timestamp carrying a non-pinned time of
  // day, which fails deterministically on the first run.
  const db = getDb();
  resetDemoData(db);

  const VOLATILE = /_at$|^created$|^updated$|^plan_date$|^checkin_date$|^effective_from$|^effective_to$/;
  const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[ T](\d{2}):(\d{2}):(\d{2})/;
  const offenders: string[] = [];

  for (const table of DEMO_DATA_TABLES) {
    const rows = db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
    for (const row of rows) {
      for (const [col, value] of Object.entries(row)) {
        if (VOLATILE.test(col) || typeof value !== "string") continue;
        const m = TIMESTAMP.exec(value);
        if (!m) continue;
        // The seed pins every timestamp to a fixed minute and second. Anything
        // else was derived from the clock at seed time and will drift.
        if (m[2] !== "15" || m[3] !== "00") {
          offenders.push(`${table}.${col} = ${value}`);
        }
      }
    }
  }

  assert.deepEqual(offenders, [],
    "these seeded values carry the clock time at seed, so two resets can disagree: " +
    offenders.join(", ") + ". Pin the time of day at the source, or exclude the column.");
});

test("no seeded timestamp is in the future", () => {
  // The companion rule to the one above, and a separate failure mode. The seed
  // pins rows to a fixed time of day; `daysAgo(0, 8)` means "earlier today at
  // 08:15", which has not happened yet if the process runs before 08:15 UTC.
  // The genesis backfill then reconstructs an event that occurred after Steady
  // reconstructed it, and the whole suite fails — for the first eight hours of
  // every UTC day, which reads as a flake because most runs happen later.
  //
  // Asserted against the seeded data rather than the helper, so any future
  // source of a timestamp is covered, not just daysAgo().
  const db = getDb();
  resetDemoData(db);

  // A second of slack: the seed runs a moment before this assertion, and a
  // timestamp equal to "now" is not a defect.
  const now = new Date(Date.now() + 1000).toISOString().slice(0, 19).replace("T", " ");
  const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/;

  // Columns that are legitimately in the future: a subscription period has not
  // ended yet, which is what makes it current.
  const FUTURE_IS_CORRECT = new Set(["current_period_end", "cooldown_until", "retake_allowed_at"]);

  const future: string[] = [];
  for (const table of DEMO_DATA_TABLES) {
    for (const row of db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[]) {
      for (const [col, value] of Object.entries(row)) {
        if (FUTURE_IS_CORRECT.has(col) || typeof value !== "string") continue;
        if (!TIMESTAMP.test(value)) continue;
        if (value.replace("T", " ") > now) future.push(`${table}.${col} = ${value}`);
      }
    }
  }

  assert.deepEqual(future, [],
    "these seeded values are in the future, so a reconstructed event would " +
    "predate the record it came from: " + future.join(", "));
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

test("every data table is either cleared by the reset or deliberately preserved", () => {
  const db = getDb();
  // A table escapes the reset only by being named in PRESERVED_TABLES with a
  // stated reason. Being forgotten is not a way onto that list.
  const known = new Set<string>([...DEMO_DATA_TABLES, ...PRESERVED_TABLES]);
  const actual = (db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table'
       AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'spine_rebuild_%'`
  ).all() as { name: string }[]).map((r) => r.name);

  const uncovered = actual.filter((t) => !known.has(t));
  assert.deepEqual(uncovered, [],
    `these tables would survive a reset: ${uncovered.join(", ")}. ` +
    "Add them to DEMO_DATA_TABLES, in an order that respects their foreign keys — " +
    "or to PRESERVED_TABLES with a reason, if surviving is the point.");

  // The two lists must not overlap: a table that is both cleared and "preserved"
  // is preserved in name only.
  const both = DEMO_DATA_TABLES.filter((t) => (PRESERVED_TABLES as readonly string[]).includes(t));
  assert.deepEqual(both, [], `listed as both cleared and preserved: ${both.join(", ")}`);
});

test("reviewer change requests survive a reset", () => {
  // The output of a review session outlives the environment it was written in.
  // Wiping it would destroy the only durable product of a reviewer's hour, and
  // would do it at exactly the moment someone is preparing for the next demo.
  const db = getDb();
  assert.ok(
    (PRESERVED_TABLES as readonly string[]).includes("review_notes"),
    "review_notes is not preserved across a reset"
  );
  db.prepare(
    `INSERT INTO review_notes
       (id, reviewer_id, reviewer_role, surface, category, priority, observed, requested)
     SELECT 'note-survives', id, 'clinician', 'Caseload', 'Workflow fit', 'change',
            'observed something', 'wants something else'
       FROM users LIMIT 1`
  ).run();
  const before = (db.prepare("SELECT COUNT(*) AS n FROM review_notes").get() as { n: number }).n;
  assert.ok(before > 0, "the note was not inserted, so the assertion below would be vacuous");

  resetDemoData(db);

  const after = (db.prepare("SELECT COUNT(*) AS n FROM review_notes").get() as { n: number }).n;
  assert.equal(after, before, "a reset destroyed reviewer change requests");
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
