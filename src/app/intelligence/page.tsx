import Link from "next/link";
import { PublicPage, BoundaryNote, CapabilityCard, AudienceCard, ReviewCTA } from "@/components/site/PublicChrome";
import { byLayer } from "@/lib/site/registry";

export const metadata = {
  title: "Steady Intelligence — aggregate views, and what they may not do",
  description:
    "How organization and payer views are computed, what they are forbidden from showing, and how a number on a screen is traced back to the events behind it.",
};

// Steady Intelligence (§26 p45: "/intelligence — Review aggregate intelligence
// — organization and payer examples — Explore").
//
// A SEPARATE SCREEN FROM /organizations AND /payers. Those two answer "what is
// the operating value" and "what is the contract value" — questions asked by a
// buyer. This one answers "how does it work, and what stops it doing the
// obvious wrong thing" — the question asked by whoever has to approve it.
//
// THE CONSTRAINTS ARE THE PRODUCT HERE. An aggregate layer's dangerous failure
// is not a wrong number; it is a right number that identifies somebody. So the
// section that matters most on this page is the one listing what the aggregate
// views are forbidden from doing, and each item is a mechanism that exists in
// the code rather than a policy somebody intends to follow.

const FORBIDDEN: Array<{ rule: string; how: string }> = [
  {
    rule: "An aggregate account cannot reach a person.",
    how:
      "Not by convention — the organization population carries a NULL display name, so the drilldown is impossible rather than refused. There is nothing to render even if the check were removed.",
  },
  {
    rule: "A small group is suppressed, and the suppression is visible.",
    how:
      "A cell below the small-cell threshold is not silently dropped; the screen says a value was withheld and why, because a missing row and a suppressed row mean different things.",
  },
  {
    rule: "Every rate is shown with its denominator.",
    how:
      "Four sites at 61, 58, 55 and 52 per cent are drawn on a fixed 0–100% axis rather than scaled to the largest, so a nine-point spread cannot be made to look like a collapse. Each row prints the population it is drawn from.",
  },
  {
    rule: "Incomplete data stays visibly incomplete.",
    how:
      "Claims arrive with a lag of roughly sixty days, so recent months are genuinely partial. They are drawn as partial rather than as a decline, because a lag rendered as a trend is a false finding a buyer would act on.",
  },
  {
    rule: "One tenant cannot read another.",
    how:
      "The repository injects the tenant predicate beneath the call site, and Postgres row-level security enforces it again in the database, so a bug in the application layer still cannot cross the boundary.",
  },
  {
    rule: "No number on a screen is unfalsifiable.",
    how:
      "A statement can be traced back through the projection that produced it to the events behind it — and when it cannot, the trace says so rather than reporting success.",
  },
];

export default function IntelligencePage() {
  return (
    <PublicPage
      eyebrow="Steady Intelligence"
      title="Aggregate views, and what they may not do"
      lede="How an organization or payer view is computed, what it is structurally prevented from showing, and how any figure on it can be walked back to the events it came from."
    >
      <div className="mt-8"><BoundaryNote /></div>

      <section className="mt-12">
        <h2 className="type-display text-2xl font-medium text-ground">What the aggregate layer may not do</h2>
        <p className="mt-1 max-w-2xl text-ground/80">
          An aggregate layer&rsquo;s dangerous failure is not a wrong number. It is a right number
          that identifies somebody. Each rule below is a mechanism in the code, not an intention.
        </p>
        <ul className="mt-4 space-y-4">
          {FORBIDDEN.map((row) => (
            <li key={row.rule} className="rounded-2xl border border-ground/10 bg-linen/40 px-5 py-4">
              <p className="font-medium text-ground">{row.rule}</p>
              <p className="mt-1 text-sm text-ground/80">{row.how}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12">
        <h2 className="type-display text-2xl font-medium text-ground">The two audiences</h2>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2">
          <AudienceCard
            href="/organizations"
            title="Organizations"
            body="Access, capacity and the action queue: whether people who were referred actually started care, and where the delay is."
            cta="Review operating value"
          />
          <AudienceCard
            href="/payers"
            title="Payers"
            body="Contract measures against target, and the cost model that produced each figure, versioned so a change is attributable."
            cta="Review contract value"
          />
        </ul>
      </section>

      <section className="mt-12">
        <h2 className="type-display text-2xl font-medium text-ground">The intelligence capabilities</h2>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2">
          {byLayer("intelligence").map((c) => <CapabilityCard key={c.id} c={c} />)}
        </ul>
      </section>

      <section className="mt-12">
        <h2 className="type-display text-2xl font-medium text-ground">Modelled is labelled as modelled</h2>
        <p className="mt-2 max-w-2xl text-ground/80">
          Some figures are observed and some are produced by a model. They are never drawn the
          same way: a modelled series carries its own treatment and its assumptions are stated
          beside it, because a projection presented as a measurement is the one error in this
          layer that a reader has no way to catch.
        </p>
        <p className="mt-3 max-w-2xl text-sm text-ground/80">
          <Link href="/evidence" className="font-medium text-ground underline">
            What has been demonstrated, and what has been validated
          </Link>
        </p>
      </section>

      <ReviewCTA heading="Explore the aggregate views" />
    </PublicPage>
  );
}
