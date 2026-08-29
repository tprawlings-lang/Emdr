import { login } from "@/lib/actions";
import { SteadyMark, Wordmark } from "@/components/Brand";
import { DEMO_ROLES } from "@/lib/roles";

// The demo role selector (handoff 07 §1.1, p5).
//
// It exists ONLY in the demo environment, and it is a convenience, not a
// control. p4 states the rule and p7 repeats it: the client may DISPLAY the
// selected role and must never calculate authorization from the dropdown, the
// URL, a hidden field or local storage. So the value it submits can narrow a
// sign-in to a failure and can never widen one to a success — a clinician's
// credentials with "Demo Admin" selected returns the same generic failure as
// any other invalid pairing (p8's first negative test).
//
// It carries no email and no password. p5 lists a "demo helper" that copies
// the selected alias into the field, and that is deliberately NOT built here:
// the addresses would then be on a public, unauthenticated page, and the copy
// guard would be right to fail it. They live in docs/demo/demo-logins.md,
// which is where a presenter looks once.
const DEMO = process.env.EMDR_DEMO === "1";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <div className="flex items-center gap-3">
        <SteadyMark className="h-9 w-9 text-olive" />
        <Wordmark className="text-4xl" />
      </div>
      <h1 className="mt-8 type-display text-3xl font-medium">Review sign in</h1>
      <p className="mt-2 text-sm text-olive">
        Access to the Steady review environment. Every person and record in it is fabricated.
      </p>
      {error && (
        <p className="mt-4 rounded-2xl border border-support/40 bg-support/10 px-4 py-3 text-sm text-support-deep">
          {error === "locked"
            ? "Too many attempts \u2014 this account is paused for 15 minutes to protect it. Try again then."
            : "That email or password didn't match. Try again when you're ready."}
        </p>
      )}
      <form action={login} className="mt-6 space-y-4">
        {DEMO && (
          <label className="block">
            <span className="text-sm font-medium">Demo role</span>
            <span className="measure mt-0.5 block text-xs text-olive">
              Context for the demonstration. It does not grant anything — the account you
              sign in with decides what you can see.
            </span>
            <select
              name="role"
              defaultValue=""
              className="mt-1 w-full rounded-2xl border border-ground/15 bg-linen px-4 py-2.5 focus:border-sage focus:outline-none"
            >
              <option value="">Any role (use the account&rsquo;s own)</option>
              {DEMO_ROLES.map((r) => (
                <option key={r.role} value={r.role}>{r.label}</option>
              ))}
            </select>
          </label>
        )}
        <label className="block">
          <span className="text-sm font-medium">Email</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="mt-1 w-full rounded-2xl border border-ground/15 bg-linen px-4 py-2.5 focus:border-sage focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Password</span>
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="mt-1 w-full rounded-2xl border border-ground/15 bg-linen px-4 py-2.5 focus:border-sage focus:outline-none"
          />
        </label>
        <button
          type="submit"
          className="w-full rounded-full bg-sage px-6 py-3 font-medium text-ground transition-colors hover:bg-sage-deep"
        >
          Continue
        </button>
      </form>
      {DEMO && (
        <div className="mt-6 rounded-3xl border border-ground/10 bg-linen p-5">
          <p className="text-sm font-semibold text-ground">What each demo role sees</p>
          <p className="measure mt-1 text-xs text-olive">
            Both halves, at equal weight. What a role <em>cannot</em> reach is the half worth
            checking at a demonstration, and a table that only lists capabilities hides it.
          </p>
          <dl className="mt-3 divide-y divide-ground/10">
            {DEMO_ROLES.map((r) => (
              <div key={r.role} className="grid gap-1 py-2.5 sm:grid-cols-[7rem_1fr]">
                <dt className="text-sm font-medium text-ground">{r.label}</dt>
                <dd className="text-xs text-olive">
                  <span className="text-ground">{r.sees}</span>
                  <br />
                  <span>Cannot see: {r.cannotSee}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {/* Public enrollment is closed (§12), and shared credentials are never
          shown on a public page (§3). Reviewers arrive with scoped access
          arranged through /request-review. */}
      <p className="mt-5 text-center text-sm text-olive">
        Need access?{" "}
        <a href="/request-review" className="font-medium underline">
          Request a review
        </a>
      </p>

      {/* §6: crisis is reachable from every screen. This one had no route to
          it — the global footer carries the 988 number, but a person who
          cannot get into their account is exactly who should not have to
          scroll and read to find the way through. */}
      <p className="mt-2 text-center text-sm text-olive">
        Need help right now?{" "}
        <a href="/crisis" className="font-medium text-ground underline">
          Crisis support
        </a>{" "}
        is open without signing in.
      </p>
      <div className="mt-8 rounded-3xl border border-ground/10 bg-linen p-5 text-sm text-olive shadow-soft">
        <p className="font-semibold text-ground">Development prototype</p>
        <p className="mt-1">
          This environment contains fabricated data only. It does not provide clinical care and
          is not monitored in real time.
        </p>
        <p className="mt-2 text-xs">
          Production requires multi-factor authentication (AAL2) for all accounts.
        </p>
      </div>
    </main>
  );
}
