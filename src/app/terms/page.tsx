import Link from "next/link";
import { TERMS_VERSION } from "@/lib/policy";
import { PLAN } from "@/lib/billing";

// Terms of Service (compliance packet 3.5). Every clause the packet requires
// is here and matches actual product behavior. Reviewed and approved by
// counsel 2026-06-10 (per founder); wording changes require re-review and a
// TERMS_VERSION bump.

const EFFECTIVE = "Effective June 10, 2026";

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="font-serif text-2xl font-medium">
        {n}. {title}
      </h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-ground/90">{children}</div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="font-serif text-4xl font-medium">Terms of Service</h1>
      <p className="mt-2 text-sm text-olive">Version {TERMS_VERSION} · {EFFECTIVE}</p>

      <Section n={1} title="What Steady is — and what it is not">
        <p>
          Steady is a self-guided wellness program for adults, built around the EMDR method,
          for processing difficult memories and reducing emotional intensity. It provides
          guided sessions, daily check-ins, grounding tools, progress measurement, and a
          software companion.
        </p>
        <p>
          <strong>
            Steady is not therapy, medical or mental-health care, or a substitute for
            professional treatment. It does not diagnose, treat, cure, or prevent any
            condition or disease.
          </strong>{" "}
          No clinician-patient or therapist-client relationship is created by using Steady.
          The companion is software, not a person and not a licensed professional, and
          nothing it says is medical advice.
        </p>
      </Section>

      <Section n={2} title="Not for emergencies">
        <p>
          Steady is not an emergency or crisis service and is not monitored in real time. No
          one at Steady sees your activity live or will respond in an emergency. If you are
          in immediate danger or thinking about harming yourself or someone else, call or
          text 988 (Suicide &amp; Crisis Lifeline, US), call 911, or go to the nearest
          emergency room.
        </p>
      </Section>

      <Section n={3} title="Consult a professional">
        <p>
          Steady is designed to be used alongside — never instead of — professional support.
          If you have or suspect a mental-health condition, consult a licensed professional.
          Do not delay, avoid, or discontinue professional care because of anything in
          Steady. If a professional has advised you against self-guided trauma-related work,
          follow their advice.
        </p>
      </Section>

      <Section n={4} title="Eligibility and fit screening">
        <p>
          Steady is for adults 18 and over. Before your first session you must answer
          program-fit questions honestly. Some situations — including recent suicidal
          thoughts or self-harm, recent psychiatric hospitalization, psychotic or
          dissociative disorders, substance dependence used to cope with memories, or an
          unsafe living situation — mean self-guided work is not safe, and Steady will
          decline or pause your access and point you to appropriate resources instead.
        </p>
        <p>
          We may pause sessions or end access at any time when our safety systems indicate
          the program is not a safe fit. If you are screened out after paying, your most
          recent charge is refunded automatically (see section 7).
        </p>
      </Section>

      <Section n={5} title="Assumption of risk and release">
        <p>
          Working with difficult memories — even in a self-guided wellness format with
          pacing and grounding — can bring up strong emotions, distressing memories, or
          temporary increases in distress. By using Steady you acknowledge these risks and
          choose to participate voluntarily. You agree to use the built-in safety tools
          (stopping early, the Ground-me button, the crisis resources) and to stop and seek
          professional or emergency help if you feel unsafe.
        </p>
        <p>
          To the maximum extent permitted by law, you release Steady from claims arising
          from your voluntary participation in the program, except where caused by our
          willful misconduct or where such a release is not permitted by the law of your
          jurisdiction. Nothing in this section limits rights that cannot be waived.
        </p>
      </Section>

      <Section n={6} title="Your responsibilities">
        <p>
          Answer safety questions honestly — the protections only work with honest input.
          Keep your account credentials private. Use Steady only for yourself, only as an
          adult, and not on behalf of anyone else. Do not attempt to misuse, probe, or
          disrupt the service or other members&apos; data.
        </p>
      </Section>

      <Section n={7} title="Membership, billing, and cancellation">
        <p>
          Steady is {PLAN.priceLabel} after a {PLAN.trialDays}-day free trial. You will see
          the price and the date of your first charge before you start the trial. You can
          cancel anytime from billing settings — it takes two clicks, requires no contact
          with anyone, and takes effect at the end of the paid period. If the fit questions
          screen you out after a charge, that charge is refunded automatically without you
          asking. Your bank statement reads simply &quot;STEADY MEMBERSHIP.&quot;
        </p>
      </Section>

      <Section n={8} title="The companion (AI) — what it is">
        <p>
          The companion is an AI software feature. It can make mistakes, and nothing it
          produces is professional advice, diagnosis, or treatment. It is designed never to
          diagnose you, never to promise outcomes, and to route you to crisis resources when
          it detects risk language — but it is software, and you should treat its output
          accordingly. Conversations are processed by our AI service provider to generate
          replies (see the <Link href="/privacy" className="underline">Privacy Policy</Link>).
          You control what it remembers from Settings → Memory.
        </p>
      </Section>

      <Section n={9} title="Privacy">
        <p>
          Our <Link href="/privacy" className="underline">Privacy Policy</Link> describes
          exactly what we collect, how it is protected, and your deletion rights. Summary:
          no advertising trackers, no sale of data, application-layer encryption of what you
          write, self-serve deletion.
        </p>
      </Section>

      <Section n={10} title="Changes to these terms">
        <p>
          These terms are versioned. If we change them in a way that matters, we will show
          you the new version and record which version you accepted. Continued use after
          notice constitutes acceptance of the updated terms.
        </p>
      </Section>

      <Section n={11} title="Disputes">
        <p>
          If something goes wrong, contact us first — most issues (billing, refunds,
          deletion) are resolved directly and quickly, and the safety-refund and
          cancellation paths in section 7 work without any dispute at all. Any dispute that
          cannot be resolved informally will be brought in a court of competent
          jurisdiction. These terms do not waive your right to bring claims in court.
        </p>
      </Section>

      <p className="mt-10 text-center text-xs text-olive">
        Questions about these terms: contact the founder. ·{" "}
        <Link href="/privacy" className="underline">Privacy Policy</Link> ·{" "}
        <Link href="/" className="underline">Home</Link>
      </p>
    </main>
  );
}
