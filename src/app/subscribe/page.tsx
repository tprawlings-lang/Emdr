import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { PLANS, TRIAL_DAYS, getCurrentSubscription, type PlanId } from "@/lib/billing";
import { startSubscription } from "@/lib/actions";

// Membership step between account creation and onboarding. Three tiers; every
// tier starts with a free week of Premium so members feel the whole system
// before billing begins on the tier they chose. The demo provider simulates
// checkout; a real deployment would hand off to hosted checkout here.
export default async function SubscribePage() {
  const user = await requireMember();
  const sub = await getCurrentSubscription(user.id);
  if (sub && (sub.status === "active" || sub.status === "trialing")) redirect("/onboarding");

  const demo = process.env.EMDR_DEMO === "1" || !process.env.STRIPE_SECRET_KEY;
  const order: PlanId[] = ["base", "plus", "premium"];

  return (
    <main className="mx-auto max-w-2xl px-6 py-14">
      <p className="text-sm text-olive">Step 1 of 4 — Membership</p>
      <h1 className="mt-2 font-serif text-4xl font-medium">Almost there, {user.name.split(" ")[0]}</h1>
      <p className="mt-3 leading-relaxed text-olive">
        Every membership begins with <strong>{TRIAL_DAYS} days of Premium, free</strong> — the full
        program, the companion, everything. After your free week, billing starts on the tier you
        choose here. Change or cancel anytime from your billing settings.
      </p>

      <div className="mt-8 space-y-5">
        {order.map((id) => {
          const plan = PLANS[id];
          const highlighted = id === "plus";
          return (
            <div
              key={id}
              className={`rounded-3xl border p-7 shadow-soft ${
                highlighted ? "border-sage-deep bg-moss" : "border-ground/10 bg-linen"
              }`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <div>
                  <h2 className="font-serif text-2xl font-medium">{plan.label}</h2>
                  <p className="text-sm text-olive">{plan.tagline}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{plan.priceLabel}</p>
                  {highlighted && <p className="text-xs text-sage-deep">Most members choose this</p>}
                </div>
              </div>
              <ul className="mt-4 space-y-2.5 text-sm text-ground/90">
                {plan.includes.map((line) => (
                  <li key={line} className="flex items-start gap-3">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-sage" aria-hidden="true" />
                    {line}
                  </li>
                ))}
              </ul>
              <form action={startSubscription} className="mt-6">
                <input type="hidden" name="plan" value={id} />
                <button
                  type="submit"
                  className={`w-full rounded-full px-6 py-3.5 font-medium transition-colors ${
                    highlighted
                      ? "bg-sage text-ground hover:bg-sage-deep"
                      : "border border-ground/20 text-ground hover:bg-moss"
                  }`}
                >
                  Start my free Premium week — then {plan.label}
                </button>
              </form>
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-center text-xs text-olive">
        {demo
          ? "Demonstration environment: checkout is simulated and no card is charged."
          : `Billing starts after your ${TRIAL_DAYS}-day Premium trial, on the tier you chose. Cancel anytime.`}
      </p>

      <p className="mt-8 text-center text-sm text-olive">
        After this: consent, a short baseline screening, then getting to know your triggers and
        what grounds you. Move slowly — every step can wait for you.
      </p>
      <p className="mt-4 text-center text-sm">
        <Link href="/crisis" className="font-semibold text-support underline">
          Need help right now? Crisis support is free and always open.
        </Link>
      </p>
    </main>
  );
}
