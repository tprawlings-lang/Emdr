import { getDb, newId } from "./db";
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
  priceCents: 1299,
  currency: "usd",
  priceLabel: "$12.99 / month",
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

function recordPayment(userId: string, description: string) {
  getDb()
    .prepare(
      "INSERT INTO payments (id, user_id, amount_cents, currency, status, description) VALUES (?, ?, ?, ?, 'succeeded', ?)"
    )
    .run(newId(), userId, PLAN.priceCents, PLAN.currency, description);
}

export function getSubscription(userId: string): Subscription | null {
  const row = getDb()
    .prepare("SELECT * FROM subscriptions WHERE user_id = ?")
    .get(userId) as Subscription | undefined;
  return row ?? null;
}

// Demo-provider recurring billing: lazily roll the subscription forward when
// a period has lapsed. Trials convert to a first charge; active periods renew
// with a monthly charge; cancellations take effect at the period boundary.
export function getCurrentSubscription(userId: string): Subscription | null {
  const db = getDb();
  let sub = getSubscription(userId);
  if (!sub || sub.provider !== "demo") return sub;

  const now = new Date();
  let guard = 0;
  while (sub && new Date(sub.current_period_end.replace(" ", "T") + "Z") < now && guard++ < 36) {
    if (sub.status === "canceled") break;
    if (sub.cancel_at_period_end) {
      db.prepare(
        "UPDATE subscriptions SET status = 'canceled', updated_at = datetime('now') WHERE user_id = ?"
      ).run(userId);
      audit({ actorId: userId, actorRole: "member", family: "billing", type: "subscription_ended" });
    } else {
      const periodEnd = addMonth(new Date(sub.current_period_end.replace(" ", "T") + "Z"));
      db.prepare(
        "UPDATE subscriptions SET status = 'active', current_period_end = ?, updated_at = datetime('now') WHERE user_id = ?"
      ).run(periodEnd, userId);
      recordPayment(
        userId,
        sub.status === "trialing" ? "First month after free trial (simulated)" : "Monthly renewal (simulated)"
      );
      audit({ actorId: userId, actorRole: "member", family: "billing", type: "subscription_renewed" });
    }
    sub = getSubscription(userId);
  }
  return sub;
}

export function subscriptionActive(userId: string): boolean {
  const sub = getCurrentSubscription(userId);
  return !!sub && (sub.status === "active" || sub.status === "trialing");
}

export function startDemoSubscription(userId: string) {
  const db = getDb();
  const existing = getSubscription(userId);
  const now = new Date();
  if (existing) {
    // Re-subscribe after cancellation: a fresh paid period starts now.
    db.prepare(
      `UPDATE subscriptions SET status = 'active', cancel_at_period_end = 0,
         current_period_end = ?, updated_at = datetime('now') WHERE user_id = ?`
    ).run(addMonth(now), userId);
    recordPayment(userId, "Membership restarted (simulated)");
    audit({ actorId: userId, actorRole: "member", family: "billing", type: "subscription_restarted" });
    return;
  }
  db.prepare(
    `INSERT INTO subscriptions (user_id, plan, status, price_cents, currency, provider, current_period_end)
     VALUES (?, ?, 'trialing', ?, ?, 'demo', ?)`
  ).run(userId, PLAN.id, PLAN.priceCents, PLAN.currency, addDays(now, PLAN.trialDays));
  audit({
    actorId: userId,
    actorRole: "member",
    family: "billing",
    type: "subscription_started",
    detail: { plan: PLAN.id, trialDays: PLAN.trialDays },
  });
}

export function setCancelAtPeriodEnd(userId: string, cancel: boolean) {
  getDb()
    .prepare(
      "UPDATE subscriptions SET cancel_at_period_end = ?, updated_at = datetime('now') WHERE user_id = ?"
    )
    .run(cancel ? 1 : 0, userId);
  audit({
    actorId: userId,
    actorRole: "member",
    family: "billing",
    type: cancel ? "subscription_cancel_scheduled" : "subscription_cancel_undone",
  });
}

export function getPayments(userId: string) {
  return getDb()
    .prepare("SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 24")
    .all(userId) as {
    id: string;
    amount_cents: number;
    currency: string;
    status: string;
    description: string;
    created_at: string;
  }[];
}
