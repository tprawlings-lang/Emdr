import { newId } from "./db";
import { data } from "./data";
import { audit } from "./audit";

// Membership billing. The data model (subscriptions + payments) is
// provider-agnostic: `provider` / `provider_ref` are where a Stripe customer
// and subscription id would live. With no payment provider configured the
// "demo" provider simulates checkout and monthly renewal so the full
// signup -> subscribe -> onboarding flow works end to end; swapping in
// Stripe means implementing checkout/renewal against their API and webhooks
// behind these same functions, keyed off STRIPE_SECRET_KEY.
//
// Pricing (Phase A): three tiers — base / plus / premium. Every new
// membership starts with TRIAL_DAYS of premium (status "trialing" runs at
// premium entitlements; see lib/entitlements.ts), then bills on the tier the
// member chose. Legacy "monthly" ($34.99) rows are grandfathered as premium.

export type PlanId = "base" | "plus" | "premium";

export interface PlanDef {
  id: PlanId;
  label: string;
  tagline: string;
  priceCents: number;
  currency: string;
  priceLabel: string;
  includes: string[];
}

export const TRIAL_DAYS = 7;

export const PLANS: Record<PlanId, PlanDef> = {
  base: {
    id: "base",
    label: "Base",
    tagline: "A calmer daily practice",
    priceCents: 699,
    currency: "usd",
    priceLabel: "$6.99 / month",
    includes: [
      "Daily check-ins that pace your day",
      "Breathe, meditate, move, and sleep practices",
      "Short lessons that make sense of the work",
      "Grounding tools, your safety plan, and SOS",
      "Your companion, once a week",
    ],
  },
  plus: {
    id: "plus",
    label: "Plus",
    tagline: "A program that remembers you",
    priceCents: 1999,
    currency: "usd",
    priceLabel: "$19.99 / month",
    includes: [
      "Everything in Base",
      "Guided trauma-support module program",
      "Your companion, unlimited, with memory you control",
      "Symptom measures and progress trends",
      "Specialist-informed safety review",
    ],
  },
  premium: {
    id: "premium",
    label: "Premium",
    tagline: "Steady runs your program with you",
    priceCents: 3499,
    currency: "usd",
    priceLabel: "$34.99 / month",
    includes: [
      "Everything in Plus",
      "Autopilot: a daily plan composed for you each morning",
      "A companion that reaches out between sessions",
      "Pacing that adapts to keep you in your window",
      "Live spoken sessions, hands-free",
      "Priority specialist review",
    ],
  },
};

export function getPlan(id: string): PlanDef {
  if (id === "base" || id === "plus" || id === "premium") return PLANS[id];
  // Legacy single-plan rows ("monthly", $34.99) map to premium.
  return PLANS.premium;
}

export interface Subscription {
  user_id: string;
  plan: string;
  status: "trialing" | "active" | "past_due" | "canceled";
  price_cents: number;
  currency: string;
  provider: string;
  provider_ref: string | null;
  cancel_at_period_end: number;
  current_period_end: string;
  created_at: string;
}

function addDays(from: Date, days: number): string {
  return new Date(from.getTime() + days * 86400000).toISOString().slice(0, 19).replace("T", " ");
}

