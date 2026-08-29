// The 240-profile demo population (handoff 07 §2, pp10–29).
//
// p29's data-quality manifest is the exit evidence for this wave, and it is
// written as a list of numbers that must hold. So it is computed here rather
// than asserted about: `checkManifest()` counts the rows, and these tests fail
// the build when a count moves.
//
// The transcription itself was verified this way. All 240 rows parsed out of
// the handoff and every balance passed on the first attempt, which is worth
// more than proofreading 240 lines — a typo in a race or a state would have
// shown up as an off-by-one somewhere in these counts.

process.env.EMDR_DATA_DIR = `/tmp/steady-pop-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "pop-test-secret-at-least-32-characters-long";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "pop-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  MANIFEST, MANIFEST_EMAIL_LIKE, checkManifest, seedFor, DATASET_VERSION,
} from "../src/lib/demo-population-manifest";
import { orgTenantId, armFor, tenantForRow, REGION_NAMES } from "../src/lib/demo-population-seed";
import { getDb } from "../src/lib/db";
import { data } from "../src/lib/data";

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

// ---------------------------------------------------------------------------
// p29's balance checks
// ---------------------------------------------------------------------------

test("every data-quality balance check passes", () => {
  const failing = checkManifest().filter((c) => !c.pass);
  assert.deepEqual(
    failing.map((f) => `${f.check}: expected ${f.expected}, got ${f.actual}`),
    [],
    "p29's manifest does not balance",
  );
});

test("the checks are computed, not asserted — a broken manifest fails them", () => {
  // A check that cannot fail is decoration. Feed it a manifest with one row
  // removed and confirm it notices, so this file is testing p29's arithmetic
  // rather than testing that a list of `true`s is true.
  const short = MANIFEST.slice(0, 239);
  const failing = checkManifest(short).filter((c) => !c.pass);
  assert.ok(failing.length >= 2,
    "removing a profile failed fewer than two checks — the counts are not being computed");
  assert.ok(failing.some((f) => f.check === "Profile count"));
});

test("the manifest is transcribed, not generated", () => {
  // p14's reproducibility rule stands on this: re-running a version must
  // produce the same ids, timestamps and values. A generator that invents the
  // population produces a different one every time its own code changes.
  const src = read("src/lib/demo-population-manifest.ts");
  const rows = (src.match(/^\s*\{ id: "ST-/gm) ?? []).length;
  assert.equal(rows, 240, `the manifest holds ${rows} literal rows, not 240`);
  assert.equal(MANIFEST.length, 240);
  // No randomness in the manifest module at all.
  assert.doesNotMatch(src, /Math\.random|crypto\.randomBytes|randomUUID/,
    "the manifest generates part of itself");
});

test("ids and seeds are deterministic within a dataset version", () => {
  const ids = new Set(MANIFEST.map((r) => r.id));
  assert.equal(ids.size, 240, "two profiles share an id");
  const seeds = new Set(MANIFEST.map(seedFor));
  assert.equal(seeds.size, 240, "two profiles share a seed, so they draw identical text");
  // The version is part of the identity, so bumping it produces a NEW
  // population rather than mutating the old one in place (p15's breaking-change
  // rule).
  const seedSrc = read("src/lib/demo-population-seed.ts");
  assert.match(seedSrc, /\$\{DATASET_VERSION\}:/,
    "record ids do not include the dataset version, so a version bump mutates the old population");
});

// ---------------------------------------------------------------------------
// p13's use rules, as structure rather than as documentation
// ---------------------------------------------------------------------------

test("demographic attributes live off `persons`, so a clinical query does not carry them", () => {
  const db = read("src/lib/db.ts");
  assert.match(db, /CREATE TABLE IF NOT EXISTS person_attributes/,
    "there is no separate attributes table");

  // The separation IS the control. If race and ethnicity sat on `persons`,
  // every query that selects a person would carry protected attributes along
  // by default; on their own table, reaching them is a join someone writes,
  // which is the moment a reviewer can ask why.
  const persons = db.slice(db.indexOf("CREATE TABLE IF NOT EXISTS persons ("),
                           db.indexOf("CREATE INDEX IF NOT EXISTS idx_persons_tenant"));
  for (const col of ["race", "ethnicity", "census_region", "socioeconomic"]) {
    assert.doesNotMatch(persons, new RegExp(col),
      `persons carries ${col} — a protected attribute on the identity table`);
  }
});

test("race permits multiple values and is never collapsed into ethnicity", () => {
  const db = read("src/lib/db.ts");
  const attrs = db.slice(db.indexOf("CREATE TABLE IF NOT EXISTS person_attributes"));
  // p13: "self-described fabricated value; allow multiple values." One column
  // holding one value forces the collapse the rule forbids.
  assert.match(attrs, /race_json TEXT/, "race cannot hold multiple values");
  assert.match(attrs, /ethnicity TEXT/, "ethnicity is not a separate field from race");
});

test("interpreter need is authored independently of language", async () => {
  // p11: "state, urbanicity, broadband access and language are authored
  // independently. The generator must not infer behavior from a stereotype
  // about a region or demographic group." Assuming every non-English speaker
  // needs an interpreter is exactly that inference.
  getDb();
  const c = await data();
  const rows = (await c.all(
    `SELECT preferred_language, interpreter_needed, COUNT(*) AS n
       FROM person_attributes GROUP BY 1, 2`, [],
  )) as { preferred_language: string; interpreter_needed: number; n: number }[];
  const nonEnglish = rows.filter((r) => r.preferred_language !== "English");
  assert.ok(nonEnglish.length > 0, "the population has no non-English speakers to check");
  const needing = nonEnglish.filter((r) => r.interpreter_needed === 1).reduce((a, r) => a + r.n, 0);
  const total = nonEnglish.reduce((a, r) => a + r.n, 0);
  assert.ok(needing > 0 && needing < total,
    `${needing} of ${total} non-English speakers need an interpreter — all or none is a stereotype, ` +
    "not an independent attribute");
});

test("no protected attribute determines an outcome", async () => {
  // p28: "Do not make protected status determine success. Use constrained
  // assignment so archetypes rotate across groups and regions." If they did
  // not rotate, the demo would teach the disparity it exists to audit.
  const byRace = new Map<string, Set<string>>();
  for (const r of MANIFEST) {
    if (!byRace.has(r.race)) byRace.set(r.race, new Set());
    byRace.get(r.race)!.add(r.archetype);
  }
  for (const [race, archetypes] of byRace) {
    assert.ok(archetypes.size >= 6,
      `people recorded as ${race} appear in only ${archetypes.size} of the eight archetypes`);
  }
  // And every region carries every archetype.
  for (const region of Object.keys(REGION_NAMES)) {
    const here = new Set(MANIFEST.filter((r) => r.region === region).map((r) => r.archetype));
    assert.equal(here.size, 8, `${region} is missing an archetype`);
  }
});

// ---------------------------------------------------------------------------
// Tenancy
// ---------------------------------------------------------------------------

test("eight demo organizations, two per region, and everyone is inside one", () => {
  const tenants = new Set(MANIFEST.map(tenantForRow));
  assert.equal(tenants.size, 8, `the population spans ${tenants.size} organizations, not eight`);
  for (const region of Object.keys(REGION_NAMES)) {
    assert.notEqual(orgTenantId(region as never, "A"), orgTenantId(region as never, "B"));
  }
  // The two arms are deliberately UNEVEN — two organizations of identical size
  // make every cross-organization comparison trivially equal, which hides the
  // kind of difference the organization console exists to surface.
  //
  // Asserted as the DESIGN (two clinicians in arm A, one in arm B) rather than
  // as a row count. The first version of this checked that arm A did not hold
  // exactly half the population, which cannot fail: the manifest gives each of
  // the three clinician slots exactly 80 people, so no two-way split of three
  // clinicians can ever produce 120/120. A guard that cannot fail is
  // decoration, and this file argues elsewhere that decoration is worse than
  // nothing because it is counted.
  const arms = new Map<string, Set<string>>();
  for (const r of MANIFEST) {
    const arm = armFor(r.clinician);
    if (!arms.has(arm)) arms.set(arm, new Set());
    arms.get(arm)!.add(r.clinician.slice(-2));
  }
  assert.equal(arms.get("A")?.size, 2, "arm A does not hold two of the three clinician slots");
  assert.equal(arms.get("B")?.size, 1, "arm B does not hold one clinician slot");

  const a = MANIFEST.filter((r) => armFor(r.clinician) === "A").length;
  assert.equal(a, 160, "the arms no longer split 160/80, so cross-organization comparison changed shape");
});

test("the seeded population lands in the database with its attributes", async () => {
  getDb();
  const c = await data();
  // Scoped to the manifest profiles, because "has attributes" is a larger set:
  // Alex and Sam were enrolled into NE Care Network A and given attributes of
  // their own, which is right and makes person_attributes 242.
  const n = (await c.get(
    `SELECT COUNT(*) AS n FROM person_attributes a
       JOIN users u ON u.id = a.person_id WHERE u.email LIKE ?`, [MANIFEST_EMAIL_LIKE],
  )) as { n: number };
  assert.equal(Number(n.n), 240, "the demo population did not seed");

  const byRegion = (await c.all(
    `SELECT a.census_region, COUNT(*) AS n FROM person_attributes a
       JOIN users u ON u.id = a.person_id WHERE u.email LIKE ? GROUP BY 1`, [MANIFEST_EMAIL_LIKE],
  )) as { census_region: string; n: number }[];
  assert.equal(byRegion.length, 4);
  for (const r of byRegion) assert.equal(Number(r.n), 60, `${r.census_region} has ${r.n} people`);
});

test("the 240 have names and the 4,820 still do not", async () => {
  // The rule is per-dataset, not global, and both halves matter. A clinician's
  // panel is meaningless without names; an organization's population is safer
  // without them, because a drilldown that cannot return a name is impossible
  // rather than merely refused.
  getDb();
  const c = await data();
  const named = (await c.get(
    `SELECT COUNT(*) AS n FROM persons p
       JOIN users u ON u.id = p.id
      WHERE u.email LIKE ? AND p.display_name IS NOT NULL`, [MANIFEST_EMAIL_LIKE],
  )) as { n: number };
  assert.equal(Number(named.n), 240, "the demo population has no names, so no panel can show it");

  const orgNamed = (await c.get(
    `SELECT COUNT(*) AS n FROM persons p
       JOIN tenants t ON t.id = p.tenant_id
      WHERE t.name = 'Northside Behavioral Health' AND p.display_name IS NOT NULL`, [],
  )) as { n: number };
  assert.equal(Number(orgNamed.n), 0,
    "the organization population acquired names — the aggregate drilldown is now merely refused, not impossible");
});

// ---------------------------------------------------------------------------
// Free text
// ---------------------------------------------------------------------------

test("free text comes from fixed dictionaries, never from a model at runtime", () => {
  // p28, verbatim: "Never ask a language model to invent uncontrolled clinical
  // narratives at runtime." Text nobody approved, that a reset cannot
  // reproduce, and that reads to an observer exactly like a real note.
  const dict = read("src/lib/demo-population-dictionaries.ts");
  const seed = read("src/lib/demo-population-seed.ts");
  for (const src of [dict, seed]) {
    assert.doesNotMatch(src, /anthropic|openai|generateText|completion\(|\.messages\.create/i,
      "the population generator calls a model");
  }
  // Three separate dictionaries, as p28 requires — a member's words, an
  // operational note and a clinician's judgement are different kinds of
  // statement and must not be drawn from one pool.
  for (const name of ["MEMBER_NOTES", "OPERATIONAL_NOTES", "CLINICIAN_COMMENTS"]) {
    assert.match(dict, new RegExp(`export const ${name}`), `there is no ${name} dictionary`);
  }
});

test("every fabricated name says so", async () => {
  getDb();
  const c = await data();
  const rows = (await c.all(
    `SELECT p.display_name AS n FROM persons p
       JOIN users u ON u.id = p.id WHERE u.email LIKE ? LIMIT 500`, [MANIFEST_EMAIL_LIKE],
  )) as { n: string }[];
  const unmarked = rows.filter((r) => !/fabricated|fictional/i.test(r.n));
  assert.deepEqual(unmarked.map((r) => r.n), [],
    "a demo person's name does not say it is fabricated — a screenshot of this is a record");
});

