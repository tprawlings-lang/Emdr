// Autopilot — the Premium autonomous care loop (pricing Phase C). Hermetic.
process.env.EMDR_DATA_DIR = `/tmp/steady-autopilot-${process.pid}-${Date.now()}`;
delete process.env.EMDR_DEMO;

import { strict as assert } from "node:assert";
import test from "node:test";
import { data } from "../src/lib/data";
import { newId } from "../src/lib/db";
import { startDemoSubscription, getCurrentSubscription } from "../src/lib/billing";
import { getAutopilotPlan } from "../src/lib/autopilot";

async function makeUser(id: string) {
  const c = await data();
  await c.run("INSERT INTO users (id, email, name, role, password_hash) VALUES (?, ?, ?, ?, ?)", [
    id, `${id}@test.local`, id, "member", "x",
  ]);
}

async function makeTierUser(id: string, plan: "base" | "plus" | "premium") {
  await makeUser(id);
  await startDemoSubscription(id, plan);
  const c = await data();
  await c.run("UPDATE subscriptions SET current_period_end = '2020-01-02 00:00:00' WHERE user_id = ?", [id]);
  await getCurrentSubscription(id);
}

async function setTodayCheckin(userId: string, action: string) {
  const c = await data();
  const today = new Date().toISOString().slice(0, 10);
  await c.run("DELETE FROM checkins WHERE user_id = ? AND checkin_date = ?", [userId, today]);
  await c.run(
    `INSERT INTO checkins (id, user_id, checkin_date, activation, shutdown, harm_urge, feels_safe,
       dissociation, sleep_quality, substance_flag, recommended_action)
     VALUES (?, ?, ?, 3, 2, 0, 1, 2, 6, 0, ?)`,
    [newId(), userId, today, action]
  );
}

test("autopilot is premium-only", async () => {
  await makeTierUser("ap-plus", "plus");
  assert.equal(await getAutopilotPlan("ap-plus"), null);
  await makeTierUser("ap-base", "base");
  assert.equal(await getAutopilotPlan("ap-base"), null);
});

test("no check-in yet → the plan leads with the check-in", async () => {
  await makeTierUser("ap-prem", "premium");
  const plan = await getAutopilotPlan("ap-prem");
  assert.ok(plan, "premium gets a plan");
  assert.equal(plan!.items[0].kind, "checkin");
  assert.equal(plan!.pacingNote, null);
  assert.ok(plan!.items.some((i) => i.kind === "practice"), "a settling practice is offered");
});

test("plan recomposes when the check-in lands; grounding day narrows and explains", async () => {
  await setTodayCheckin("ap-prem", "grounding_only");
  const plan = await getAutopilotPlan("ap-prem");
  assert.ok(plan);
  assert.ok(!plan!.items.some((i) => i.kind === "checkin"), "check-in item gone");
  assert.ok(!plan!.items.some((i) => i.kind === "session"), "no session on a grounding day");
  assert.ok(plan!.items.some((i) => i.kind === "ground"), "grounding tools offered");
  assert.ok(plan!.pacingNote && plan!.pacingNote.includes("grounding"), "pacing made visible");
});

test("stable within the same day and state (idempotent, one row)", async () => {
  const a = await getAutopilotPlan("ap-prem");
  const b = await getAutopilotPlan("ap-prem");
  assert.deepEqual(a, b);
  const c = await data();
  const rows = (await c.get(
    "SELECT COUNT(*) AS n FROM autopilot_plans WHERE user_id = ?", ["ap-prem"]
  )) as { n: number };
  assert.equal(Number(rows.n), 1);
});

test("crisis day composes a support-only plan", async () => {
  await makeTierUser("ap-crisis", "premium");
  await setTodayCheckin("ap-crisis", "crisis");
  const plan = await getAutopilotPlan("ap-crisis");
  assert.ok(plan);
  assert.ok(plan!.items.every((i) => i.kind === "ground"), "nothing but support");
  assert.ok(!plan!.items.some((i) => i.kind === "session"));
});

test("missed-checkins outreach lands in the companion thread, once", async () => {
  const c = await data();
  await makeTierUser("ap-away", "premium");
  // Last check-in four days ago, none today.
  const past = new Date(Date.now() - 4 * 86400000).toISOString().slice(0, 10);
  await c.run(
    `INSERT INTO checkins (id, user_id, checkin_date, activation, shutdown, harm_urge, feels_safe,
       dissociation, sleep_quality, substance_flag, recommended_action)
     VALUES (?, ?, ?, 3, 2, 0, 1, 2, 6, 0, 'processing_ok')`,
    [newId(), "ap-away", past]
  );
  const plan = await getAutopilotPlan("ap-away");
  assert.ok(plan?.outreach, "outreach attached to the plan");
  assert.ok(plan!.outreach!.includes("few days"));
  const msg = (await c.get(
    "SELECT COUNT(*) AS n FROM ai_messages WHERE user_id = ? AND sender = 'companion'",
    ["ap-away"]
  )) as { n: number };
  assert.equal(Number(msg.n), 1, "delivered into the companion thread");
  // Same-day refetch does not re-send.
  await getAutopilotPlan("ap-away");
  const again = (await c.get(
    "SELECT COUNT(*) AS n FROM ai_messages WHERE user_id = ? AND sender = 'companion'",
    ["ap-away"]
  )) as { n: number };
  assert.equal(Number(again.n), 1);
});

test("worsening measures → supportive outreach + an early clinician risk-watch alert", async () => {
  const c = await data();
  await makeTierUser("ap-worse", "premium");
  await setTodayCheckin("ap-worse", "processing_ok");
  const ins = async (score: number, daysAgo: number) => {
    const ts = new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 19).replace("T", " ");
    await c.run(
      "INSERT INTO screenings (id, user_id, instrument, instrument_version, total_score, answers_json, created_at) VALUES (?, ?, 'pcl-5', 'v1', ?, '[]', ?)",
      [newId(), "ap-worse", score, ts]
    );
  };
  await ins(30, 14);
  await ins(45, 1); // +15 ≥ the pcl-5 delta of 10
  const plan = await getAutopilotPlan("ap-worse");
  assert.ok(plan?.outreach, "outreach fired");
  assert.ok(plan!.outreach!.includes("care team"));
  const alert = (await c.get(
    "SELECT COUNT(*) AS n FROM alerts WHERE user_id = ? AND alert_type = 'autopilot_risk_watch'",
    ["ap-worse"]
  )) as { n: number };
  assert.equal(Number(alert.n), 1, "clinician sees it early");
});

test("steady practice week → a milestone worth naming (no risk alert)", async () => {
  const c = await data();
  await makeTierUser("ap-streak", "premium");
  await setTodayCheckin("ap-streak", "processing_ok");
  for (let i = 0; i < 5; i++) {
    await c.run(
      "INSERT INTO practice_completions (id, user_id, practice_id, practice_type, duration_sec) VALUES (?, ?, 'coherent-5-5', 'breathwork', 120)",
      [newId(), "ap-streak"]
    );
  }
  const plan = await getAutopilotPlan("ap-streak");
  assert.ok(plan?.outreach);
  assert.ok(plan!.outreach!.includes("shown up"), "celebratory, not clinical");
  const alert = (await c.get(
    "SELECT COUNT(*) AS n FROM alerts WHERE user_id = ? AND alert_type = 'autopilot_risk_watch'",
    ["ap-streak"]
  )) as { n: number };
  assert.equal(Number(alert.n), 0);
});
