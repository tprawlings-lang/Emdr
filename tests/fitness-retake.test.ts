// The program-fit questions cannot be answered again to lift a stop
// (Expansion Handoff Phase 0, "screener retake bypass").
//
// Phase 0's definition of done: "each finding has a regression test in CI that
// fails if the gap reopens." Two gaps, both written to fail against the code as
// it stood:
//
//   1. THE PAUSE WAS ONLY IN THE PAGE. During the 24-hour pause the form was
//      hidden, but the action behind it — and the mobile route, which had no
//      form to hide — saved a fresh set of answers. The latest row is what the
//      gate reads, so eight "no"s ended the pause at once.
//   2. RE-ANSWERING LIFTED WHAT ONLY A PERSON MAY LIFT. After the pause, a
//      member who had said yes to a psychiatric hospitalization in the past
//      twelve months could say no and every session opened. The safety core
//      calls those items "reversible ONLY by support contact (never by
//      re-answering)"; the live gate never read that.

process.env.EMDR_DATA_DIR = `/tmp/steady-fitness-retake-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "fitness-retake-secret-at-least-32-chars-long";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "fitness-retake-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { getDb, newId, PLATFORM_TENANT_ID } from "../src/lib/db";
import { encryptField } from "../src/lib/crypto";
import {
  FITNESS_ITEMS, FITNESS_SCREENER_ID, FITNESS_STOP_ALERT, FitnessRetakeRefused, STANDING_STOP_ITEMS,
  classifyFitness, fitnessOpen, getFitnessState, recordFitnessScreening, type FitnessState,
} from "../src/lib/fitness-screener";
import { respondToFitnessStop } from "../src/lib/fitness-stop";
import { TRAIT_HARD_STOP_ITEMS } from "../src/lib/safety/program-fit";
import { closeAlert } from "../src/lib/clinical/alerts";
import { submitScreenerMobile } from "../src/lib/mobile/onboarding";

const db = getDb();
const SRC = path.join(process.cwd(), "src");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

function user(role: "member" | "clinician" = "member"): string {
  const id = newId();
  db.prepare(
    "INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, ?, 'fabricated')"
  ).run(id, PLATFORM_TENANT_ID, `${role} ${id.slice(0, 4)}`);
  db.prepare(
    "INSERT INTO users (id, tenant_id, email, password_hash, role, name) VALUES (?, ?, ?, 'x', ?, ?)"
  ).run(id, PLATFORM_TENANT_ID, `${id}@retake.test`, role, `${role} ${id.slice(0, 4)}`);
  return id;
}

const stamp = (msAgo: number) => new Date(Date.now() - msAgo).toISOString().slice(0, 19).replace("T", " ");
const HOUR = 3_600_000;

/** Answers as a member gave them `hoursAgo` — written the way the writer does. */
function answered(userId: string, yes: string[], hoursAgo: number): void {
  const answers = Object.fromEntries(FITNESS_ITEMS.map((i) => [i.id, yes.includes(i.id)]));
  const { flags } = classifyFitness(answers);
  const coded = Object.fromEntries(FITNESS_ITEMS.map((i) => [i.id, answers[i.id] ? 1 : 0]));
  db.prepare(
    `INSERT INTO screenings (id, user_id, instrument, instrument_version, total_score, answers_json, risk_flags_json, created_at)
     VALUES (?, ?, ?, 'test', ?, ?, ?, ?)`
  ).run(newId(), userId, FITNESS_SCREENER_ID, flags.length, encryptField(JSON.stringify(coded)), JSON.stringify(flags), stamp(hoursAgo * HOUR));
}

const allNo = () => Object.fromEntries(FITNESS_ITEMS.map((i) => [i.id, false]));

async function refused(userId: string): Promise<FitnessState["status"]> {
  try {
    await recordFitnessScreening(userId, allNo());
  } catch (e) {
    if (e instanceof FitnessRetakeRefused) return e.status;
    throw e;
  }
  assert.fail("a replacement set of answers was accepted");
}

/** The stop's alert, raised when the answers were given (seconds after). */
function stopAlert(userId: string, hoursAgo: number): string {
  const id = newId();
  db.prepare(
    `INSERT INTO alerts (id, user_id, alert_type, severity, detail, created_at) VALUES (?, ?, ?, 'high', 'stop', ?)`
  ).run(id, userId, FITNESS_STOP_ALERT, stamp(hoursAgo * HOUR - 1000));
  return id;
}

test("during a pause, a new set of answers is refused and the pause stands", async () => {
  const m = user();
  answered(m, ["unsafe_situation"], 2);
  assert.equal((await getFitnessState(m)).status, "cooldown");
  assert.equal(await refused(m), "cooldown");
  assert.equal((await getFitnessState(m)).status, "cooldown", "the refused answers must not have replaced the stop");
});

test("the mobile route is refused the same way, and says so", async () => {
  const m = user();
  answered(m, ["unsafe_situation"], 2);
  const r = await submitScreenerMobile(m, allNo());
  assert.ok("error" in r, "the mobile route accepted a replacement set of answers during a pause");
  assert.equal(r.state.status, "cooldown");
});

test("a state stop can be answered again once its pause has ended", async () => {
  const m = user();
  answered(m, ["unsafe_situation"], 25);
  assert.equal((await getFitnessState(m)).status, "none");
  const { outcome } = await recordFitnessScreening(m, allNo());
  assert.equal(outcome, "pass");
});

test("the standing items are the safety core's trait items plus under-18 — one list, not two", () => {
  for (const id of TRAIT_HARD_STOP_ITEMS) assert.ok(STANDING_STOP_ITEMS.includes(id), `${id} is a trait stop but can be re-answered`);
  assert.ok(STANDING_STOP_ITEMS.includes("under_18"));
  for (const id of STANDING_STOP_ITEMS) {
    assert.equal(FITNESS_ITEMS.find((i) => i.id === id)?.onYes, "hard_stop", `${id} is standing but is not a stop`);
  }
});

for (const item of STANDING_STOP_ITEMS) {
  test(`a stop on "${item}" is still held a week later, and re-answering is refused`, async () => {
    const m = user();
    answered(m, [item], 24 * 7);
    assert.equal((await getFitnessState(m)).status, "held");
    assert.equal(await refused(m), "held");
  });
}

test("a closed alert about an EARLIER stop does not lift a later one", async () => {
  const m = user();
  const clinician = user("clinician");
  answered(m, ["hospitalization_12m"], 24 * 40);
  const old = stopAlert(m, 24 * 40);
  await closeAlert({ alertId: old, clinicianId: clinician, tenantId: PLATFORM_TENANT_ID, resolution: "Called; discussed discharge plan and supports." });
  // They answered again later (after that review) and stopped again.
  answered(m, ["hospitalization_12m"], 30);
  assert.equal((await getFitnessState(m)).status, "held", "a review of a different answer released this one");
});

test("a documented review of THIS stop lets them answer again — and nothing else does", async () => {
  const m = user();
  const clinician = user("clinician");
  answered(m, ["psychotic_dissociative_dx"], 30);
  const alert = stopAlert(m, 30);
  assert.equal((await getFitnessState(m)).status, "held");
  // An acknowledgement does not close a high-band alert, so it cannot release.
  await assert.rejects(closeAlert({ alertId: alert, clinicianId: clinician, tenantId: PLATFORM_TENANT_ID, resolution: "ok" }));
  assert.equal((await getFitnessState(m)).status, "held");
  await closeAlert({
    alertId: alert, clinicianId: clinician, tenantId: PLATFORM_TENANT_ID,
    resolution: "Video call: stable on current plan, psychiatrist aware, agreed grounding-first use.",
  });
  assert.equal((await getFitnessState(m)).status, "none");
  await recordFitnessScreening(m, allNo());
});

test("a pass or a soft flag cannot be replaced either", async () => {
  const passed = user();
  answered(passed, [], 1);
  assert.equal(await refused(passed), "pass");
  // A seizure flag moves sessions to audio-only. Answering again must not
  // quietly take that protection away.
  const flagged = user();
  answered(flagged, ["seizure_disorder"], 1);
  assert.equal(await refused(flagged), "soft_flag");
  assert.equal((await getFitnessState(flagged)).status, "soft_flag");
});

test("every stop raises the care-team alert, and a standing one says what closing it does", async () => {
  const m = user();
  await respondToFitnessStop(m, ["hard_stop:hospitalization_12m"]);
  const row = db.prepare("SELECT severity, detail FROM alerts WHERE user_id = ? AND alert_type = ?").get(m, FITNESS_STOP_ALERT) as
    { severity: string; detail: string } | undefined;
  assert.ok(row, "no alert — a held member would have nobody able to release them");
  assert.equal(row.severity, "high");
  assert.match(row.detail, /documented review/);
});

test("both submit paths answer a stop the same way", () => {
  const web = code(fs.readFileSync(path.join(SRC, "lib/actions.ts"), "utf8"));
  const webBody = web.slice(web.indexOf("export async function submitFitnessScreening"), web.indexOf("export async function recordSessionTrigger"));
  const mobile = code(fs.readFileSync(path.join(SRC, "lib/mobile/onboarding.ts"), "utf8"));
  const mobileBody = mobile.slice(mobile.indexOf("export async function submitScreenerMobile"), mobile.indexOf("export async function measuresInfo"));
  for (const [name, body] of [["web", webBody], ["mobile", mobileBody]] as const) {
    assert.ok(body.length > 100, `${name}: could not find the submit function`);
    assert.match(body, /respondToFitnessStop\(/, `${name}: a stop here would skip the refund and the care-team alert`);
  }
});

test("every reader of the status opens only on pass or soft flag", () => {
  const statuses: FitnessState["status"][] = ["none", "pass", "soft_flag", "cooldown", "held"];
  assert.deepEqual(statuses.filter(fitnessOpen), ["pass", "soft_flag"]);
  // The shape that let a new status through: blocking by name.
  for (const rel of ["lib/gating.ts", "lib/track-recommender.ts", "lib/mobile/onboarding.ts"]) {
    const src = code(fs.readFileSync(path.join(SRC, rel), "utf8"));
    assert.doesNotMatch(src, /[sS]tatus\s*===\s*"cooldown"/, `${rel} blocks by naming "cooldown" — a hold would pass it`);
    assert.match(src, /fitnessOpen\(/, `${rel} does not use the shared allow-list`);
  }
});
