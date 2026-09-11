process.env.EMDR_DATA_DIR = `/tmp/steady-pilotconsole-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "pilot-console-test-key";
process.env.EMDR_SESSION_SECRET = process.env.EMDR_SESSION_SECRET ?? "pilot-console-test-secret-not-real";

// The screen that reads the pilot back.
//
// WHAT IT IS FOR: enrollment shipped with a gate, a cap, a count and no way to
// see a single answer. The whole reason for asking real people to use this is
// what they then say.
//
// WHAT IT MUST NOT BECOME. It shows real people's answers to questions about
// suicidal thoughts, so three properties are load-bearing and none of them is
// about layout:
//
//   1. One population. A table mixing the 240 fabricated profiles with pilot
//      participants is a table nobody can read a conclusion from — the same
//      rule `assertSingleProvenance` enforces on metrics.
//   2. Counts, never rates. At a cap of twenty-five, "67%" is two people out of
//      three wearing the clothes of a finding.
//   3. It is not a clinical surface, and it says so. A list of safety answers
//      laid out like a caseload gets read as a caseload otherwise.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { getDb } from "../src/lib/db";
import { resetDemoData } from "../src/lib/demo-reset";
import { pilotTenantId } from "../src/lib/enrollment/gate";
import { pilotParticipants, pilotSummary } from "../src/lib/enrollment/pilot-console";
import { FITNESS_SCREENER_ID } from "../src/lib/fitness-screener";

const ROOT = path.join(__dirname, "..");
const code = (rel: string) =>
  fs.readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");

/** A pilot participant, written straight to the tables. */
async function seedParticipant(id: string, name: string, opts: {
  fitFlags?: string[]; checkins?: { action: string; harmUrge?: boolean; feelsSafe?: boolean }[];
  measure?: { instrument: string; score: number };
} = {}) {
  const db = getDb();
  const tenant = await pilotTenantId();
  db.prepare(
    `INSERT INTO users (id, email, name, role, password_hash, status, tenant_id)
     VALUES (?, ?, ?, 'member', 'x', 'active', ?)`
  ).run(id, `${id}@example.test`, name, tenant);
  db.prepare(
    "INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, ?, 'real')"
  ).run(id, tenant, name);
  if (opts.fitFlags) {
    db.prepare(
      `INSERT INTO screenings (id, user_id, instrument, instrument_version, total_score, answers_json, risk_flags_json)
       VALUES (?, ?, ?, 'v1', 0, '{}', ?)`
    ).run(`${id}-fit`, id, FITNESS_SCREENER_ID, JSON.stringify(opts.fitFlags));
  }
  if (opts.measure) {
    db.prepare(
      `INSERT INTO screenings (id, user_id, instrument, instrument_version, total_score, answers_json, risk_flags_json)
       VALUES (?, ?, ?, 'v1', ?, '{}', '[]')`
    ).run(`${id}-m`, id, opts.measure.instrument, opts.measure.score);
  }
  for (const [i, k] of (opts.checkins ?? []).entries()) {
    db.prepare(
      `INSERT INTO checkins (id, user_id, checkin_date, activation, shutdown, harm_urge,
        feels_safe, dissociation, sleep_quality, substance_flag, recommended_action, triggers_json)
       VALUES (?, ?, ?, 3, 3, ?, ?, 2, 5, 0, ?, '[]')`
    ).run(`${id}-c${i}`, id, `2026-09-0${i + 1}`,
      k.harmUrge ? 1 : 0, k.feelsSafe === false ? 0 : 1, k.action);
  }
}

// ---------------------------------------------------------------------------
// One population
// ---------------------------------------------------------------------------

test("only real people in the pilot tenant appear, never the fabricated population", async () => {
  const db = getDb();
  resetDemoData(db);

  // The seed puts 240-odd fabricated people in the care-network tenants. Not
  // one of them belongs on this screen.
  const fabricated = (db.prepare(
    "SELECT COUNT(*) AS n FROM persons WHERE provenance = 'fabricated'"
  ).get() as { n: number }).n;
  assert.ok(fabricated > 100, `expected a seeded population, found ${fabricated}`);
  assert.deepEqual(await pilotParticipants(), [],
    "the console listed somebody before anybody enrolled");

  await seedParticipant("pc-1", "Real Person");
  const rows = await pilotParticipants();
  assert.equal(rows.length, 1, "the console does not show the person who enrolled");
  assert.equal(rows[0].name, "Real Person");

  // A fabricated person planted in the pilot tenant is still excluded — the
  // filter is on provenance, not only on the tenant, so neither half alone can
  // let the populations mix.
  const tenant = await pilotTenantId();
  db.prepare(
    `INSERT INTO users (id, email, name, role, password_hash, status, tenant_id)
     VALUES ('pc-fake', 'fake@example.test', 'Fake (fabricated)', 'member', 'x', 'active', ?)`
  ).run(tenant);
  db.prepare(
    "INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES ('pc-fake', ?, 'Fake', 'fabricated')"
  ).run(tenant);
  const after = await pilotParticipants();
  assert.equal(after.length, 1,
    "a fabricated person in the pilot tenant reached a screen about real people");
  resetDemoData(db);
});

// ---------------------------------------------------------------------------
// What it reports
// ---------------------------------------------------------------------------

test("stage is derived from what somebody wrote, in order", async () => {
  const db = getDb();
  resetDemoData(db);
  await seedParticipant("st-1", "Only Signed Up");
  await seedParticipant("st-2", "Screened", { fitFlags: [] });
  await seedParticipant("st-3", "Measured", { fitFlags: [], measure: { instrument: "phq-9", score: 12 } });
  await seedParticipant("st-4", "Active", {
    fitFlags: [], measure: { instrument: "phq-9", score: 9 },
    checkins: [{ action: "processing_ok" }],
  });

  const byName = new Map((await pilotParticipants()).map((r) => [r.name, r]));
  assert.equal(byName.get("Only Signed Up")!.stage, "signed_up");
  assert.equal(byName.get("Screened")!.stage, "screened");
  assert.equal(byName.get("Measured")!.stage, "measured");
  assert.equal(byName.get("Active")!.stage, "active");
  resetDemoData(db);
});

test("a hard stop and a soft flag are told apart, and the QUESTION is carried", async () => {
  // Not the item id. A console printing `selfharm_30d` makes the reader
  // reconstruct what was asked — and this is the answer that matters most.
  const db = getDb();
  resetDemoData(db);
  await seedParticipant("f-1", "Stopped", { fitFlags: ["hard_stop:selfharm_30d"] });
  await seedParticipant("f-2", "Flagged", { fitFlags: ["soft_flag:seizure"] });
  await seedParticipant("f-3", "Clear", { fitFlags: [] });

  const byName = new Map((await pilotParticipants()).map((r) => [r.name, r]));
  assert.equal(byName.get("Stopped")!.fit?.outcome, "hard_stop");
  assert.equal(byName.get("Flagged")!.fit?.outcome, "soft_flag");
  assert.equal(byName.get("Clear")!.fit?.outcome, "pass");

  const positive = byName.get("Stopped")!.fit!.positives[0];
  assert.ok(positive, "a hard stop carried no positive answer");
  assert.match(positive.question, /suicidal thoughts/i,
    "the console reports an item id rather than the question that was asked");
  assert.equal(positive.onYes, "hard_stop");
  assert.equal(byName.get("Clear")!.fit!.positives.length, 0);
  resetDemoData(db);
});

test("a safety positive is counted from any of its three shapes", async () => {
  // The routing decision, the harm-urge item, and "I do not feel safe" are
  // three different ways the same thing shows up, and counting only one would
  // under-report the number this screen exists to surface.
  const db = getDb();
  resetDemoData(db);
  await seedParticipant("sp-1", "Crisis routed", { checkins: [{ action: "crisis" }] });
  await seedParticipant("sp-2", "Harm urge", { checkins: [{ action: "grounding_only", harmUrge: true }] });
  await seedParticipant("sp-3", "Not safe", { checkins: [{ action: "grounding_only", feelsSafe: false }] });
  await seedParticipant("sp-4", "Ordinary", { checkins: [{ action: "processing_ok" }] });

  const byName = new Map((await pilotParticipants()).map((r) => [r.name, r]));
  for (const who of ["Crisis routed", "Harm urge", "Not safe"]) {
    assert.equal(byName.get(who)!.safetyPositives, 1, `${who} was not counted as a safety positive`);
  }
  assert.equal(byName.get("Ordinary")!.safetyPositives, 0, "an ordinary check-in counted as a positive");

  // The summary counts PEOPLE, not events.
  const s = pilotSummary([...byName.values()]);
  assert.equal(s.peopleWithSafetyPositive, 3);
  assert.equal(s.participants, 4);
  assert.equal(s.totalCheckins, 4);
  resetDemoData(db);
});

// ---------------------------------------------------------------------------
// What the screen must say, and must not do
// ---------------------------------------------------------------------------

test("the screen says these are real people, before it shows their answers", () => {
  const page = code("src/app/admin/pilot/page.tsx");
  const claim = page.indexOf("These are real people");
  assert.ok(claim > 0, "the screen never says the people on it are real");
  const first = page.indexOf("pilotParticipants");
  assert.ok(first > 0);
  assert.match(page, /nothing on it is a clinical record|not a clinical record/i,
    "the screen does not say what it is not");
  assert.match(page, /Nobody is watching this in real time/i,
    "the screen implies a safety positive reached somebody");
});

test("the screen offers no control that acts on anybody's care", () => {
  // A list of safety answers laid out like a caseload gets read as a caseload.
  // The copy says no control here routes anybody, closes an alert or changes a
  // gate — this checks the copy is true, which is the half a sentence cannot
  // guarantee about itself.
  //
  // IT IS AN ALLOWLIST OF TWO, NAMED, and it grew by one deliberately.
  // `logout` is the rail footer every shell in this project renders.
  // `resetParticipantPasswordAction` sets a participant's password, which is
  // an ACCOUNT action: it decides nothing about anybody's care, and it exists
  // because a participant who forgot their password had no way back into their
  // own account at all.
  //
  // Naming them is what keeps this a guard. A rule relaxed to "forms are fine
  // now" would stop catching the thing it was written for — a "Close with
  // action" or "Review" button arriving here and quietly turning an operator's
  // reading screen into a clinical one.
  const ALLOWED = new Set(["logout", "resetParticipantPasswordAction"]);
  const page = code("src/app/admin/pilot/page.tsx");

  const forms = page.match(/<form[^>]*>/g) ?? [];
  for (const f of forms) {
    const named = /action=\{(\w+)\}/.exec(f);
    assert.ok(named && ALLOWED.has(named[1]),
      `the pilot console carries a form that is neither sign-out nor the password reset: ${f}`);
  }
  const actions = page.match(/action=\{(\w+)\}/g) ?? [];
  for (const a of actions) {
    const name = /action=\{(\w+)\}/.exec(a)![1];
    assert.ok(ALLOWED.has(name),
      `the pilot console wires a server action that is not on the allowlist: ${a}`);
  }

  // AND THE ALLOWED ONE STILL MAY NOT TOUCH CARE. The action's own module is
  // read here rather than trusted by its name: a reset that also closed an
  // alert would satisfy every check above.
  const action = code("src/lib/enrollment/pilot-actions.ts");
  const domain = code("src/lib/enrollment/pilot-access.ts");
  for (const [name, src] of [["action", action], ["domain", domain]] as const) {
    assert.doesNotMatch(src, /alerts|checkins|module_unlocks|screenings|consents/,
      `the reset ${name} reaches a clinical table`);
    assert.doesNotMatch(src, /createAlert|decideUnlock|evaluateCheckin|recordCheckin/,
      `the reset ${name} calls into the clinical domain`);
  }
});

test("it reports whole people, never a percentage", () => {
  // At a cap of twenty-five a rate is two people out of three wearing the
  // clothes of a finding.
  const model = code("src/lib/enrollment/pilot-console.ts");
  const page = code("src/app/admin/pilot/page.tsx");
  for (const [name, src] of [["read model", model], ["screen", page]] as const) {
    assert.doesNotMatch(src, /toFixed\(|Math\.round\([^)]*\*\s*100|%`|"%"/,
      `the ${name} computes a percentage`);
  }
  // And the denominator travels with the numerator.
  // Written as a template literal, so the interpolations carry their `$`.
  assert.match(page, /\$\{summary\.reachedActive\} of \$\{summary\.participants\}/,
    "a count is shown without its denominator");
});

test("only the demo admin can open it", () => {
  const page = code("src/app/admin/pilot/page.tsx");
  assert.match(page, /await requireDemoAdmin\(\)/,
    "the pilot console does not require the demo admin role");
  // Before anything is read, so a refused visitor never causes a query over
  // real people's answers.
  const guard = page.indexOf("requireDemoAdmin()");
  const read = page.indexOf("pilotParticipants()");
  assert.ok(guard > 0 && read > 0);
  assert.ok(guard < read, "the console reads participants before checking who is asking");
});

test("the console is reachable from the demo console, not only by URL", () => {
  // The reachability guard proves the module is imported. This proves a person
  // can find it: enrollment shipped with nothing linking to /signup, and the
  // same mistake here would leave the pilot unreadable in practice.
  const admin = code("src/app/admin/demo/page.tsx");
  assert.match(admin, /href="\/admin\/pilot"/,
    "the demo console does not link to the pilot console");
});
