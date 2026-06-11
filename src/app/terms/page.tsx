import Link from "next/link";
import { TERMS_VERSION } from "@/lib/policy";
import { PLAN } from "@/lib/billing";

// Terms of Service v2.0. Coverage expanded per counsel's instruction to match
// competitor-standard commercial protections (as-is disclaimer, liability
// cap, account terms, IP, third-party services, indemnity, governing law)
// while keeping the wellness-lane safety clauses from the compliance packet.
// All text is original. Wording changes require re-review and a
// TERMS_VERSION bump. Open items: governing-law state and branded contact
// email (see COMPLIANCE.md).

const EFFECTIVE = "Effective June 11, 2026";

// [NEEDS ADDRESSED: replace with a branded support address once an email
// domain exists, e.g. support@<domain>. Tracked in COMPLIANCE.md.]
const CONTACT_EMAIL = "support@[your-domain — pending]";

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

      <Section n={1} title="Agreement to these terms">
        <p>
          These Terms of Service govern your access to and use of Steady — the website, the
          program, and every feature in it. By creating an account, checking the
          acknowledgment box at signup, or using Steady, you agree to these terms and to our{" "}
          <Link href="/privacy" className="underline">Privacy Policy</Link>. If you do not
          agree, do not use Steady.
        </p>
      </Section>

      <Section n={2} title="What Steady is — and what it is not">
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
            condition or disease, and we make no promise that it will produce any particular
            result for you.
          </strong>{" "}
          No clinician-patient or therapist-client relationship is created by using Steady.
          The companion is software, not a person and not a licensed professional, and
          nothing it says is medical advice. Steady is not affiliated with, endorsed by, or
          certified by any professional EMDR association or licensing body.
        </p>
      </Section>

      <Section n={3} title="Not for emergencies">
        <p>
          Steady is not an emergency or crisis service and is not monitored in real time. No
          one at Steady sees your activity live or will respond in an emergency. Steady is
          not designed for situations involving suicidal thoughts, self-harm, danger to
          others, or medical emergencies. If you are in immediate danger, call or text 988
          (Suicide &amp; Crisis Lifeline, US), call 911, or go to the nearest emergency room.
        </p>
      </Section>

      <Section n={4} title="Suitability — consult a professional">
        <p>
          A self-guided program is not the right fit for every person or every situation,
          and it cannot replace working face-to-face with a licensed professional. If you
          have or suspect a mental-health condition, consult a licensed professional. Do not
          delay, avoid, or discontinue professional care because of anything in Steady, and
          if a professional has advised you against self-guided trauma-related work, follow
          their advice.
        </p>
      </Section>

      <Section n={5} title="Eligibility and fit screening">
        <p>
          Steady is for adults 18 and over — no exceptions, including with parental consent.
          Before your first session you must answer program-fit questions honestly. Some
          situations — including recent suicidal thoughts or self-harm, recent psychiatric
          hospitalization, psychotic or dissociative disorders, substance dependence used to
          cope with memories, or an unsafe living situation — mean self-guided work is not
          safe, and Steady will decline or pause your access and point you to appropriate
          resources instead. We may pause sessions or end access at any time when our safety
          systems indicate the program is not a safe fit; if that happens after you have
          paid, your most recent charge is refunded automatically (section 10).
        </p>
      </Section>

      <Section n={6} title="Your account">
        <p>
          You agree to provide accurate information when creating your account and to keep
          it current. You are responsible for keeping your password confidential and for all
          activity under your account; tell us immediately if you believe your account has
          been accessed without your permission. Accounts are personal: one person, your own
          use only, no sharing and no use on someone else&apos;s behalf. We may suspend or
          close accounts that violate these terms, abuse the service, or create safety risk
          — where reasonably possible we will tell you why.
        </p>
      </Section>

      <Section n={7} title="Assumption of risk and release">
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

      <Section n={8} title="No warranties — provided as is">
        <p>
          Steady is provided on an &quot;as is&quot; and &quot;as available&quot; basis. To
          the fullest extent permitted by law, we disclaim all warranties, express or
          implied — including merchantability, fitness for a particular purpose, and
          non-infringement. We do not warrant that Steady will be uninterrupted, error-free,
          or secure, that defects will be corrected, or that the program will meet your
          needs or produce any particular outcome. Published research about the EMDR method
          describes the method as delivered by trained clinicians; it is not a warranty
          about Steady or about your results.
        </p>
      </Section>

      <Section n={9} title="Limitation of liability">
        <p>
          To the maximum extent permitted by law, Steady and the people who build and
          operate it will not be liable for indirect, incidental, special, consequential,
          or punitive damages, or for lost profits, data, or goodwill, arising from or
          related to your use of the service. Our total aggregate liability for all claims
          relating to the service is limited to the greater of (a) the amounts you paid us
          in the three months before the event giving rise to the claim, or (b) the
          smallest amount permitted by applicable law. Some jurisdictions do not allow
          certain limitations, so parts of this section may not apply to you.
        </p>
      </Section>

      <Section n={10} title="Membership, billing, and cancellation">
        <p>
          Steady is {PLAN.priceLabel} after a {PLAN.trialDays}-day free trial. You will see
          the price and the date of your first charge before the trial starts.{" "}
          <strong>Your membership renews automatically each month</strong> at the
          then-current rate until you cancel; if the rate is going to change, we will tell
          you before it applies to you. Payment is handled by a secure third-party payment
          processor — card details never touch our servers — and your bank statement reads
          simply &quot;STEADY MEMBERSHIP.&quot;
        </p>
        <p>
          Cancel anytime from billing settings — two clicks, no contact with anyone
          required — effective at the end of the paid period. If you cancel within your
          first week, you pay nothing. If the fit questions screen you out after a charge,
          that charge is refunded automatically without you asking. Beyond those two
          commitments, refunds are at our discretion.
        </p>
      </Section>

      <Section n={11} title="Intellectual property">
        <p>
          Steady — including its software, session scripts, text, design, audio, and
          trademarks — belongs to us or our licensors. We grant you a personal, limited,
          non-exclusive, non-transferable, revocable license to use it for your own
          wellbeing while you have an account. You may not copy, modify, distribute, sell,
          scrape, reverse-engineer, or create derivative works from any part of the service,
          or use our name or marks, without our prior written consent. What you enter into
          Steady remains yours; you grant us only the limited rights needed to operate the
          service for you, as described in the Privacy Policy.
        </p>
      </Section>

      <Section n={12} title="Third-party services and content">
        <p>
          Parts of Steady rely on third-party services: an AI provider (Anthropic) processes
          companion conversations to generate replies, and a payment processor handles
          billing. Crisis resources link to external organizations (such as 988 and
          findahelpline.com) that we do not operate. We are not responsible for third-party
          services or content, and your use of them is at your own risk and subject to their
          terms. A link from Steady is not an endorsement.
        </p>
      </Section>

      <Section n={13} title="Privacy">
        <p>
          Our <Link href="/privacy" className="underline">Privacy Policy</Link> describes
          exactly what we collect, how it is protected, and your deletion rights — no
          advertising trackers, no sale of data, application-layer encryption of what you
          write, self-serve deletion. We may disclose information where required by law, to
          enforce these terms, to address suspected illegal activity, or to protect the
          rights and safety of members, the public, or Steady — and the Privacy Policy
          governs how.
        </p>
      </Section>

      <Section n={14} title="Indemnification">
        <p>
          You agree to indemnify and hold Steady and the people who build and operate it
          harmless from claims, damages, and reasonable legal costs arising out of your
          violation of these terms, your misuse of the service, or your violation of any
          law or third-party right in connection with your use of Steady. This does not
          apply to claims arising from our own willful misconduct.
        </p>
      </Section>

      <Section n={15} title="Changes to these terms">
        <p>
          These terms are versioned. We may update them, and updates take effect when
          posted on this page with a new version number and effective date. For changes
          that matter, we will show you the new version and record which version you
          accepted. Continued use after notice constitutes acceptance of the updated terms.
        </p>
      </Section>

      <Section n={16} title="Governing law and disputes">
        <p>
          If something goes wrong, contact us first ({CONTACT_EMAIL}) — most issues
          (billing, refunds, deletion) are resolved directly and quickly. These terms are
          governed by the laws of{" "}
          <em>[NEEDS ADDRESSED: state of company formation — confirm with counsel]</em>,
          without regard to conflict-of-law rules, and any dispute that cannot be resolved
          informally will be brought in the state or federal courts located there. These
          terms do not waive your right to bring claims in court.
        </p>
      </Section>

      <Section n={17} title="Contact">
        <p>
          Questions about these terms: {CONTACT_EMAIL}.
        </p>
      </Section>

      <p className="mt-10 text-center text-xs text-olive">
        <Link href="/privacy" className="underline">Privacy Policy</Link> ·{" "}
        <Link href="/" className="underline">Home</Link>
      </p>
    </main>
  );
}
