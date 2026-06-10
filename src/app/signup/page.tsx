import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { signup } from "@/lib/actions";
import { PLAN } from "@/lib/billing";
import { SteadyMark, Wordmark } from "@/components/Brand";

const ERROR_COPY: Record<string, string> = {
  invalid: "Please use your name and a valid email address.",
  password: "Choose a password with at least 8 characters.",
  exists: "That email already has a space here. Try signing in instead.",
  code: "That clinician access code didn't match. Check with whoever sent you the demo link.",
  dob: "Please enter your date of birth.",
  age: "Steady is for adults 18 and over. We're sorry — this program isn't available to minors.",
  ack: "Please confirm you understand what Steady is and isn't before continuing.",
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect(user.role === "member" ? "/dashboard" : "/clinician");
  const { error } = await searchParams;
  const demo = process.env.EMDR_DEMO === "1";

  return (
    <main className="mx-auto max-w-4xl px-6 py-14">
      <div className="flex items-center gap-3">
        <SteadyMark className="h-9 w-9 text-olive" />
        <Wordmark className="text-4xl" />
      </div>

      <div className="mt-10 grid gap-10 md:grid-cols-2">
        <section>
          <h1 className="font-serif text-4xl font-medium leading-tight">
            Your space is ready when you are.
          </h1>
          <p className="mt-4 leading-relaxed text-olive">
            Steady is a private, specialist-informed space for working through trauma at the
            pace your nervous system can trust. No streaks, no pressure, no rush — just
            structure that always knows what to offer next.
          </p>
          <ul className="mt-6 space-y-3 text-ground/90">
            {PLAN.includes.map((line) => (
              <li key={line} className="flex items-start gap-3">
                <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-sage" aria-hidden="true" />
                {line}
              </li>
            ))}
          </ul>
          <div className="mt-8 rounded-3xl border border-ground/10 bg-linen p-6 shadow-soft">
            <p className="font-serif text-2xl font-medium">
              {PLAN.priceLabel}
              <span className="ml-2 text-base font-normal text-olive">
                · first {PLAN.trialDays} days free
              </span>
            </p>
            <p className="mt-2 text-sm leading-relaxed text-olive">
              Begin with a free week. Cancel anytime — pausing is always allowed here, in
              billing as much as in sessions.
            </p>
          </div>
          <p className="mt-6 text-sm text-olive">
            Steady is not emergency care and does not replace a licensed therapist. If you are
            in crisis, call or text <a href="tel:988" className="font-semibold underline">988</a>{" "}
            or call 911.
          </p>
        </section>

        <section>
          <div className="rounded-3xl border border-ground/10 bg-linen p-7 shadow-soft">
            <h2 className="font-serif text-2xl font-medium">Create your space</h2>
            {error && (
              <p className="mt-4 rounded-2xl border border-support/40 bg-support/10 px-4 py-3 text-sm text-support-deep">
                {ERROR_COPY[error] ?? "Something didn't work. Take your time and try again."}
              </p>
            )}
            <form action={signup} className="mt-5 space-y-4">
              <label className="block">
                <span className="text-sm font-medium">What should we call you?</span>
                <input
                  name="name"
                  type="text"
                  required
                  maxLength={80}
                  autoComplete="name"
                  className="mt-1 w-full rounded-2xl border border-ground/15 bg-ivory px-4 py-2.5 focus:border-sage focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium">Email</span>
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  className="mt-1 w-full rounded-2xl border border-ground/15 bg-ivory px-4 py-2.5 focus:border-sage focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium">Password</span>
                <input
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  className="mt-1 w-full rounded-2xl border border-ground/15 bg-ivory px-4 py-2.5 focus:border-sage focus:outline-none"
                />
                <span className="mt-1 block text-xs text-olive">At least 8 characters.</span>
              </label>
              <label className="block">
                <span className="text-sm font-medium">Date of birth</span>
                <input
                  name="dob"
                  type="date"
                  required
                  autoComplete="bday"
                  className="mt-1 w-full rounded-2xl border border-ground/15 bg-ivory px-4 py-2.5 focus:border-sage focus:outline-none"
                />
                <span className="mt-1 block text-xs text-olive">
                  Steady is for adults 18 and over.
                </span>
              </label>
              <label className="flex items-start gap-3 rounded-2xl border border-ground/10 bg-ivory p-4 text-sm">
                <input type="checkbox" name="wellness_ack" required className="mt-0.5" />
                <span>
                  I understand Steady is not therapy or medical treatment and is not monitored
                  in real time, and I agree to the{" "}
                  <Link href="/terms" className="underline" target="_blank">
                    Terms of Service
                  </Link>{" "}
                  and{" "}
                  <Link href="/privacy" className="underline" target="_blank">
                    Privacy Policy
                  </Link>
                  .
                </span>
              </label>
              {demo && (
                <details className="rounded-2xl border border-ground/10 bg-ivory p-4">
                  <summary className="cursor-pointer text-sm font-medium">
                    Reviewing Steady as a clinician?
                  </summary>
                  <div className="mt-3 space-y-3">
                    <p className="text-xs text-olive">
                      Demo only: clinician accounts see the specialist dashboard — the review
                      queue, every member&apos;s trends, and the audit ledger. You&apos;ll need
                      the access code from whoever sent you this link.
                    </p>
                    <div className="flex gap-2">
                      <label className="cursor-pointer rounded-full border border-ground/15 bg-linen px-4 py-2 text-sm transition-colors hover:bg-moss has-checked:border-clay has-checked:bg-clay has-checked:font-semibold">
                        <input type="radio" name="role" value="member" defaultChecked className="sr-only" />
                        Member
                      </label>
                      <label className="cursor-pointer rounded-full border border-ground/15 bg-linen px-4 py-2 text-sm transition-colors hover:bg-moss has-checked:border-clay has-checked:bg-clay has-checked:font-semibold">
                        <input type="radio" name="role" value="clinician" className="sr-only" />
                        Clinician
                      </label>
                    </div>
                    <input
                      name="clinician_code"
                      type="text"
                      placeholder="Clinician access code"
                      className="w-full rounded-2xl border border-ground/15 bg-linen px-4 py-2 text-sm focus:border-sage focus:outline-none"
                    />
                  </div>
                </details>
              )}
              <button
                type="submit"
                className="w-full rounded-full bg-sage px-6 py-3.5 font-medium text-ground transition-colors hover:bg-sage-deep"
              >
                Begin with a free week
              </button>
            </form>
            <p className="mt-4 text-center text-xs text-olive">
              Next: membership, then a short, unhurried setup — consent, a baseline screening,
              and getting to know your triggers and what grounds you.
            </p>
          </div>
          <p className="mt-5 text-center text-sm text-olive">
            Already have a space here?{" "}
            <Link href="/login" className="font-medium underline">
              Sign in
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}
