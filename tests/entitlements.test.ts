// Pricing tiers + entitlements (Phase A). Hermetic temp DB.
process.env.EMDR_DATA_DIR = `/tmp/steady-tiers-${process.pid}-${Date.now()}`;
delete process.env.EMDR_DEMO;

import { strict as assert } from "node:assert";
import test from "node:test";
import { data } from "../src/lib/data";
import {
  PLANS, TRIAL_DAYS, getPlan, startDemoSubscription, getCurrentSubscription, changePlan,
} from "../src/lib/billing";
import { getTier, getEntitlements, planToTier, TIER_ENTITLEMENTS } from "../src/lib/entitlements";

async function makeUser(id: string) {
  const c = await data();
  await c.run("INSERT INTO users (id, email, name, role, password_hash) VALUES (?, ?, ?, ?, ?)", [
    id, `${id}@test.local`, id, "member", "x",
  ]);
}

test("plan catalog: three tiers with ascending prices; legacy maps to premium", () => {
  assert.equal(PLANS.base.priceCents, 699);
  assert.equal(PLANS.plus.priceCents, 1999);
  assert.equal(PLANS.premium.priceCents, 3499);
  assert.ok(TRIAL_DAYS >= 7);
  assert.equal(getPlan("monthly").id, "premium");
  assert.equal(planToTier("monthly"), "premium");
  assert.equal(planToTier("garbage"), "base");
});

test("entitlement matrix: safety never gated, ladder strictly widens", () => {
  // Base keeps the companion (limited), loses program/autopilot/live.
  assert.equal(TIER_ENTITLEMENTS.base.companionPerWeek, 1);
  assert.equal(TIER_ENTITLEMENTS.base.program, false);
  // Plus: unlimited companion + memory + program.
  assert.equal(TIER_ENTITLEMENTS.plus.companionPerWeek, null);
  assert.equal(TIER_ENTITLEMENTS.plus.program, true);
  assert.equal(TIER_ENTITLEMENTS.plus.autopilot, false);
  // Premium: everything.
  const p = TIER_ENTITLEMENTS.premium;
  assert.ok(p.program && p.autopilot && p.liveSessions && p.priorityReview && p.companionMemory);
});

test("trial runs at premium regardless of chosen tier; billing starts on the chosen tier", async () => {
  await makeUser("tier-base");
  await startDemoSubscription("tier-base", "base");
  const sub = await getCurrentSubscription("tier-base");
  assert.equal(sub?.status, "trialing");
  assert.equal(sub?.plan, "base");
  assert.equal(sub?.price_cents, 699);
  // During the trial the member is entitled to premium.
  assert.equal(await getTier("tier-base"), "premium");
  const ent = await getEntitlements("tier-base");
  assert.equal(ent?.autopilot, true);
});

test("after the trial lapses, the demo provider converts to the chosen tier", async () => {
  const c = await data();
  // Force the trial period into the past; the lazy roll should convert it.
  await c.run("UPDATE subscriptions SET current_period_end = '2020-01-01 00:00:00' WHERE user_id = ?", [
    "tier-base",
  ]);
  const sub = await getCurrentSubscription("tier-base");
  assert.equal(sub?.status, "active");
  assert.equal(await getTier("tier-base"), "base");
  const ent = await getEntitlements("tier-base");
  assert.equal(ent?.program, false);
  assert.equal(ent?.companionPerWeek, 1);
  // The conversion charged the BASE price, not the premium price.
  const pay = (await c.get(
    "SELECT amount_cents FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
    ["tier-base"]
  )) as { amount_cents: number };
  assert.equal(pay.amount_cents, 699);
});

test("changePlan moves the tier; upgrades apply to entitlements immediately", async () => {
  await changePlan("tier-base", "plus");
  assert.equal(await getTier("tier-base"), "plus");
  const ent = await getEntitlements("tier-base");
  assert.equal(ent?.program, true);
  assert.equal(ent?.companionPerWeek, null);
  assert.equal(ent?.autopilot, false);
});

test("no subscription → no tier, no entitlements", async () => {
  await makeUser("tier-none");
  assert.equal(await getTier("tier-none"), null);
  assert.equal(await getEntitlements("tier-none"), null);
});

test("base members are gated out of the module program with an upgrade action", async () => {
  const { checkModuleAccess } = await import("../src/lib/gating");
  const { getModule } = await import("../src/lib/modules");
  const mod = getModule("calm-place")!;
  const access = await checkModuleAccess("tier-base2", mod);
  // No subscription at all → subscribe.
  assert.equal(access.allowed, false);

  await makeUser("tier-base2");
  await startDemoSubscription("tier-base2", "base");
  const c = await data();
  await c.run("UPDATE subscriptions SET current_period_end = '2020-01-01 00:00:00' WHERE user_id = ?", [
    "tier-base2",
  ]);
  await getCurrentSubscription("tier-base2"); // roll trial → active base
  const gated = await checkModuleAccess("tier-base2", mod);
  assert.equal(gated.allowed, false);
  if (!gated.allowed) assert.equal(gated.action, "upgrade");
});
