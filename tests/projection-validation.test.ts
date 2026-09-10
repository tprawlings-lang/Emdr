process.env.EMDR_DATA_DIR = `/tmp/steady-projval-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";

// Projection validation (handoff 07 Wave 8, p9's "Validate projections").
//
// p9: "Rebuild every projection and compare hashes; fail the page if any role's
// view differs." The console listed this as needing "expected projection hashes
// in the seed manifest", and the guards below are about those hashes meaning
// something.
//
// THE DISTINCTION THIS RESTS ON, because getting it wrong makes the whole
// control redundant. `verifyProjections` asks whether the projections agree
// with their own events. This asks whether the dataset is the one that was
// published. BOTH CAN PASS WHILE THE SECOND IS FALSE: a data scenario appends
// events, the replay agrees with them perfectly, and every screen shows a
// population nobody rehearsed. That is precisely the failure the expected
// hashes catch and the replay cannot, so a guard holds the two apart.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { getDb } from "../src/lib/db";
import { resetDemoData, tableFingerprint } from "../src/lib/demo-reset";
import {
  projectionHashes, validateProjections, validationRemedy,
} from "../src/lib/demo/projection-hashes";
import { EXPECTED_PROJECTION_HASHES } from "../src/lib/demo/projection-hashes.generated";
import { PROJECTED_TABLES } from "../src/lib/projections";
import { DATASET_VERSION } from "../src/lib/demo-population-manifest";
import { environmentStatus } from "../src/lib/demo/preflight";

const ROOT = path.join(__dirname, "..");
const code = (rel: string) =>
  fs.readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");

// One reset for the whole file: it rebuilds the population and is the
// expensive part of every assertion below.
const db = getDb();
resetDemoData(db);

// ---------------------------------------------------------------------------
// The committed hashes describe the seed
// ---------------------------------------------------------------------------

test("the committed hashes match a freshly reset environment", () => {
  // The generated-artifact rule this codebase uses everywhere: a generated file
  // nobody verifies is a stale file. This one fails the suite the moment the
  // seed changes without the hashes being regenerated — which is the intended
  // failure, and the message says how to clear it.
  const v = validateProjections(db);
  assert.deepEqual(
    v.drifted, [],
    `these tables differ from the committed hashes: ${v.drifted.join(", ")}.\n` +
    "If the seed changed on purpose, run `npm run gen:projection-hashes` and commit the result."
  );
  assert.deepEqual(
    v.unrecorded, [],
    `no hash is recorded for ${v.unrecorded.join(", ")}; run \`npm run gen:projection-hashes\``
  );
  assert.ok(v.ok);
});

test("every projected table has an entry, so the set cannot shrink quietly", () => {
  // An expected set that silently ignores a new table is one that stops
  // covering the dataset one table at a time.
  const recorded = EXPECTED_PROJECTION_HASHES[DATASET_VERSION];
  assert.ok(recorded, `nothing is recorded for ${DATASET_VERSION}`);
  for (const t of PROJECTED_TABLES) {
    assert.ok(t in recorded!, `${t} is projected but has no recorded hash`);
  }
  assert.equal(
    Object.keys(recorded!).length, PROJECTED_TABLES.length,
    "the recorded set and the projected set are different sizes"
  );
});

test("a hash is stable across two resets, or it is not a hash of the dataset", () => {
  // The property the generator script refuses to write without. A hash taken
  // from a nondeterministic seed fails on every other machine, and the failure
  // reads as drift rather than as nondeterminism — which is the worst kind of
  // red, because the remedy for it is nothing.
  const before = projectionHashes(db);
  resetDemoData(db);
  const after = projectionHashes(db);
  for (let i = 0; i < before.length; i++) {
    assert.equal(
      after[i].hash, before[i].hash,
      `${before[i].table} hashes differently after a second reset; the seed is not deterministic`
    );
  }
});

// ---------------------------------------------------------------------------
// It catches what the replay cannot
// ---------------------------------------------------------------------------

test("a changed row changes exactly one table's hash", () => {
  // The point of hashing per table rather than the whole dataset: p9 says
  // "fail the page if any ROLE'S VIEW differs", and a single number cannot
  // name which one.
  const before = projectionHashes(db);
  const withRows = before.find((h) => h.hash !== null);
  assert.ok(withRows, "no projected table has rows, so this proves nothing");

  const row = db.prepare(`SELECT id FROM ${withRows!.table} LIMIT 1`).get() as { id: string };
  db.prepare(`DELETE FROM ${withRows!.table} WHERE id = ?`).run(row.id);

  const after = projectionHashes(db);
  const moved = after.filter((h, i) => h.hash !== before[i].hash).map((h) => h.table);
  assert.deepEqual(moved, [withRows!.table], "a single-table change did not isolate to one table");

  const v = validateProjections(db);
  assert.ok(!v.ok, "a deleted row still validates");
  assert.deepEqual(v.drifted, [withRows!.table]);

  resetDemoData(db);
});

