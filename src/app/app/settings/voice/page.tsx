import Link from "next/link";
import { MemberPage } from "@/components/member/MemberPage";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { hasConsent, hasVoiceConsent } from "@/lib/gating";
import { grantVoiceConsent, withdrawVoiceConsent } from "@/lib/actions";
import { VOICE_CONSENT_SECTIONS, VOICE_CONSENT_VERSION, voiceConsentRequired } from "@/lib/policy";

// Voice & biometric consent controls. The member reads the distinct consent and
// opts in or withdraws — one tap either way. This is what "graduates" voice past
// demo: when the feature flag is on, a real member sees voice only after
// granting here (enforced by voiceAvailableFor / liveAvailableFor).
export default async function VoiceSettingsPage() {
  const user = await requireMember();
  if (!(await hasConsent(user.id))) redirect("/app/onboarding");
  const granted = await hasVoiceConsent(user.id);

  return (
    <MemberPage layer="evidence" title="Voice & speaking">
      <p className="mt-2 text-sm text-olive">
        Speaking during sessions is entirely optional — typing and tapping always work exactly
        the same. Because your voice can be sensitive information, this is a separate choice.
        Consent version {VOICE_CONSENT_VERSION}.
      </p>

      <div className="mt-6 rounded-2xl border border-ground/15 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium">Status</span>
          <span
            className={`rounded-full px-3 py-1 text-xs ${
              granted ? "bg-state-safe-bg/60 text-ground" : "bg-linen text-olive"
            }`}
          >
            {granted ? "Voice enabled" : "Voice off"}
          </span>
        </div>
        {!voiceConsentRequired() && (
          <p className="mt-2 text-xs text-olive">
            Voice features are not currently switched on for the program. Your choice here is
            recorded and takes effect when they are.
          </p>
        )}
      </div>

      <div className="mt-6 space-y-4">
        {VOICE_CONSENT_SECTIONS.map((s) => (
          <section key={s.title} className="rounded-2xl border border-ground/10 bg-linen p-5">
            <h2 className="font-semibold">{s.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-ground/90">{s.body}</p>
          </section>
        ))}
      </div>

      {granted ? (
        <form action={withdrawVoiceConsent} className="mt-8">
          <button
            type="submit"
            className="w-full rounded-full border border-ground px-6 py-3 font-medium text-ground transition-colors hover:bg-ground/10"
          >
            Turn voice off and withdraw this consent
          </button>
          <p className="mt-2 text-center text-xs text-olive">
            Effective immediately — the microphone stops being offered at once. No reason needed.
          </p>
        </form>
      ) : (
        <form action={grantVoiceConsent} className="mt-8">
          <button
            type="submit"
            className="w-full rounded-full bg-sage px-6 py-3.5 font-medium text-ground transition-colors hover:bg-sage-deep"
          >
            I understand and turn on voice
          </button>
          <p className="mt-2 text-center text-xs text-olive">
            Nothing is pre-checked. This grants voice/biometric consent version{" "}
            {VOICE_CONSENT_VERSION}, recorded with a timestamp. You can withdraw any time.
          </p>
        </form>
      )}
    </MemberPage>
  );
}
