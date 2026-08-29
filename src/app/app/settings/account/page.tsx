import Link from "next/link";
import { MemberPage } from "@/components/member/MemberPage";
import { requireUser } from "@/lib/auth";
import { deleteAccount, signOutEverywhere } from "@/lib/actions";

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
    <MemberPage
      layer="evidence"
      title="Your account"
    >

      <section className="mt-8 rounded-3xl border border-ground/10 bg-linen p-7 shadow-soft">
        <h2 className="type-display text-2xl font-medium">Sign out everywhere</h2>
        <p className="mt-3 text-sm leading-relaxed text-olive">
          Signs you out on every device — useful if you used a shared computer or think someone
          else may have access. You&apos;ll sign back in here as usual.
        </p>
        <form action={signOutEverywhere} className="mt-5">
          <button className="rounded-full border border-ground px-6 py-2.5 text-sm font-medium transition-colors hover:bg-ground hover:text-ivory">
            Sign out of all devices
          </button>
        </form>
      </section>

      <section className="mt-8 rounded-3xl border border-ground/30 bg-linen p-7 shadow-soft">
        <h2 className="type-display text-2xl font-medium">Delete my account and data</h2>
        <p className="mt-3 text-sm leading-relaxed text-olive">
          This removes your sessions, check-ins, triggers, safety plan, companion
          conversations and memory, and screening answers — immediately and permanently. No
          reason required. Payment records are kept only as financial law requires, and
          encrypted backups age out within 30 days.
        </p>
        {error === "confirm" && (
          <p className="mt-4 rounded-2xl border border-state-caution/40 bg-ground/10 px-4 py-3 text-sm text-ground">
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
              className="mt-1 w-full rounded-2xl border border-ground/15 bg-ivory px-4 py-2.5 focus:border-ground focus:outline-none"
            />
          </label>
          <button
            type="submit"
            className="mt-4 w-full rounded-full border-2 border-ground px-6 py-3 font-semibold text-ground transition-colors hover:bg-ground hover:text-white"
          >
            Delete my account permanently
          </button>
        </form>
      </section>

      <p className="mt-6 text-center text-sm text-olive">
        Looking for billing?{" "}
        <Link href="/app/settings/billing" className="underline">
          Manage membership
        </Link>{" "}
        · Companion memory?{" "}
        <Link href="/app/settings/memory" className="underline">
          Memory controls
        </Link>
      </p>
    </MemberPage>
  );
}
