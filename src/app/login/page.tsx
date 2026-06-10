import { login } from "@/lib/actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-2xl font-bold">Sign in</h1>
      {error && (
        <p className="mt-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          Invalid email or password.
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
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Password</span>
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          className="w-full rounded-lg bg-stone-900 px-4 py-2.5 font-medium text-white hover:bg-stone-700"
        >
          Sign in
        </button>
      </form>
      <div className="mt-8 rounded-lg border border-stone-200 bg-white p-4 text-sm text-stone-600">
        <p className="font-semibold text-stone-800">Demo accounts (development only)</p>
        <p className="mt-1">Member: demo@example.com / demo1234</p>
        <p>Clinician: clinician@example.com / demo1234</p>
        <p className="mt-2 text-xs">
          Production requires multi-factor authentication (AAL2) for all accounts.
        </p>
      </div>
    </main>
  );
}
