import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { deleteAccount } from "@/lib/actions";

// Account deletion (compliance 6.4): self-serve, no reason required, no
// chat-with-us-to-cancel. Program data is removed immediately; financial
// records are retained only as legally required.
export default async function AccountSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireUser();
  const { error } = await searchParams;

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/dashboard" className="text-sm text-olive underline">
        ← Back to dashboard
      </Link>
      <h1 className="mt-3 font-serif text-4xl font-medium">Your account</h1>

      <section className="mt-8 rounded-3xl border border-support/30 bg-linen p-7 shadow-soft">
        <h2 className="font-serif text-2xl font-medium">Delete my account and data</h2>
        <p className="mt-3 text-sm leading-relaxed text-olive">
          This removes your sessions, check-ins, triggers, safety plan, companion
          conversations and memory, and screening answers — immediately and permanently. No
          reason required. Payment records are kept only as financial law requires, and
          encrypted backups age out within 30 days.
        </p>
        {error === "confirm" && (
          <p className="mt-4 rounded-2xl border border-support/40 bg-support/10 px-4 py-3 text-sm text-support-deep">
            Type DELETE in the box to confirm — it protects against accidental taps.
          </p>
        )}
        <form action={deleteAccount} className="mt-5">
          <label className="block text-sm font-medium">
            Type <span className="font-bold">DELETE</span> to confirm
            <input
              name="confirm"
              type="text"
              autoComplete="off"
              className="mt-1 w-full rounded-2xl border border-ground/15 bg-ivory px-4 py-2.5 focus:border-support focus:outline-none"
            />
          </label>
          <button
            type="submit"
            className="mt-4 w-full rounded-full border-2 border-support px-6 py-3 font-semibold text-support-deep transition-colors hover:bg-support hover:text-white"
          >
            Delete my account permanently
          </button>
        </form>
      </section>

      <p className="mt-6 text-center text-sm text-olive">
        Looking for billing?{" "}
        <Link href="/settings/billing" className="underline">
          Manage membership
        </Link>{" "}
        · Companion memory?{" "}
        <Link href="/settings/memory" className="underline">
          Memory controls
        </Link>
      </p>
    </main>
  );
}
