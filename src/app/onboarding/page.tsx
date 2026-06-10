import { requireMember } from "@/lib/auth";
import { hasConsent } from "@/lib/gating";
import { grantConsent } from "@/lib/actions";
import { CONSENT_SECTIONS, CONSENT_VERSION } from "@/lib/policy";
import { redirect } from "next/navigation";

export default async function OnboardingPage() {
  const user = await requireMember();
  if (hasConsent(user.id)) redirect("/screening");

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="sticky top-0 z-10 -mx-6 mb-6 border-b border-stone-200 bg-stone-50/95 px-6 py-3 text-sm font-medium text-stone-700">
        Emergency use: <span className="font-bold text-red-700">No</span> · Step 1 of 2 —
        Informed consent
      </div>

      <h1 className="text-3xl font-bold">Before you begin</h1>
      <p className="mt-2 text-stone-600">
        Please read each section. This is the agreement that governs your care program — a
        printable copy is available on every screen, and this consent is versioned (
        {CONSENT_VERSION}) so you always know what you agreed to.
      </p>

      <div className="mt-8 space-y-4">
        {CONSENT_SECTIONS.map((s) => (
          <section key={s.title} className="rounded-lg border border-stone-200 bg-white p-5">
            <h2 className="font-semibold text-stone-900">{s.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-stone-700">{s.body}</p>
          </section>
        ))}
      </div>

      <form action={grantConsent} className="mt-8">
        <button
          type="submit"
          className="w-full rounded-lg bg-stone-900 px-6 py-3 font-medium text-white hover:bg-stone-700"
        >
          I understand and continue
        </button>
        <p className="mt-3 text-center text-xs text-stone-500">
          Nothing is pre-checked. By continuing you grant consent version {CONSENT_VERSION},
          which is recorded with a timestamp in your consent ledger.
        </p>
      </form>
    </main>
  );
}
