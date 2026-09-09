process.env.EMDR_DATA_DIR = `/tmp/steady-crisisroute-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "crisis-route-test-secret-at-least-32-chars";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "crisis-route-test-key";

// A check-in that routes to crisis reaches a clinician, from EVERY path that
// writes one — and every path decides that routing with the product's own rule.
//
// THIS IS THE SECOND INSTANCE OF THE DEFECT tests/screening-risk-routing.ts
// exists for, and it was found by sweeping for the shape rather than by walking
// an intake again. The shape: a write that must be accompanied by a safety
// rule, where one path carries it and another does not.
//
// WHAT WAS FOUND. `evaluateCheckin` returns "crisis" when somebody reports an
// urge to harm themselves or others, or that they do not feel safe where they
// are. The web action raised an urgent alert and routed to the crisis screen.
// The mobile submit raised the same alert with its own copy of the wording.
// And src/lib/agents/runner.ts — the layer that runs THE PRODUCT'S OWN ROUTING
// RULE over a fabricated population, under a comment saying exactly that —
// wrote the rule's answer to `recommended_action` and raised nothing. So did
// the generator that wrote the rest of that population's history.
//
// Measured before the fix, on the demonstration database: twenty-six check-ins
// routed to crisis, and the alerts table held none of them. Those people band
// "immediate" on the caseload with a reason read off the check-in, and a
// clinician opening one finds nothing to act on and nothing to close.
//
// AND A SECOND DIVERGENCE, in the same rows. The generator did not call the
// rule at all — it carried a hand-written ladder ending in "steady", WHICH IS
// NOT A ROUTING DECISION THE PRODUCT CAN MAKE: the rule returns crisis,
// grounding_only, stabilization or processing_ok and nothing else. Seven and a
// half thousand rows of seeded history carried a value no live check-in has
// ever produced, and the clinician's measures table rendered it to a reader as
// though the engine had decided it.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";

import { getDb } from "../src/lib/db";
import { evaluateCheckin } from "../src/lib/gating";
import {
  ALERT_INSERT_SQL, ALERT_INSERT_IDEMPOTENT_SQL, alertValues, checkinSafetyAlert,
} from "../src/lib/clinical/alert-create";

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");
const code = (rel: string) =>
  fs.readFileSync(path.join(SRC, rel), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

/** Every module that writes a check-in row. Found by walking the source, so a
 *  path added later is held to the same rule instead of escaping a list. */
function checkinWriters(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.ts$/.test(e.name) && /INSERT INTO checkins/.test(code(path.relative(SRC, p)))) {
        out.push(path.relative(SRC, p));
      }
    }
  };
  walk(path.join(SRC, "lib"));
  return out.sort();
}

interface CheckinRow {
  id: string;
  user_id: string;
  recommended_action: string;
  activation: number;
  shutdown: number;
  harm_urge: number;
  feels_safe: number;
  dissociation: number;
  sleep_quality: number;
  substance_flag: number;
}

let db: Database.Database;
let rows: CheckinRow[];

const ruleFor = (r: CheckinRow) =>
  evaluateCheckin({
    activation: r.activation, shutdown: r.shutdown,
    harm_urge: !!r.harm_urge, feels_safe: !!r.feels_safe,
    dissociation: r.dissociation, sleep_quality: r.sleep_quality,
    substance_flag: !!r.substance_flag,
  });

test("setup: a built demonstration database, with its whole check-in history", () => {
  // Built rather than mocked, because the defect was in what the builders
  // WROTE. A fixture would have carried whatever this test assumed.
  db = getDb();
  rows = db.prepare(
    `SELECT id, user_id, recommended_action, activation, shutdown, harm_urge,
            feels_safe, dissociation, sleep_quality, substance_flag FROM checkins`
  ).all() as CheckinRow[];
  assert.ok(rows.length > 1000, `only ${rows.length} check-ins; the population did not build`);
});

// ---------------------------------------------------------------------------
// The rows
// ---------------------------------------------------------------------------

test("every check-in that routed to crisis reached a clinician", () => {
  // THE DEFECT, stated as the property it broke. Not "the code calls the
  // writer" — the rows.
  const crisis = rows.filter((r) => r.recommended_action === "crisis");
  assert.ok(crisis.length > 0, "no crisis check-ins at all; this guard is checking nothing");

  const alerted = new Set(
    (db.prepare("SELECT DISTINCT user_id AS u FROM alerts WHERE alert_type = ?")
      .all("checkin_safety_positive") as Array<{ u: string }>).map((a) => a.u)
  );
  const orphaned = crisis.filter((r) => !alerted.has(r.user_id)).map((r) => r.id);
  assert.deepEqual(
    orphaned.slice(0, 10), [],
    `${orphaned.length} of ${crisis.length} crisis check-ins raised no alert for that person`
  );
});

test("every stored routing decision is the one the product's rule makes", () => {
  // Recomputed from the answers ON THE ROW, so a path that forked the rule —
  // or typed a literal that used to agree with it — fails here whatever its
  // source looks like.
  const wrong = rows
    .filter((r) => ruleFor(r) !== r.recommended_action)
    .map((r) => `${r.id}: stored ${r.recommended_action}, rule says ${ruleFor(r)}`);
  assert.deepEqual(wrong.slice(0, 10), [], `${wrong.length} check-ins disagree with evaluateCheckin`);
});

test("no check-in carries a routing value the product cannot produce", () => {
  // "steady" was in seven and a half thousand rows and in none of the rule's
  // four return values. Stated separately from the guard above because it is a
  // different failure to a reader: not a row routed wrongly, a row routed to
  // somewhere that does not exist.
  const legal = new Set(["crisis", "grounding_only", "stabilization", "processing_ok"]);
  const strays = [...new Set(rows.map((r) => r.recommended_action))].filter((a) => !legal.has(a));
  assert.deepEqual(strays, [], `routing values no live check-in can produce: ${strays.join(", ")}`);
});

test("the alert says which of the two answers fired it", () => {
  // A clinician opening an urgent alert needs to know whether this is a harm
  // urge or an unsafe place before they open the chart — the two are not the
  // same conversation.
  const urge = checkinSafetyAlert({ userId: "u", harmUrge: true });
  const unsafe = checkinSafetyAlert({ userId: "u", harmUrge: false });
  assert.match(urge.detail, /urge to harm self or others/);
  assert.match(unsafe.detail, /not feeling safe/);
  assert.notEqual(urge.detail, unsafe.detail);
  assert.equal(urge.severity, "urgent");
  assert.equal(urge.type, "checkin_safety_positive");

  // And the surface is named where a check-in came from something other than
  // the web, so a fabricated row is legible as one.
  assert.match(checkinSafetyAlert({ userId: "u", harmUrge: true, via: "mobile" }).detail, /\(mobile\)/);
  assert.ok(!/\(/.test(urge.detail), "the web wording gained a marker the existing rows do not have");
});

test("a replaying writer cannot double an alert", () => {
  // The demo agents and the generator rebuild the same fabricated fortnight on
  // every boot from deterministic ids. Without the conflict clause a second
  // boot either throws on the primary key or files the same crisis twice.
  assert.match(ALERT_INSERT_IDEMPOTENT_SQL, /ON CONFLICT\(id\) DO NOTHING/);
  assert.ok(
    ALERT_INSERT_IDEMPOTENT_SQL.startsWith(ALERT_INSERT_SQL),
    "the replaying statement has its own column list, which is the drift this shared constant prevents"
  );
  // And the id a caller supplies is the one used, or the row is not stable.
  assert.equal(alertValues({ id: "fixed", userId: "u", type: "t", severity: "info", detail: "d" })[0], "fixed");
  assert.notEqual(alertValues({ userId: "u", type: "t", severity: "info", detail: "d" })[0], "fixed");
});

// ---------------------------------------------------------------------------
// The source
// ---------------------------------------------------------------------------

test("there is more than one check-in writer, so the rules below are worth having", () => {
  const writers = checkinWriters();
  assert.ok(writers.length >= 4, `only ${writers.length} check-in writer found: ${writers.join(", ")}`);
  for (const expected of ["lib/actions.ts", "lib/agents/runner.ts", "lib/demo-population-generator.ts"]) {
    assert.ok(writers.includes(expected), `${expected} is no longer a check-in writer; this guard reads the wrong files`);
  }
});

test("every check-in writer decides the routing with the product's rule", () => {
  // Not a literal that happens to agree today. Every divergence found in this
  // sweep — the generator's ladder, the demo seed's spare arm, two hand-typed
  // 'processing_ok's — started as a literal that agreed with the rule when it
  // was typed.
  //
  // Matched on the CALL, not the import: a module can import the rule and still
  // write its own answer.
  const missing = checkinWriters().filter((rel) => !/evaluateCheckin\(/.test(code(rel)));
  assert.deepEqual(missing, [], `these writers decide their own routing: ${missing.join(", ")}`);
});

test("no check-in writer writes the alerts table itself", () => {
  // Going around the one writer is the same defect wearing a different shape:
  // the row would exist and the next rule added to `createAlert` would not
  // apply to it. The two synchronous writers prepare the SHARED statement, so
  // the SQL text lives in one file even where the caller cannot await.
  for (const rel of checkinWriters()) {
    assert.ok(
      !/INSERT INTO alerts/.test(code(rel)),
      `${rel} writes the alerts table directly instead of using the shared statement`
    );
  }
});

test("the crisis wording exists in exactly one place", () => {
  // It had already drifted once — the mobile path carried its own copy, which
  // is how the two paths came to differ in whether the alert existed at all.
  const holders: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && /urge to harm self or others/.test(code(path.relative(SRC, p)))) {
        holders.push(path.relative(SRC, p));
      }
    }
  };
  walk(SRC);
  assert.deepEqual(holders, ["lib/clinical/alert-create.ts"], `the wording is copied into: ${holders.join(", ")}`);
});
