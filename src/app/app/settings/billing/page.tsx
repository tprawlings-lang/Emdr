import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { PLANS, getPlan, getCurrentSubscription, getPayments, type PlanId } from "@/lib/billing";
import { cancelSubscription, restartSubscription, resumeSubscription, changePlanAction } from "@/lib/actions";

const STATUS_COPY: Record<string, string> = {
  trialing: "Free trial",
  active: "Active",
  past_due: "Payment needed",
  canceled: "Ended",
};

export default async function BillingPage() {
  const user = await requireMember();
  const sub = await getCurrentSubscription(user.id);
  const payments = await getPayments(user.id);
  const plan = sub ? getPlan(sub.plan) : null;
  const otherPlans: PlanId[] = plan
    ? (["base", "plus", "premium"] as PlanId[]).filter((p) => p !== plan.id)
    : [];

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/app/today" className="text-sm text-olive underline">
        ← Back to dashboard
      </Link>
      <h1 className="mt-3 type-display text-4xl font-medium">Membership</h1>

      {!sub ? (
        <div className="mt-8 rounded-3xl border border-ground/10 bg-linen p-7 shadow-soft">
          <p>No membership yet.</p>
          <Link
            href="/subscribe"
            className="mt-4 inline-block rounded-full bg-sage px-6 py-3 font-medium text-ground transition-colors hover:bg-sage-deep"
          >
            Begin with a free week
          </Link>
        </div>
      ) : (
        <div className="mt-8 rounded-3xl border border-ground/10 bg-linen p-7 shadow-soft">
          <div className="flex items-baseline justify-between">
            <h2 className="type-display text-2xl font-medium">{plan!.label}</h2>
            <span
              className={`rounded-full px-3 py-1 text-sm font-medium ${
                sub.status === "canceled" ? "bg-sand/60 text-olive" : "bg-state-safe-bg/60 text-ground"
              }`}
            >
              {STATUS_COPY[sub.status] ?? sub.status}
            </span>
          </div>
          <p className="mt-2 text-olive">{plan!.priceLabel}</p>
          {sub.status !== "canceled" && (
            <p className="mt-1 text-sm text-olive">
              {sub.cancel_at_period_end
                ? `Ends ${sub.current_period_end.slice(0, 10)} — no further charges.`
                : sub.status === "trialing"
                  ? `Free Premium week — ${plan!.label} billing starts ${sub.current_period_end.slice(0, 10)}.`
                  : `Renews ${sub.current_period_end.slice(0, 10)}.`}
            </p>
          )}

          <div className="mt-5">
            {sub.status === "canceled" ? (
              <form action={restartSubscription}>
                <button className="rounded-full bg-sage px-6 py-2.5 font-medium text-ground transition-colors hover:bg-sage-deep">
                  Restart membership
                </button>
              </form>
            ) : sub.cancel_at_period_end ? (
              <form action={resumeSubscription}>
                <button className="rounded-full bg-sage px-6 py-2.5 font-medium text-ground transition-colors hover:bg-sage-deep">
                  Keep my membership
                </button>
              </form>
            ) : (
              <form action={cancelSubscription}>
                <button className="rounded-full border border-ground/20 px-6 py-2.5 text-sm text-olive transition-colors hover:bg-moss">
                  Cancel at period end
                </button>
              </form>
            )}
          </div>
          <p className="mt-4 text-xs text-olive">
            Canceling never deletes your work. Your safety plan, crisis support, and grounding
            page stay available, and your records remain with your care team.
          </p>

          {sub.status !== "canceled" && otherPlans.length > 0 && (
            <div className="mt-6 border-t border-ground/10 pt-5">
              <h3 className="font-semibold">Change membership</h3>
              <p className="mt-1 text-xs text-olive">
                Takes effect now; your next renewal bills the new price.
              </p>
              <div className="mt-3 space-y-2">
                {otherPlans.map((pid) => {
                  const p = PLANS[pid];
                  return (
                    <form
                      key={pid}
                      action={changePlanAction}
                      className="flex items-center justify-between rounded-3xl border border-ground/10 bg-ivory p-4"
                    >
                      <input type="hidden" name="plan" value={pid} />
                      <div>
                        <p className="font-medium">{p.label}</p>
                        <p className="text-xs text-olive">
                          {p.tagline} · {p.priceLabel}
                        </p>
                      </div>
                      <button className="rounded-full border border-ground/20 px-5 py-2 text-sm transition-colors hover:bg-moss">
                        Switch
                      </button>
                    </form>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {payments.length > 0 && (
        <section className="mt-8">
          <h2 className="type-display text-2xl font-medium">Payment history</h2>
          <div className="mt-3 space-y-2">
            {payments.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-3xl border border-ground/10 bg-linen p-4 text-sm shadow-soft"
              >
                <div>
                  <p className="font-medium">{p.description}</p>
                  <p className="text-xs text-olive">{p.created_at.slice(0, 10)}</p>
                </div>
                <p className="font-semibold">
                  ${(p.amount_cents / 100).toFixed(2)}
                  {p.status !== "succeeded" && (
                    <span className="ml-2 text-xs font-normal text-ground">{p.status}</span>
                  )}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
