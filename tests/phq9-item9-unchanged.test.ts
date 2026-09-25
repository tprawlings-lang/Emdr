// PHQ-9 item 9 routing is untouched by Moving Toward (Handoff 10 1B; row
// CV10_B05). A positive item 9 raises the same urgent alert and routes to the
// crisis page whether or not the member is in the program, and nothing in the
// programs code path reads or writes a questionnaire.

process.env.EMDR_DATA_DIR = `/tmp/steady-phq9-item9-${process.pid}-${Date.now()}`;
process.env.EMDR_SESSION_SECRET = "phq9-item9-secret-at-least-32-characters";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "phq9-item9-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { getDb, newId, PLATFORM_TENANT_ID } from "../src/lib/db";
import { todayISO } from "../src/lib/gating";
import { getInstrument, scoreInstrument } from "../src/lib/instruments";
import { submitMeasureMobile } from "../src/lib/mobile/onboarding";
import { completeUnit, enrollInProgram } from "../src/lib/programs";
import { MOVING_TOWARD } from "../src/lib/content/h10-programs";

const db = getDb();

function member(): string {
  const id = newId();
  db.prepare("INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, 'M', 'fabricated')").run(id, PLATFORM_TENANT_ID);
  db.prepare("INSERT INTO users (id, tenant_id, email, password_hash, role, name) VALUES (?, ?, ?, 'x', 'member', 'M')")
    .run(id, PLATFORM_TENANT_ID, `${id}@phq.test`);
  db.prepare(`INSERT INTO checkins (id, user_id, checkin_date, activation, shutdown, harm_urge, feels_safe, dissociation,
      sleep_quality, substance_flag, recommended_action) VALUES (?, ?, ?, 2, 2, 0, 1, 1, 7, 0, 'processing_ok')`)
    .run(newId(), id, todayISO());
  return id;
}

const item9Positive = () => { const a = Array(9).fill(0); a[8] = 1; return a; };

test("item 9 routes the same for a member in Moving Toward as for one who is not", async () => {
  const phq = getInstrument("phq-9")!;
  assert.deepEqual(scoreInstrument(phq, item9Positive()).riskFlags, ["suicidal_ideation_screen_positive"]);

  const outside = member();
  const inside = member();
  await enrollInProgram(inside, MOVING_TOWARD.id);
  await completeUnit(inside, MOVING_TOWARD.id, MOVING_TOWARD.units[0].id);

  const a = await submitMeasureMobile(outside, "phq-9", item9Positive());
  const b = await submitMeasureMobile(inside, "phq-9", item9Positive());
  assert.ok(!("error" in a) && !("error" in b));
  assert.equal(a.crisis, true);
  assert.equal(b.crisis, true, "enrolment changed item 9's routing");
  const alerts = (id: string) => db.prepare("SELECT alert_type, severity FROM alerts WHERE user_id = ? ORDER BY alert_type").all(id);
  assert.deepEqual(alerts(inside), alerts(outside));
});

test("the programs code path never touches questionnaires", () => {
  const code = (f: string) => fs.readFileSync(path.join(process.cwd(), "src/lib", f), "utf8");
  for (const f of ["programs.ts", "program-activities.ts", "program-actions.ts", "content/h10-programs.ts"]) {
    assert.doesNotMatch(code(f), /\bscreenings\b|scoreInstrument|raiseRiskItemAlert|saveMeasureResponse/, `${f} reaches the questionnaires`);
  }
  // The outcome measure is named for clinician analytics and never shown in the program.
  assert.deepEqual([...MOVING_TOWARD.outcomeMeasureIds], ["phq-9"]);
  const pages = ["app/app/programs/page.tsx", "app/app/programs/[programId]/page.tsx", "app/app/programs/[programId]/[unitId]/page.tsx", "app/app/programs/[programId]/[unitId]/activity/page.tsx"];
  for (const p of pages) {
    assert.doesNotMatch(fs.readFileSync(path.join(process.cwd(), "src", p), "utf8"), /outcomeMeasureIds|phq/i, `${p} shows the outcome measure`);
  }
});
