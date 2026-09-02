// The deterministic event generator (handoff 07 §2.4 p14, §2.7 p28, §2.8 p29).
//
// Wave 3's exit evidence is "stable event and projection hashes" (p52), and
// two properties carry it:
//
//   DETERMINISM  Re-running the same version produces the same event ids,
//                timestamps, values and projection hashes (p14). Without it
//                nothing else here can be checked twice.
//
//   COHERENCE    Follow-up values match the authored archetype AND the
//                activity path (p28). A generator that drew engagement from
//                one distribution and improvement from another would produce
//                people who improved without attending, which every chart in
//                the product would then faithfully report.

process.env.EMDR_DATA_DIR = `/tmp/steady-gen-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "gen-test-secret-at-least-32-characters-long";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "gen-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  StableRandom, DEMO_DAYS, MISSING_REASONS, TARGETS, EDGE_CASE_PROFILES, OUTCOME_INSTRUMENT,
} from "../src/lib/demo-population-generator";
import { MANIFEST } from "../src/lib/demo-population-manifest";
import { runQualityChecks, qualitySummary } from "../src/lib/demo-quality";
import { getDb } from "../src/lib/db";
import { data } from "../src/lib/data";

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

// ---------------------------------------------------------------------------
// The generator itself
// ---------------------------------------------------------------------------

test("the pseudorandom generator is seeded, documented and reproducible", () => {
  // p14: "randomness uses a documented pseudorandom generator and one stable
  // seed per profile." Math.random() is unseedable, so a dataset built on it
  // can never be reproduced — which is the whole of p14's requirement.
  const a = new StableRandom(12345);
  const b = new StableRandom(12345);
  const seqA = Array.from({ length: 50 }, () => a.next());
  const seqB = Array.from({ length: 50 }, () => b.next());
  assert.deepEqual(seqA, seqB, "the same seed produced two different sequences");

  const c = new StableRandom(12346);
  assert.notDeepEqual(seqA, Array.from({ length: 50 }, () => c.next()),
    "different seeds produced the same sequence");

  // The dataset version is part of the seed, so a version bump produces a NEW
  // population rather than the old one with edits (p15's breaking-change rule).
  const v1 = new StableRandom(12345, "demo-population-v1");
  const v2 = new StableRandom(12345, "demo-population-v2");
  assert.notEqual(v1.next(), v2.next(), "the dataset version does not affect the seed");

  // Distribution sanity — a generator that returns 0.5 forever is seeded,
  // reproducible and useless.
  const d = new StableRandom(999);
  const xs = Array.from({ length: 2000 }, () => d.next());
  assert.ok(Math.min(...xs) < 0.02 && Math.max(...xs) > 0.98, "the generator does not span [0,1)");
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  assert.ok(mean > 0.45 && mean < 0.55, `mean ${mean.toFixed(3)} is not near 0.5`);
});

test("nothing in the generator reads a clock or an unseeded random", () => {
  const src = read("src/lib/demo-population-generator.ts");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  assert.doesNotMatch(code, /Math\.random|crypto\.randomUUID|randomBytes/,
    "the generator uses an unseeded source, so its output cannot be reproduced");
  // Date.now() appears exactly once, deriving demo_epoch. Every other
  // timestamp is epoch + offset: two rows written a millisecond apart would
  // otherwise land on different days near midnight.
  const clocks = (code.match(/Date\.now\(\)/g) ?? []).length;
  assert.ok(clocks <= 1, `the generator reads the clock ${clocks} times; only demo_epoch may`);
});

test("the measure curve hits the manifest's baseline and follow-up exactly", async () => {
  // p28: "follow-up values must match the authored archetype." The manifest's
  // two numbers are the authored truth, and a curve that only APPROACHES them
  // makes the follow-up on every chart disagree with the row it came from.
  getDb();
  const c = await data();
  const wrong: string[] = [];
  for (const row of MANIFEST.slice(0, 60)) {
    // THE OUTCOME INSTRUMENT, named. A person also carries an intake battery
    // taken once at enrolment — four other instruments on four other scales —
    // and reading the screenings table unfiltered compares the manifest's
    // authored PHQ-9 baseline against whichever instrument happened to sort
    // first. That is the same confusion the console was making.
    const rows = (await c.all(
      `SELECT total_score FROM screenings
        WHERE user_id = (SELECT id FROM users WHERE email = ?)
          AND instrument = ?
        ORDER BY created_at`, [`${row.id.toLowerCase()}@steady.local`, OUTCOME_INSTRUMENT],
    )) as { total_score: number }[];
    if (rows.length === 0) { wrong.push(`${row.id}: no measures`); continue; }
    if (rows[0].total_score !== row.baseline) wrong.push(`${row.id}: first ${rows[0].total_score} ≠ baseline ${row.baseline}`);
    if (rows[rows.length - 1].total_score !== row.followUp) {
      wrong.push(`${row.id}: last ${rows[rows.length - 1].total_score} ≠ follow-up ${row.followUp}`);
    }
  }
  assert.deepEqual(wrong, [], "measure series do not match the manifest:\n  " + wrong.slice(0, 5).join("\n  "));
});

test("engagement and outcome are coherent, and Module mismatch is the exception", async () => {
  // The property p28 is protecting: outcomes are not sampled independently of
  // the history that produced them. Across the population, people who improve
  // more should have attended more — EXCEPT the one archetype authored to
  // disagree, which is why a chart must never read one from the other.
  getDb();
  const c = await data();
  const rows = (await c.all(
    `SELECT u.email, COUNT(k.id) AS checkins FROM users u
       LEFT JOIN checkins k ON k.user_id = u.id
      WHERE u.email LIKE 'st-%@steady.local' GROUP BY u.id`, [],
  )) as { email: string; checkins: number }[];
  const byId = new Map(rows.map((r) => [r.email.split("@")[0].toUpperCase(), Number(r.checkins)]));

  const improvement = (id: string) => {
    const m = MANIFEST.find((r) => r.id === id)!;
    return m.baseline - m.followUp;
  };
  const responders = MANIFEST.filter((r) => r.archetype === "Early response");
  const flat = MANIFEST.filter((r) => r.archetype === "No change");
  const avg = (rs: typeof MANIFEST, f: (id: string) => number) =>
    rs.reduce((s, r) => s + f(r.id), 0) / rs.length;

  // A MARGIN, not merely ">". Two groups drawn from the same distribution beat
  // each other about half the time, so a bare comparison passes on a generator
  // that samples engagement independently — which is the exact defect p28
  // forbids and which this assertion originally failed to detect.
  const respondersAttend = avg(responders, (id) => byId.get(id) ?? 0);
  const flatAttend = avg(flat, (id) => byId.get(id) ?? 0);
  assert.ok(respondersAttend > flatAttend * 1.25,
    `early responders average ${respondersAttend.toFixed(1)} check-ins against ${flatAttend.toFixed(1)} ` +
    "for people with no change — too close to distinguish, so engagement and outcome are uncorrelated");
  assert.ok(avg(responders, improvement) > avg(flat, improvement),
    "early responders do not improve more than people with no change");

  // The authored exception. High use, low response — and it must actually be
  // high use, or the archetype teaches nothing.
  const mismatch = MANIFEST.filter((r) => r.archetype === "Module mismatch");
  const mismatchAttend = avg(mismatch, (id) => byId.get(id) ?? 0);
  assert.ok(mismatchAttend > flatAttend * 1.25,
    `Module mismatch averages ${mismatchAttend.toFixed(1)} check-ins against ${flatAttend.toFixed(1)} ` +
    "for no-change — it is supposed to be HIGH use with low response, and it is not high");
  // And low response, or it is just another responder.
  assert.ok(avg(mismatch, improvement) < avg(responders, improvement),
    "Module mismatch improves as much as an early responder, so nothing about it is a mismatch");
});

test("missingness is recorded with one of p28's six reasons", async () => {
  getDb();
  const c = await data();
  const rows = (await c.all(
    `SELECT json_extract(payload, '$.reason') AS reason, COUNT(*) AS n
       FROM longitudinal_events WHERE event_type = 'measure.not_completed' GROUP BY 1`, [],
  )) as { reason: string; n: number }[];
  assert.ok(rows.length > 0, "no missingness was recorded, so every chart shows complete data");
  for (const r of rows) {
    assert.ok((MISSING_REASONS as readonly string[]).includes(r.reason),
      `"${r.reason}" is not one of p28's six reasons`);
  }
  // More than one reason, or the breakdown on every chart is a single bar.
  assert.ok(rows.length >= 4, `only ${rows.length} distinct reasons appear`);
});

