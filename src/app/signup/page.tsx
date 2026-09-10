import { redirect } from "next/navigation";
import Link from "next/link";

import { SteadyMark, Wordmark } from "@/components/Brand";
import { MAIN_ID } from "@/lib/experience/quality";
import { enrollmentState } from "@/lib/enrollment/gate";
import { enrollAction } from "@/lib/enrollment/actions";

// Enrollment, behind a shared access code.
//
// §12 CLOSED THIS ROUTE and this does not simply reopen it. What §12 objected
// to was a retail front door: anybody who found the page could put a real name
// and a real address into a review environment, and a reset without closing it
// would re-contaminate on the next visitor. What is here now is a pilot gate —
// a code, a hard cap, and a count — and when the code is unset the route
// redirects exactly as it did before.
//
// THE PAGE HAS TO SAY WHAT IT IS ASKING FOR. The next four screens ask whether
// this person has had suicidal thoughts in the past thirty days, what their
// triggers are, and how they are sleeping. Collecting that from a real person
// without first saying plainly where it goes and what it is not would be the
// actual failure here — the access code is the smaller half of doing this
// responsibly, and two acknowledgments below are the larger half. Neither is
// pre-checked.

export const dynamic = "force-dynamic";
export const metadata = { title: "Join the pilot — Steady" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ refused?: string }>;
}) {
  const { refused } = await searchParams;
  const state = await enrollmentState();

  // UNSET MEANS CLOSED, and closed behaves exactly as it did before this
  // existed: the route is kept as a redirect rather than a 404 so any existing
  // link, bookmark or index entry lands somewhere honest.
  if (!state.open) redirect("/request-review?from=signup");

  const field =
    "mt-1 w-full rounded-2xl border border-ground/15 bg-linen px-4 py-2.5 focus:border-sage focus:outline-none";

  return (
    <main id={MAIN_ID} className="mx-auto max-w-md px-6 py-16">
      <div className="flex items-center gap-3">
        <SteadyMark className="h-9 w-9 text-olive" />
        <Wordmark className="text-4xl" />
      </div>
      <h1 className="mt-8 type-display text-3xl font-medium">Join the pilot</h1>
      <p className="measure mt-2 text-sm text-olive">
        A limited pilot of the Steady programme, by access code.{" "}
        {state.full
          ? `All ${state.limit} places are taken.`
          : `${state.remaining} of ${state.limit} places remain.`}
      </p>

      {refused && (
        <p className="mt-4 rounded-2xl border border-support/40 bg-support/10 px-4 py-3 text-sm text-support-deep">
          {refused}
        </p>
      )}

      {/* THE HONEST PART, above the form rather than under it. A person deciding
          whether to type their name needs this before the field, not after the
          button. */}
      <div className="mt-6 rounded-3xl border border-ground/10 bg-linen p-5">
        <p className="text-sm font-semibold text-ground">Before you enter anything</p>
        <ul className="measure mt-2 space-y-2 text-sm text-olive">
          <li>
            <span className="text-ground">This is a development prototype, not care.</span> It
            does not diagnose or treat anything, no one is watching in real time, and nobody
            will contact you because of what you enter.
          </li>
          <li>
            <span className="text-ground">The questions are real ones.</span> The next screens
            ask about suicidal thoughts, harm urges, sleep and substance use. Answer them
            honestly or not at all — a half-honest answer teaches the safety rules the wrong
            thing and helps nobody.
          </li>
          <li>
            <span className="text-ground">Your answers are read by the people building this.</span>{" "}
            They are pilot feedback, and they are used to judge whether the questions and the
            safety rules work. They are not a medical record and they are not shared with an
            insurer or an employer.
          </li>
          <li>
            <span className="text-ground">In an emergency this is the wrong tool.</span>{" "}
            <Link href="/crisis" className="font-medium text-ground underline">
              988 and 911
            </Link>{" "}
            work whether or not Steady does.
          </li>
        </ul>
      </div>

      {state.full ? (
        <div className="mt-6 rounded-3xl border border-ground/10 bg-ivory p-5">
          <p className="text-sm text-ground">
            The pilot is full. Scoped access to look around without an account is arranged
            through a review request.
          </p>
          <Link
            href="/request-review"
            className="mt-4 block w-full rounded-full bg-sage px-6 py-3 text-center font-medium text-ground"
          >
            Request review access
          </Link>
        </div>
      ) : (
        <form action={enrollAction} className="mt-6 space-y-4">
          <label className="block">
            <span className="text-sm font-medium">Access code</span>
            <input name="access_code" type="text" required autoComplete="off" className={field} />
          </label>
          <label className="block">
            <span className="text-sm font-medium">What should we call you?</span>
            <span className="measure mt-0.5 block text-xs text-olive">
              A first name is enough. It appears on your own screens and on the clinician
              console for this pilot.
            </span>
            <input name="name" type="text" required autoComplete="given-name" className={field} />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Email</span>
            <input name="email" type="email" required autoComplete="email" className={field} />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Password</span>
            <span className="measure mt-0.5 block text-xs text-olive">At least 8 characters.</span>
            <input
              name="password" type="password" required minLength={8}
              autoComplete="new-password" className={field}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Date of birth</span>
            <span className="measure mt-0.5 block text-xs text-olive">
              Steady is for adults 18 and older, and that is decided once, here.
            </span>
            <input name="dob" type="date" required className={field} />
          </label>

          {/* NOTHING IS PRE-CHECKED (compliance packet 3.4). Two separate boxes
              rather than one: what this is, and what happens to what you type,
              are two different things to agree to, and one box covering both
              lets a reader agree to the half they noticed. */}
          <label className="flex gap-3 rounded-2xl border border-ground/10 bg-linen p-4">
            <input name="wellness_ack" type="checkbox" className="mt-1 h-4 w-4 shrink-0" />
            <span className="text-sm text-ground">
              I understand this is a self-guided wellness prototype, not therapy or medical
              care, and that it is not monitored in real time.
            </span>
          </label>
          <label className="flex gap-3 rounded-2xl border border-ground/10 bg-linen p-4">
            <input name="data_ack" type="checkbox" className="mt-1 h-4 w-4 shrink-0" />
            <span className="text-sm text-ground">
              I understand my answers — including the safety questions — are read by the team
              building this, as pilot feedback.
            </span>
          </label>

          <button
            type="submit"
            className="w-full rounded-full bg-sage px-6 py-3 font-medium text-ground transition-colors hover:bg-sage-deep"
          >
            Create my account
          </button>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-olive">
        Already have an account?{" "}
        <Link href="/login" className="font-medium underline">
          Sign in
        </Link>
      </p>
      <p className="mt-2 text-center text-sm text-olive">
        Need help right now?{" "}
        <Link href="/crisis" className="font-medium text-ground underline">
          Crisis support
        </Link>{" "}
        is open without signing in.
      </p>
    </main>
  );
}