test("a hash covers content, not wall-clock time", () => {
  // The fingerprint excludes volatile columns by design; without that the hash
  // would change daily and prove nothing. Asserted through the shared helper
  // so the baseline and these hashes cannot drift apart on the question of
  // what makes two datasets the same.
  const fp = tableFingerprint(db, "checkins");
  assert.ok(fp.length > 1, "checkins has no rows to fingerprint");
  assert.match(fp[0], /^cols=/, "the fingerprint has no column header");
  assert.ok(!fp[0].includes("created_at"), "the fingerprint covers a timestamp column");
  // One definition, used twice.
  assert.match(
    code("src/lib/demo/projection-hashes.ts"), /tableFingerprint\(/,
    "the projection hashes do not use the shared fingerprint, so the two can disagree"
  );
});

// ---------------------------------------------------------------------------
// Not knowing is not passing
// ---------------------------------------------------------------------------

test("an unrecorded table and an unknown dataset version both fail rather than pass", () => {
  const v = validateProjections(db);
  assert.ok(v.ok, "precondition: this environment validates");

  // RUN AGAINST A SET THAT SHOULD FAIL, rather than read out of the source.
  // The first version of this guard asserted the shape of the verdict
  // expression, and an implementation that fell back to the live hash when
  // none was recorded — `expected[table] ?? hash` — passed it while making
  // every table match trivially. A check that can only be broken in ways the
  // guard happens to spell is not a check.
  const none = validateProjections(db, {});
  assert.equal(none.ok, false, "an empty manifest validates, so nothing is actually compared");
  assert.equal(none.drifted.length, 0, "an unrecorded table is reported as drifted");
  assert.equal(
    none.unrecorded.length, PROJECTED_TABLES.length,
    "an unrecorded table is not reported as unrecorded"
  );

  // A recorded-but-wrong hash is a DIFFERENCE, which is a different finding
  // with a different remedy — the console prints one or the other.
  const wrong = validateProjections(db, { checkins: "0".repeat(64) });
  assert.deepEqual(wrong.drifted, ["checkins"], "a wrong hash is not reported as drift");
  assert.equal(wrong.ok, false);

  // And a manifest holding exactly what is there passes, or the check would
  // fail for everything and prove nothing.
  const live: Record<string, string | null> = {};
  for (const h of projectionHashes(db)) live[h.table] = h.hash;
  assert.equal(validateProjections(db, live).ok, true, "the live hashes do not validate");
});

test("a failing validation states its remedy, and the two remedies are opposite", () => {
  // A check whose failure has no stated remedy is a check people learn to
  // click past. The two cases are genuinely different: a deliberate seed
  // change wants a regeneration, and a corrupted environment wants a reset.
  // The hash cannot tell them apart, so the text says so rather than guessing.
  assert.equal(validationRemedy(validateProjections(db)), null, "a passing check offers a remedy");

  const drifted = validationRemedy({
    datasetVersion: DATASET_VERSION, ok: false,
    checks: [], drifted: ["checkins"], unrecorded: [],
  });
  assert.match(drifted!, /gen:projection-hashes/, "no regeneration remedy");
  assert.match(drifted!, /reset/, "no reset remedy");
  assert.match(drifted!, /does not say which is right/, "the remedy claims the hash knows which is right");

  const missing = validationRemedy({
    datasetVersion: DATASET_VERSION, ok: false,
    checks: [], drifted: [], unrecorded: ["checkins"],
  });
  assert.match(missing!, /gap in the seed manifest/, "a missing hash is reported as a data problem");
});

// ---------------------------------------------------------------------------
// p29's gate
// ---------------------------------------------------------------------------

test("p29's block covers projection verification, not only the reset", () => {
  // p29: "the admin page blocks external demonstrations when the latest reset
  // OR PROJECTION VERIFICATION failed." The reset half was implemented from
  // the start and this half was not, which left the sentence half-done in the
  // direction that does not announce itself.
  const status = environmentStatus(db);
  const check = status.checks.find((c) => c.id === "projection_hashes");
  assert.ok(check, "the preflight gate has no projection check");
  assert.ok(check!.pass, "the projection check fails on a freshly reset environment");

  // And it really blocks. Break one table and the environment must stop
  // reading as ready.
  const t = projectionHashes(db).find((h) => h.hash !== null)!.table;
  const row = db.prepare(`SELECT id FROM ${t} LIMIT 1`).get() as { id: string };
  db.prepare(`DELETE FROM ${t} WHERE id = ?`).run(row.id);

  const broken = environmentStatus(db);
  assert.equal(broken.state, "blocked", "a drifted dataset still reads as ready");
  assert.ok(
    broken.failures.some((f) => f.id === "projection_hashes"),
    "the drift is not among the reported failures"
  );

  resetDemoData(db);
});

test("a scenario cannot require a check the preflight does not have", () => {
  // The requirement ids scenarios name are the check ids; adding a check must
  // not silently orphan a scenario's requirement, and a scenario must not be
  // able to invent a requirement that always passes.
  const ids = new Set(environmentStatus(db).checks.map((c) => c.id));
  assert.ok(ids.has("projection_hashes"));
  const registry = code("src/lib/demo/scenario-registry.ts");
  for (const m of registry.matchAll(/requires: \[([^\]]*)\]/g)) {
    for (const raw of m[1].split(",")) {
      const id = raw.trim().replace(/^"|"$/g, "");
      if (id) assert.ok(ids.has(id), `a scenario requires "${id}", which is not a preflight check`);
    }
  }
});

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

test("the console names the drifted table and never prints a whole digest", () => {
  const page = code("src/app/admin/demo/page.tsx");
  assert.match(page, /validateProjections\(getDb\(\)\)/, "the console does not validate");
  assert.match(page, /\{c\.table\}/, "the console never names which table drifted");
  assert.match(page, /\{remedy\}/, "the console never states the remedy");
  // A wall of hex teaches a reader to skip the row.
  assert.match(page, /c\.actual\.slice\(0, 16\)/, "the console prints a full digest");

  // Off the not-built list, which is a claim the screen makes about itself.
  const at = page.indexOf("const PENDING");
  assert.ok(at > 0);
  assert.ok(!page.slice(at).includes('control: "Validate projections"'),
    "the console still lists projection validation as not built");
});
