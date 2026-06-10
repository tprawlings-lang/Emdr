import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { PLAN, getCurrentSubscription } from "@/lib/billing";
import { startSubscription } from "@/lib/actions";

// Membership step between account creation and onboarding. The demo provider
// simulates checkout; a real deployment would hand off to hosted checkout
// here (see lib/billing.ts).
export default async function SubscribePage() {
  const user = await requireMember();
  const sub = getCurrentSubscription(user.id);
  if (sub && (sub.status === "active" || sub.status === "trialing")) redirect("/onboarding");

  const demo = process.env.EMDR_DEMO === "1" || !process.env.STRIPE_SECRET_KEY;

  return (
    <main className="mx-auto max-w-xl px-6 py-14">
      <p className="text-sm text-olive">Step 1 of 4 — Membership</p>
      <h1 className="mt-2 font-serif text-4xl font-medium">Almost there, {user.name.split(" ")[0]}</h1>
      <p className="mt-3 leading-relaxed text-olive">
        Your membership keeps this space private, supervised, and ad-free. Begin with{" "}
        {PLAN.trialDays} days free — cancel anytime from your billing settings.
      </p>

      <div className="mt-8 rounded-3xl border border-ground/10 bg-linen p-7 shadow-soft">
        <div className="flex items-baseline justify-between">
          <h2 className="font-serif text-2xl font-medium">{PLAN.label}</h2>
          <p className="font-semibold">{PLAN.priceLabel}</p>
        </div>
        <ul className="mt-4 space-y-2.5 text-sm text-ground/90">
          {PLAN.includes.map((line) => (
            <li key={line} className="flex items-start gap-3">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-sage" aria-hidden="true" />
              {line}
            </li>
          ))}
        </ul>
        <form action={startSubscription} className="mt-6">
          <button
            type="submit"
            className="w-full rounded-full bg-sage px-6 py-3.5 font-medium text-ground transition-colors hover:bg-sage-deep"
          >
            Start my free week
          </button>
        </form>
        <p className="mt-3 text-center text-xs text-olive">
          {demo
            ? "Demonstration environment: checkout is simulated and no card is charged."
            : `Billing starts after your ${PLAN.trialDays}-day trial. Cancel anytime.`}
        </p>
      </div>

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
