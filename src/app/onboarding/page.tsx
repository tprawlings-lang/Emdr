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
      <div className="sticky top-0 z-10 -mx-6 mb-6 border-b border-ground/10 bg-ivory/95 px-6 py-3 text-sm font-medium text-ground/80">
        Emergency use: <span className="font-bold text-support">No</span> · Step 1 of 2 —
        Informed consent
      </div>

      <h1 className="font-serif text-4xl font-medium">Before you begin</h1>
      <p className="mt-3 text-olive">
        Please read each section at your own pace — nothing here is rushed. This is the
        agreement that governs your care program. A printable copy is available on every screen,
        and this consent is versioned ({CONSENT_VERSION}) so you always know what you agreed to.
      </p>

      <div className="mt-8 space-y-4">
        {CONSENT_SECTIONS.map((s) => (
          <section key={s.title} className="rounded-3xl border border-ground/10 bg-linen p-6 shadow-soft">
            <h2 className="font-semibold">{s.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-ground/90">{s.body}</p>
          </section>
        ))}
      </div>

      <form action={grantConsent} className="mt-8">
        <button
          type="submit"
          className="w-full rounded-full bg-sage px-6 py-3.5 font-medium text-ground transition-colors hover:bg-sage-deep"
        >
          I understand and continue
        </button>
        <p className="mt-3 text-center text-xs text-olive">
          Nothing is pre-checked. By continuing you grant consent version {CONSENT_VERSION},
          which is recorded with a timestamp in your consent ledger.
        </p>
      </form>
    </main>
  );
}
