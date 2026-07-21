import { requireMember } from "@/lib/auth";
import { hasConsent } from "@/lib/gating";
import { grantConsent } from "@/lib/actions";
import { currentConsentSections, currentConsentVersion } from "@/lib/policy";
import { redirect } from "next/navigation";
import { subscriptionActive } from "@/lib/billing";

export default async function OnboardingPage() {
  const user = await requireMember();
  if (!subscriptionActive(user.id)) redirect("/subscribe");
  if (hasConsent(user.id)) redirect("/screening");

  const consentVersion = currentConsentVersion();
  const consentSections = currentConsentSections();

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="sticky top-0 z-10 -mx-6 mb-6 border-b border-ground/10 bg-ivory/95 px-6 py-3 text-sm font-medium text-ground/80">
        Emergency use: <span className="font-bold text-support">No</span> · Step 2 of 4 —
        Informed consent
      </div>

      <h1 className="font-serif text-4xl font-medium">Before you begin</h1>
      <p className="mt-3 text-olive">
        Please read each section at your own pace — nothing here is rushed. This is the
        agreement that governs your care program. A printable copy is available on every screen,
        and this consent is versioned ({consentVersion}) so you always know what you agreed to.
      </p>

      <div className="mt-8 space-y-4">
        {consentSections.map((s) => (
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
          Nothing is pre-checked. By continuing you grant consent version {consentVersion},
          which is recorded with a timestamp in your consent ledger.
        </p>
      </form>
    </main>
  );
}
