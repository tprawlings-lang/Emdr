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

export const PLAN = {
  id: "monthly",
  label: "Steady membership",
  priceCents: 3499,
  currency: "usd",
  priceLabel: "$34.99 / month",
  trialDays: 7,
  includes: [
    "Daily check-ins that pace every session",
    "Guided trauma-support modules",
    "Grounding tools and your safety plan",
    "Your companion, with memory you control",
    "Session reflections and progress trends",
    "Specialist-informed safety review",
  ],
};

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

async function recordPayment(userId: string, description: string) {
  const c = await data();
  await c.run(
    "INSERT INTO payments (id, user_id, amount_cents, currency, status, description) VALUES (?, ?, ?, ?, 'succeeded', ?)",
    [newId(), userId, PLAN.priceCents, PLAN.currency, description]
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
// a period has lapsed. Trials convert to a first charge; active periods renew
// with a monthly charge; cancellations take effect at the period boundary.
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
      await recordPayment(
        userId,
        sub.status === "trialing" ? "First month after free trial (simulated)" : "Monthly renewal (simulated)"
      );
      await audit({ actorId: userId, actorRole: "member", family: "billing", type: "subscription_renewed" });
    }
    sub = await getSubscription(userId);
  }
  return sub;
}

export async function subscriptionActive(userId: string): Promise<boolean> {
  const sub = await getCurrentSubscription(userId);
  return !!sub && (sub.status === "active" || sub.status === "trialing");
}

export async function startDemoSubscription(userId: string) {
  const c = await data();
  const existing = await getSubscription(userId);
  const now = new Date();
  if (existing) {
    // Re-subscribe after cancellation: a fresh paid period starts now.
    await c.run(
      `UPDATE subscriptions SET status = 'active', cancel_at_period_end = 0,
         current_period_end = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`,
      [addMonth(now), userId]
    );
    await recordPayment(userId, "Membership restarted (simulated)");
    await audit({ actorId: userId, actorRole: "member", family: "billing", type: "subscription_restarted" });
    return;
  }
  await c.run(
    `INSERT INTO subscriptions (user_id, plan, status, price_cents, currency, provider, current_period_end)
     VALUES (?, ?, 'trialing', ?, ?, 'demo', ?)`,
    [userId, PLAN.id, PLAN.priceCents, PLAN.currency, addDays(now, PLAN.trialDays)]
  );
  await audit({
    actorId: userId,
    actorRole: "member",
    family: "billing",
    type: "subscription_started",
    detail: { plan: PLAN.id, trialDays: PLAN.trialDays },
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
    `SELECT id, amount_cents FROM payments
       WHERE user_id = ? AND status = 'succeeded' ORDER BY created_at DESC LIMIT 1`,
    [userId]
  )) as { id: string; amount_cents: number } | undefined;
  if (lastCharge) {
    await c.run(
      "INSERT INTO payments (id, user_id, amount_cents, currency, status, description) VALUES (?, ?, ?, ?, 'refunded', ?)",
      [newId(), userId, lastCharge.amount_cents, PLAN.currency, "Automatic refund — program fit (no action needed)"]
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
