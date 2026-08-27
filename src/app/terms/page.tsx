import Link from "next/link";
import { PublicPage, BoundaryNote } from "@/components/site/PublicChrome";

export const metadata = { title: "Demo Terms of Use — Steady" };

// Demo Terms (Redesign handoff §16). Replaces consumer subscription terms that
// described billing, refunds, and real member data — none of which exist here.
//
// Marked as a draft pending counsel review, because counsel has not been
// engaged. Publishing an accurate draft that says so is better than leaving
// documents in place that are confidently wrong about what this environment is.
export default function TermsPage() {
  return (
    <PublicPage
      eyebrow="Legal"
      title="Demo Terms of Use"
      lede="These terms govern access to the Steady review environment. They are not terms for a healthcare service, because Steady does not currently provide one."
    >
      <p className="mt-6 rounded-2xl border border-pause/50 bg-pause-soft px-5 py-4 text-sm text-ground">
        <strong>Draft pending legal review.</strong> Counsel has not yet reviewed this document.
        It is published because it describes the environment accurately, and because the
        previous consumer terms did not. Version 2026-08-27.
      </p>

      <div className="mt-8"><BoundaryNote /></div>

      <div className="mt-10 space-y-8 text-ground/80">
        <section>
          <h2 className="font-serif text-2xl font-medium text-ground">1. What this is</h2>
          <p className="mt-2">
            Steady is a development-stage software prototype. Access is granted for evaluation
            only: to review the product, its architecture, its safety behavior, and its
            controls. It is <strong>not</strong> a healthcare service, a medical device, or a
            clinical tool, and access does not create a care relationship.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-2xl font-medium text-ground">2. Evaluation-only licence</h2>
          <p className="mt-2">
            You may access the environment to evaluate it for the purpose your review was
            arranged for. You may not use it to deliver care, to make decisions about a real
            person, or to represent Steady as approved, validated, compliant, or available.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-2xl font-medium text-ground">3. No clinical reliance</h2>
          <p className="mt-2">
            Nothing in the environment is clinical advice. All records, alerts, summaries,
            timelines, and safety decisions concern fabricated people. Do not rely on any output
            for a real person&rsquo;s care under any circumstances.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-2xl font-medium text-ground">4. No real-person data</h2>
          <p className="mt-2">
            <strong>You must not enter real personal, health, employment, or payer information
            into any part of this environment</strong> — including your own. If real-person
            information is entered, it is a stop condition: the environment is isolated, the
            information removed through an approved process, exposure assessed, and access
            suspended until the cause is corrected.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-2xl font-medium text-ground">5. Access and credentials</h2>
          <p className="mt-2">
            Review access is granted per reviewer and scoped to a purpose. Access codes are not
            to be shared or published. Access may be revoked or rotated at any time, and it
            expires by default.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-2xl font-medium text-ground">6. Feedback</h2>
          <p className="mt-2">
            Feedback you provide about the product may be used to improve it. Clinical, security,
            and privacy findings are recorded with the configuration that produced them so they
            can be acted on precisely. You retain any rights you already hold in materials you
            supply.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-2xl font-medium text-ground">7. Confidentiality</h2>
          <p className="mt-2">
            The environment, its evidence packets, and unreleased materials are shared for review
            and are not public. Findings you produce are yours to discuss with us; please do not
            publish screenshots that could be mistaken for a live clinical product.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-2xl font-medium text-ground">8. No warranty and limits</h2>
          <p className="mt-2">
            The environment is provided as-is for evaluation. It may be reset, changed, or taken
            offline without notice — a reset is a routine operation here, not an incident. No
            availability, fitness, or performance is promised.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-2xl font-medium text-ground">9. Emergencies</h2>
          <p className="mt-2">
            Steady is not an emergency service and no one monitors this environment in real
            time. If you or someone else needs help now, call or text 988 in the US, or call 911
            in immediate danger. See <Link href="/crisis" className="underline">crisis resources</Link>.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-2xl font-medium text-ground">10. Changes</h2>
          <p className="mt-2">
            These terms will be replaced once counsel has reviewed them, and again before any
            environment involving real participants. Material changes will be dated here.
          </p>
        </section>
      </div>

      <p className="mt-10 text-sm text-olive">
        See also the <Link href="/privacy" className="underline">Demo Privacy Notice</Link> and{" "}
        <Link href="/accessibility" className="underline">Accessibility statement</Link>.
      </p>
    </PublicPage>
  );
}
