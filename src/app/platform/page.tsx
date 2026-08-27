import Link from "next/link";
import { PublicPage, BoundaryNote, CapabilityCard, ReviewCTA } from "@/components/site/PublicChrome";
import { byLayer } from "@/lib/site/registry";

export const metadata = {
  title: "How Steady works — platform",
  description: "Steady Personal, Steady Clinical, and Steady Intelligence: what each layer does and its current status.",
};

// Platform page (Redesign handoff §8). Presents the product system, then the
// sequence it runs, then — deliberately — what must NOT be read as finished.
export default function PlatformPage() {
  const LAYERS = [
    ["Steady Personal", "personal", "Structured between-visit experiences: check-ins, grounding, exercises, education, and companion support. There is no public enrollment."],
    ["Steady Clinical", "clinical", "A clinician-facing workflow for caseload, timelines, alerts, cited summaries, and review, correction, and override actions."],
    ["Steady Intelligence", "intelligence", "The event, policy, audit, and tenancy layer that connects member and clinical activity over time."],
    ["Platform controls", "platform", "The safety and governance machinery every layer depends on."],
  ] as const;

  return (
    <PublicPage
      eyebrow="Platform"
      title="How Steady works"
      lede="One system with three layers, built so that what it does and what it has not yet earned the right to claim are separately visible."
    >
      <div className="mt-8"><BoundaryNote /></div>

      <section className="mt-12">
        <h2 className="font-serif text-2xl font-medium text-ground">The sequence</h2>
        <ol className="mt-4 space-y-3">
          {[
            ["Observe", "A member produces structured signals through check-ins, exercises, conversations, and sessions."],
            ["Protect", "Deterministic rules evaluate fit, readiness, safety, modality, and current state before any model use or session access."],
            ["Record", "Versioned events and audit entries preserve who did what, under which policy and code version."],
            ["Review", "Clinicians see a caseload, cited summaries, alerts, and separate approve, correct, and override actions."],
            ["Learn", "Authorized organization and payer views use aggregate signals to demonstrate evaluation possibilities."],
            ["Govern", "Policy modes, tenant boundaries, security evidence, and current-versus-target labels stay visible."],
          ].map(([h, b], i) => (
            <li key={h} className="flex gap-4 rounded-2xl border border-ground/10 bg-linen/40 px-5 py-4">
              <span className="font-serif text-2xl text-olive">{i + 1}</span>
              <div>
                <h3 className="font-medium text-ground">{h}</h3>
                <p className="mt-0.5 text-sm text-ground/80">{b}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {LAYERS.map(([title, layer, body]) => (
        <section key={title} className="mt-12">
          <h2 className="font-serif text-2xl font-medium text-ground">{title}</h2>
          <p className="mt-1 max-w-2xl text-ground/80">{body}</p>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2">
            {byLayer(layer).map((c) => <CapabilityCard key={c.id} c={c} />)}
          </ul>
        </section>
      ))}

      {/* §8: what must not be shown as a finished platform capability. */}
      <section className="mt-12 rounded-2xl border border-support/30 bg-support/5 px-6 py-5">
        <h2 className="font-serif text-2xl font-medium text-ground">Not finished, and not claimed</h2>
        <p className="mt-2 text-sm text-ground/80">
          These are named here rather than left for a reviewer to discover. None of them is
          available, approved, or demonstrated as working:
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ground/80">
          <li>Real-time clinician monitoring</li>
          <li>Approved AI clinical summaries</li>
          <li>Production payer exchange or reimbursement</li>
          <li>Production HIPAA compliance</li>
          <li>Validated clinical outcomes from Steady</li>
          <li>Autonomous real-person bilateral stimulation or trauma processing</li>
        </ul>
        <p className="mt-3 text-sm text-ground/80">
          See <Link href="/evidence" className="underline">Evidence and validation</Link> for what
          supports each claim, and <Link href="/trust" className="underline">Trust &amp; Safety</Link> for
          the control status.
        </p>
      </section>

      <ReviewCTA />
    </PublicPage>
  );
}