test("every edge case p28 asks for is present and findable", async () => {
  // Authored onto NAMED profiles rather than sprinkled by probability. An edge
  // case that occurs somewhere in 240 people is one nobody can demonstrate.
  getDb();
  const c = await data();
  const personFor = (id: string) =>
    c.get("SELECT id FROM users WHERE email = ?", [`${id.toLowerCase()}@steady.local`]) as Promise<{ id: string }>;

  const dup = await personFor(EDGE_CASE_PROFILES.duplicate);
  const dupCount = (await c.get(
    `SELECT COUNT(*) AS n FROM longitudinal_events
      WHERE person_id = ? AND correlation_id IS NOT NULL AND event_type = 'coverage.reviewed'`,
    [dup.id])) as { n: number };
  assert.ok(Number(dupCount.n) >= 2, "the duplicate-event fixture is missing");

  const late = await personFor(EDGE_CASE_PROFILES.lateArrival);
  const lateRow = (await c.get(
    "SELECT occurred_at, recorded_at FROM longitudinal_events WHERE person_id = ? AND json_extract(payload,'$.lagDays') IS NOT NULL",
    [late.id])) as { occurred_at: string; recorded_at: string } | undefined;
  assert.ok(lateRow, "the late-arrival fixture is missing");
  assert.ok(lateRow!.recorded_at > lateRow!.occurred_at,
    "the late arrival was recorded before it occurred");

  const partial = await personFor(EDGE_CASE_PROFILES.partialMeasure);
  const partialRow = (await c.get(
    "SELECT payload FROM longitudinal_events WHERE person_id = ? AND json_extract(payload,'$.partial') = 1",
    [partial.id])) as { payload: string } | undefined;
  assert.ok(partialRow, "the partial-measure fixture is missing");
  // A partial measure is distinct from a missed one: some items were
  // answered, so no total can be scored but the attempt is real.
  const p = JSON.parse(partialRow!.payload);
  assert.ok(p.itemsAnswered > 0 && p.itemsAnswered < p.itemsTotal,
    "the partial measure is complete or empty, so it is not partial");

  const revoked = await personFor(EDGE_CASE_PROFILES.revokedConsent);
  const consent = (await c.get(
    "SELECT revoked_at FROM consents WHERE user_id = ? AND scope = 'measurement'",
    [revoked.id])) as { revoked_at: string | null };
  assert.ok(consent.revoked_at, "the revoked-consent fixture did not revoke the consent row");
  const withdrawn = (await c.get(
    "SELECT 1 AS x FROM longitudinal_events WHERE person_id = ? AND event_type = 'consent.withdrawn'",
    [revoked.id]));
  assert.ok(withdrawn, "consent was revoked on the row but no event says when — nothing records " +
    "which past readings were authorised");
});

