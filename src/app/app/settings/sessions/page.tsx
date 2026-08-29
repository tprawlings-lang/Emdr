import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { hasConsent, hasProcessingConsent } from "@/lib/gating";
import { grantProcessingConsent, revokeProcessingConsent } from "@/lib/actions";
import { PROCESSING_CONSENT_SECTIONS, PROCESSING_CONSENT_VERSION } from "@/lib/policy";
import { blsResourcingEnabled } from "@/lib/safety/config";

// Processing-session (BLS) consent controls. A distinct, explicit opt-in required
// before any bilateral-stimulation (calm-place) session. One tap either way.
export default async function SessionConsentPage() {
  const user = await requireMember();
  if (!(await hasConsent(user.id))) redirect("/app/onboarding");
  const granted = await hasProcessingConsent(user.id);
  const featureOn = blsResourcingEnabled();

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/app/settings/account" className="text-sm text-olive underline">
        ← Settings
      </Link>
      <h1 className="mt-3 type-display text-3xl font-medium">Guided calm-place sessions</h1>
      <p className="mt-2 text-sm text-olive">
        These sessions add short, gentle rounds of sound and tapping (bilateral stimulation) to a
        calm-place exercise. Because this is a self-guided processing exercise with no clinician
        present, it is a separate, explicit choice. Consent version {PROCESSING_CONSENT_VERSION}.
      </p>

      <div className="mt-6 rounded-2xl border border-ground/15 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium">Status</span>
          <span
            className={`rounded-full px-3 py-1 text-xs ${
              granted ? "bg-state-safe-bg/60 text-ground" : "bg-linen text-olive"
            }`}
          >
            {granted ? "Consent on file" : "Not enabled"}
          </span>
        </div>
        {!featureOn && (
          <p className="mt-2 text-xs text-olive">
            These sessions are not currently switched on for the program. Your choice here is
            recorded and takes effect when they are.
          </p>
        )}
      </div>

      <div className="mt-6 space-y-4">
        {PROCESSING_CONSENT_SECTIONS.map((s) => (
          <section key={s.title} className="rounded-2xl border border-ground/10 bg-linen p-5">
            <h2 className="font-semibold">{s.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-ground/90">{s.body}</p>
          </section>
        ))}
      </div>

      {granted ? (
        <form action={revokeProcessingConsent} className="mt-8">
          <button
            type="submit"
            className="w-full rounded-full border border-ground px-6 py-3 font-medium text-ground transition-colors hover:bg-ground/10"
          >
            Withdraw this consent
          </button>
          <p className="mt-2 text-center text-xs text-olive">
            Effective immediately. No reason needed.
          </p>
        </form>
      ) : (
        <form action={grantProcessingConsent} className="mt-8">
          <button
            type="submit"
            className="w-full rounded-full bg-sage px-6 py-3.5 font-medium text-ground transition-colors hover:bg-sage-deep"
          >
            I understand and consent
          </button>
          <p className="mt-2 text-center text-xs text-olive">
            Nothing is pre-checked. This grants processing-session consent version{" "}
            {PROCESSING_CONSENT_VERSION}, recorded with a timestamp. You can withdraw any time.
          </p>
        </form>
      )}
    </main>
  );
}
