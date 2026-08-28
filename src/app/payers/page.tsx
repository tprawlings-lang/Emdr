import Link from "next/link";
import { PublicPage, BoundaryNote, CapabilityCard, ReviewCTA } from "@/components/site/PublicChrome";
import { capability } from "@/lib/site/registry";

export const metadata = {
  title: "For payers and value-based care — Steady",
  description: "Engagement and measurement design, population questions, and how an evaluation could be structured.",
};

// Payers page (Redesign handoff §10). Measures are framed as candidates for
// evaluation, never as proven indicators, and no billing code is named as
// settled.
export default function PayersPage() {
  return (
    <PublicPage
      eyebrow="For payers and value-based care"
      title="A measurement and engagement layer designed for evaluation"
      lede="Steady is at the prototype stage. This page describes how an evaluation could be designed — not results, coverage, or savings."
    >
      <div className="mt-8"><BoundaryNote /></div>

      <section className="mt-12">
        <h2 className="type-display text-2xl font-medium text-ground">What Steady can measure</h2>
        <p className="mt-2 max-w-3xl text-ground/80">
          The platform produces structured, timestamped signals: check-in state, instrument
          scores, session participation and outcomes, intervention completion, and safety
          events. Aggregate views over fabricated data can demonstrate the shape of an
          evaluation.
        </p>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2">
          {["event-spine", "population-views", "daily-checkin", "audit-chain"].map((id) => (
            <CapabilityCard key={id} c={capability(id)} />
          ))}
        </ul>
        <p className="mt-3 text-sm text-olive">
          Aggregate views are clearly separated from individual clinical records. Population
          views are a planned capability, shown as fabricated aggregates only.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="type-display text-2xl font-medium text-ground">Candidate measures</h2>
        <p className="mt-2 max-w-3xl text-ground/80">
          These are <strong>candidates for evaluation, not proven leading indicators</strong>.
          Whether any predicts a downstream outcome is exactly the question an evaluation would
          answer.
        </p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {[
            ["Adoption", "Proportion of an eligible population that begins and continues."],
            ["Engagement", "Frequency and consistency of structured between-visit activity."],
            ["Safety events", "Rate, type, and resolution of alerts and hard stops."],
            ["Clinical usefulness", "Whether clinicians find the signal actionable."],
            ["Retention", "Continuation over time and reasons for discontinuation."],
            ["Utilization and cost", "Whether any relationship to service use can be measured."],
          ].map(([h, b]) => (
            <li key={h} className="rounded-2xl border border-ground/10 bg-linen/40 px-5 py-4">
              <h3 className="font-medium text-ground">{h}</h3>
              <p className="mt-0.5 text-sm text-ground/80">{b}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12">
        <h2 className="type-display text-2xl font-medium text-ground">Possible payment lanes</h2>
        <p className="mt-2 max-w-3xl text-ground/80">
          Described broadly and deliberately: partner-sponsored, payer-supported, value-based,
          or self-pay. No billing code is presented as settled, and no reimbursement path is
          presented as established.
        </p>
      </section>

      <section className="mt-12 rounded-2xl border border-support/30 bg-support/5 px-6 py-5">
        <h2 className="type-display text-2xl font-medium text-ground">What we do not claim</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ground/80">
          <li>Cost savings</li>
          <li>Reimbursement or coverage</li>
          <li>Return on investment</li>
          <li>Utilization reduction</li>
          <li>Validated risk prediction</li>
        </ul>
        <p className="mt-3 text-sm text-ground/80">
          See <Link href="/evidence" className="underline">Evidence and validation</Link> for the
          separation between evidence about the method and evidence about Steady.
        </p>
      </section>

      <ReviewCTA
        heading="Discuss an evaluation design"
        body="An evaluation conversation covers the population, agreed measures, data boundaries, consent, and what would count as a result worth acting on."
      />
    </PublicPage>
  );
}