// ---------------------------------------------------------------------------
// p29's data-quality manifest
// ---------------------------------------------------------------------------

test("every data-quality check passes on the generated dataset", () => {
  const results = runQualityChecks(getDb());
  const failing = results.filter((r) => !r.pass);
  assert.deepEqual(
    failing.map((f) => `${f.check}: expected ${f.expected}, got ${f.actual}`),
    [], "p29's manifest does not hold",
  );
  assert.ok(results.length >= 15, `only ${results.length} checks run`);
});

test("no event is filed under a different tenant from its person", async () => {
  // The backfill is run HERE rather than relied upon. Seeding alone writes no
  // reconstructed events, so this guard passed against a database that had
  // none — it could not have found the defect it was written for, and did not
  // when the hard-coded platform tenant was put back to check.
  // p29: "Cross-tenant references: 0". This check found a real defect — the
  // genesis backfill wrote every reconstructed event into the platform tenant
  // regardless of where its person lived. Invisible for as long as every
  // seeded user happened to be in the platform tenant, and the 240-profile
  // population is the first cohort that is not.
  getDb();
  const { backfillGenesisEvents } = await import("../src/lib/spine-backfill");
  const result = await backfillGenesisEvents();
  assert.ok(result.inserted > 100,
    `the backfill reconstructed only ${result.inserted} events — too few to exercise the tenancy path`);

  const c = await data();
  const n = (await c.get(
    `SELECT COUNT(*) AS n FROM longitudinal_events e JOIN persons p ON p.id = e.person_id
      WHERE e.tenant_id <> p.tenant_id`, [])) as { n: number };
  assert.equal(Number(n.n), 0, `${n.n} events are filed under the wrong tenant`);
});

test("p14's per-person targets hold for every profile", () => {
  const results = runQualityChecks(getDb());
  for (const label of ["check-ins", "measures", "modules"]) {
    const c = results.find((r) => r.check === `Per person — ${label}`);
    assert.ok(c, `no per-person check for ${label}`);
    assert.ok(c!.pass, `${label}: ${c!.actual} is outside p14's ${c!.expected}`);
  }
  // The bounds themselves are p14's, not ours.
  assert.deepEqual(TARGETS.checkins, [18, 90]);
  assert.deepEqual(TARGETS.measures, [4, 8]);
  assert.deepEqual(TARGETS.modules, [8, 55]);
});

test("the quality summary refuses to call a failing dataset fit", () => {
  // p29: the admin page blocks external demonstrations when the checks fail.
  // A summary that reports "ok" while something fails would make that block
  // unreachable.
  const ok = qualitySummary([{ check: "a", expected: "", actual: "", pass: true }]);
  assert.equal(ok.ok, true);
  const bad = qualitySummary([
    { check: "a", expected: "", actual: "", pass: true },
    { check: "b", expected: "", actual: "", pass: false },
  ]);
  assert.equal(bad.ok, false);
  assert.equal(bad.failed, 1);
});

test("the demo epoch is six months and every timestamp derives from it", () => {
  assert.equal(DEMO_DAYS, 180, "the window is not the six months p14 specifies");
  const src = read("src/lib/demo-population-generator.ts");
  // Every insert takes a dayStamp/dayDate, never a raw ISO string built inline.
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, " "), /new Date\(\)\.toISOString/,
    "a timestamp is read from the wall clock instead of derived from demo_epoch");
});
