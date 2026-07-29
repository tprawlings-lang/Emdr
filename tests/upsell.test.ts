// Upsell engine (pricing Phase B): Base weekly companion cap + earned
// recommendations. Hermetic temp DB.
process.env.EMDR_DATA_DIR = `/tmp/steady-upsell-${process.pid}-${Date.now()}`;
delete process.env.EMDR_DEMO;

import { strict as assert } from "node:assert";
import test from "node:test";
import { data } from "../src/lib/data";
import { newId } from "../src/lib/db";
import { startDemoSubscription, getCurrentSubscription } from "../src/lib/billing";
import { companionAllowance, maybeUpsell } from "../src/lib/upsell";
import { getModelExposableMemoryItems, writeMemory } from "../src/lib/companion";
import { sendMessage } from "../src/lib/mobile/companion";

async function makeUser(id: string) {
  const c = await data();
  await c.run("INSERT INTO users (id, email, name, role, password_hash) VALUES (?, ?, ?, ?, ?)", [
    id, `${id}@test.local`, id, "member", "x",
  ]);
}

/** Create a user on an ACTIVE (post-trial) sub of the given tier. */
async function makeTierUser(id: string, plan: "base" | "plus" | "premium") {
  await makeUser(id);
  await startDemoSubscription(id, plan);
  const c = await data();
  await c.run("UPDATE subscriptions SET current_period_end = '2020-01-02 00:00:00' WHERE user_id = ?", [id]);
  await getCurrentSubscription(id); // roll trial → active on the chosen tier
}

async function insertMemberMessage(userId: string, daysAgo: number, riskFlag = 0) {
  const c = await data();
  const convId = newId();
  await c.run("INSERT INTO ai_conversations (id, user_id, context_type) VALUES (?, ?, 'general')", [convId, userId]);
  const ts = new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 19).replace("T", " ");
  await c.run(
    "INSERT INTO ai_messages (id, conversation_id, user_id, sender, message_text, risk_flag, created_at) VALUES (?, ?, ?, 'member', ?, ?, ?)",
    [newId(), convId, userId, "x", riskFlag, ts]
  );
}

test("base: first conversation of the week is allowed", async () => {
  await makeTierUser("up-base", "base");
  assert.deepEqual(await companionAllowance("up-base"), { ok: true });
});

test("base: a conversation 3 days ago blocks today, with a warm reply naming the return date", async () => {
  await insertMemberMessage("up-base", 3);
  const a = await companionAllowance("up-base");
  assert.equal(a.ok, false);
  if (!a.ok) {
    assert.ok(a.nextAvailable.length === 10, "has a next-available date");
    assert.ok(a.reply.includes("once a week"));
    assert.ok(a.reply.toLowerCase().includes("crisis"), "always points to open safety surfaces");
  }
});

test("base: same-day messages continue the conversation; old messages age out", async () => {
  const c = await data();
  await makeTierUser("up-base2", "base");
  await insertMemberMessage("up-base2", 0); // today
  assert.equal((await companionAllowance("up-base2")).ok, true, "same day continues");
  await c.run("DELETE FROM ai_messages WHERE user_id = ?", ["up-base2"]);
  await insertMemberMessage("up-base2", 8); // outside the window
  assert.equal((await companionAllowance("up-base2")).ok, true, "aged out");
});

test("risk-flagged messages never count toward the weekly window", async () => {
  await makeTierUser("up-base3", "base");
  await insertMemberMessage("up-base3", 2, 1); // crisis exchange two days ago
  assert.equal((await companionAllowance("up-base3")).ok, true);
});

test("plus and premium are unlimited", async () => {
  await makeTierUser("up-plus", "plus");
  await insertMemberMessage("up-plus", 3);
  assert.equal((await companionAllowance("up-plus")).ok, true);
});

test("mobile sendMessage enforces the cap end-to-end and stores the block reply", async () => {
  const r = await sendMessage("up-base", null, "hello again");
  assert.ok(r.reply.includes("once a week"), "capped reply");
  assert.equal(r.riskFlag, false);
  const c = await data();
  const audits = (await c.get(
    "SELECT COUNT(*) AS n FROM audit_log WHERE event_type = 'companion_weekly_capped'",
  )) as { n: number };
  assert.ok(Number(audits.n) >= 1, "capped exchange audited");
});

test("companion memory recall is gated on base but preserved (writes continue)", async () => {
  const c = await data();
  // Memory defaults to enabled (no prefs row needed).
  await writeMemory({ userId: "up-base", type: "focus_area", key: "sleep", value: "wants steadier sleep", source: "user_message" });
  const items = (await c.get("SELECT COUNT(*) AS n FROM ai_memory_items WHERE user_id = ?", ["up-base"])) as { n: number };
  assert.ok(Number(items.n) >= 1, "write persisted");
  assert.deepEqual(await getModelExposableMemoryItems("up-base"), [], "but never reaches the prompt on base");
  // Same item on plus → exposed.
  await writeMemory({ userId: "up-plus", type: "focus_area", key: "sleep", value: "wants steadier sleep", source: "user_message" });
  assert.ok((await getModelExposableMemoryItems("up-plus")).length >= 1);
});

test("winback fires for a fresh post-trial member, once, then cools down", async () => {
  // makeTierUser subs were created just now → inside the winback window.
  const s1 = await maybeUpsell("up-base2");
  assert.equal(s1?.kind, "trial_winback");
  assert.equal(await maybeUpsell("up-base2"), null, "cooldown holds");
});

test("plus_fit fires for a base member with recurring triggers (outside the winback window)", async () => {
  const c = await data();
  await makeTierUser("up-fit", "base");
  // Age the subscription out of the winback window.
  await c.run("UPDATE subscriptions SET created_at = '2020-01-01 00:00:00' WHERE user_id = ?", ["up-fit"]);
  await c.run("INSERT INTO user_triggers (id, user_id, trigger_name, trigger_category, active) VALUES (?, ?, 'crowds', 'situational', 1)", [newId(), "up-fit"]);
  await c.run("INSERT INTO user_triggers (id, user_id, trigger_name, trigger_category, active) VALUES (?, ?, 'loud noises', 'sensory', 1)", [newId(), "up-fit"]);
  const s = await maybeUpsell("up-fit");
  assert.equal(s?.kind, "plus_fit");
  assert.ok(s!.message.includes("triggers"));
});

test("premium members are never upsold; members with no signal get nothing", async () => {
  await makeTierUser("up-prem", "premium");
  assert.equal(await maybeUpsell("up-prem"), null);
  const c = await data();
  await makeTierUser("up-quiet", "base");
  await c.run("UPDATE subscriptions SET created_at = '2020-01-01 00:00:00' WHERE user_id = ?", ["up-quiet"]);
  assert.equal(await maybeUpsell("up-quiet"), null, "no triggers, no winback → no pitch");
});