function addMonth(from: Date): string {
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

async function recordPayment(userId: string, amountCents: number, currency: string, description: string) {
  const c = await data();
  await c.run(
    "INSERT INTO payments (id, user_id, amount_cents, currency, status, description) VALUES (?, ?, ?, ?, 'succeeded', ?)",
    [newId(), userId, amountCents, currency, description]
  );
}

export async function getSubscription(userId: string): Promise<Subscription | null> {
  const c = await data();
  const row = (await c.get("SELECT * FROM subscriptions WHERE user_id = ?", [userId])) as
    | Subscription
    | undefined;
  return row ?? null;
}

// Demo-provider recurring billing: lazily roll the subscription forward when
// a period has lapsed. Trials convert to a first charge on the CHOSEN plan;
// active periods renew with a monthly charge; cancellations take effect at
// the period boundary.
export async function getCurrentSubscription(userId: string): Promise<Subscription | null> {
  const c = await data();
  let sub = await getSubscription(userId);
  if (!sub || sub.provider !== "demo") return sub;

  const now = new Date();
  let guard = 0;
  while (sub && new Date(sub.current_period_end.replace(" ", "T") + "Z") < now && guard++ < 36) {
    if (sub.status === "canceled") break;
    if (sub.cancel_at_period_end) {
      await c.run(
        "UPDATE subscriptions SET status = 'canceled', updated_at = CURRENT_TIMESTAMP WHERE user_id = ?",
        [userId]
      );
      await audit({ actorId: userId, actorRole: "member", family: "billing", type: "subscription_ended" });
    } else {
      const periodEnd = addMonth(new Date(sub.current_period_end.replace(" ", "T") + "Z"));
      await c.run(
        "UPDATE subscriptions SET status = 'active', current_period_end = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?",
        [periodEnd, userId]
      );
      const plan = getPlan(sub.plan);
      await recordPayment(
        userId,
        sub.price_cents,
        sub.currency,
        sub.status === "trialing"
          ? `First month of ${plan.label} after free Premium week (simulated)`
          : `Monthly ${plan.label} renewal (simulated)`
      );
      await audit({ actorId: userId, actorRole: "member", family: "billing", type: "subscription_renewed", detail: { plan: sub.plan } });
    }
    sub = await getSubscription(userId);
  }
  return sub;
}

export async function subscriptionActive(userId: string): Promise<boolean> {
  const sub = await getCurrentSubscription(userId);
  return !!sub && (sub.status === "active" || sub.status === "trialing");
}

/** Start (or restart) a membership. New members begin a TRIAL_DAYS free week
 *  that runs at premium; billing then starts on `planId`. Re-subscribers start
 *  a fresh paid period on `planId` immediately (no second trial). When
 *  restarting without an explicit choice, the previous plan is kept. */
export async function startDemoSubscription(userId: string, planId?: PlanId) {
  const c = await data();
  const existing = await getSubscription(userId);
  const now = new Date();
  if (existing) {
    const plan = planId ? PLANS[planId] : getPlan(existing.plan);
    await c.run(
      `UPDATE subscriptions SET plan = ?, price_cents = ?, status = 'active', cancel_at_period_end = 0,
         current_period_end = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`,
      [plan.id, plan.priceCents, addMonth(now), userId]
    );
    await recordPayment(userId, plan.priceCents, plan.currency, `${plan.label} membership restarted (simulated)`);
    await audit({ actorId: userId, actorRole: "member", family: "billing", type: "subscription_restarted", detail: { plan: plan.id } });
    return;
  }
  const plan = PLANS[planId ?? "premium"];
  await c.run(
    `INSERT INTO subscriptions (user_id, plan, status, price_cents, currency, provider, current_period_end)
     VALUES (?, ?, 'trialing', ?, ?, 'demo', ?)`,
    [userId, plan.id, plan.priceCents, plan.currency, addDays(now, TRIAL_DAYS)]
  );
  await audit({
    actorId: userId,
    actorRole: "member",
    family: "billing",
    type: "subscription_started",
    detail: { plan: plan.id, trialDays: TRIAL_DAYS, trialTier: "premium" },
  });
}

/** Change tier. Upgrades and downgrades both take effect at the next period
 *  boundary for billing (the demo provider keeps it simple: the plan and price
 *  change now, the next renewal charges the new price). During a trial this
 *  just changes which tier billing starts on. */
export async function changePlan(userId: string, planId: PlanId) {
  const c = await data();
  const sub = await getSubscription(userId);
  if (!sub || sub.status === "canceled") return;
  const plan = PLANS[planId];
  await c.run(
    "UPDATE subscriptions SET plan = ?, price_cents = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?",
    [plan.id, plan.priceCents, userId]
  );
  await audit({
    actorId: userId,
    actorRole: "member",
    family: "billing",
    type: "plan_changed",
    detail: { from: sub.plan, to: plan.id },
  });
}

// Safety-refund path (compliance 5.4, non-negotiable): a member screened out
// by the fitness screener after paying is refunded automatically, no contact
// required, and the subscription ends immediately.
export async function safetyRefundAndCancel(userId: string) {
  const c = await data();
  const sub = await getSubscription(userId);
  if (sub && sub.status !== "canceled") {
    await c.run(
      "UPDATE subscriptions SET status = 'canceled', cancel_at_period_end = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?",
      [userId]
    );
  }
  const lastCharge = (await c.get(
    `SELECT id, amount_cents, currency FROM payments
       WHERE user_id = ? AND status = 'succeeded' ORDER BY created_at DESC LIMIT 1`,
    [userId]
  )) as { id: string; amount_cents: number; currency: string } | undefined;
  if (lastCharge) {
    await c.run(
      "INSERT INTO payments (id, user_id, amount_cents, currency, status, description) VALUES (?, ?, ?, ?, 'refunded', ?)",
      [newId(), userId, lastCharge.amount_cents, lastCharge.currency, "Automatic refund — program fit (no action needed)"]
    );
  }
  await audit({
    actorId: userId,
    actorRole: "member",
    family: "billing",
    type: "safety_refund",
    detail: { refunded: Boolean(lastCharge) },
  });
}

export async function setCancelAtPeriodEnd(userId: string, cancel: boolean) {
  const c = await data();
  await c.run(
    "UPDATE subscriptions SET cancel_at_period_end = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?",
    [cancel ? 1 : 0, userId]
  );
  await audit({
    actorId: userId,
    actorRole: "member",
    family: "billing",
    type: cancel ? "subscription_cancel_scheduled" : "subscription_cancel_undone",
  });
}

export async function getPayments(userId: string) {
  const c = await data();
  return (await c.all("SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 24", [
    userId,
  ])) as {
    id: string;
    amount_cents: number;
    currency: string;
    status: string;
    description: string;
    created_at: string;
  }[];
}
