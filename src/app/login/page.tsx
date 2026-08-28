import { login } from "@/lib/actions";
import { SteadyMark, Wordmark } from "@/components/Brand";

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
      {/* Public enrollment is closed (§12), and shared credentials are never
          shown on a public page (§3). Reviewers arrive with scoped access
          arranged through /request-review. */}
      <p className="mt-5 text-center text-sm text-olive">
        Need access?{" "}
        <a href="/request-review" className="font-medium underline">
          Request a review
        </a>
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
