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
      <h1 className="mt-8 font-serif text-3xl font-medium">Welcome back</h1>
      <p className="mt-2 text-sm text-olive">This is your private space. Take your time.</p>
      {error && (
        <p className="mt-4 rounded-2xl border border-support/40 bg-support/10 px-4 py-3 text-sm text-support-deep">
          That email or password didn&apos;t match. Try again when you&apos;re ready.
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
      <div className="mt-8 rounded-3xl border border-ground/10 bg-linen p-5 text-sm text-olive shadow-soft">
        <p className="font-semibold text-ground">Demo accounts (development only)</p>
        <p className="mt-1">Member: demo@example.com / demo1234</p>
        <p>Clinician: clinician@example.com / demo1234</p>
        <p className="mt-2 text-xs">
          Production requires multi-factor authentication (AAL2) for all accounts.
        </p>
      </div>
    </main>
  );
}
