import Link from "next/link";
import {
  PublicHeader, PublicFooter, BoundaryNote, CapabilityCard, AudienceCard, ReviewCTA,
} from "@/components/site/PublicChrome";
import { capability, BOUNDARY } from "@/lib/site/registry";

export const metadata = {
  title: "Steady — behavioral health platform (development prototype)",
  description:
    "Steady connects structured self-guided experiences, clinician review workflows, and longitudinal behavioral health signals in one reviewable platform. Development prototype using fabricated data.",
};

// The institutional homepage (Redesign handoff §7).
//
// It answers four questions in the first screen: what Steady is, who it is for,
// what can be reviewed today, and what it is not yet approved to do. The fourth
// question is the one the previous page never asked — it was a well-built page
// for a transaction Steady is no longer making.
//
// Every status label comes from lib/site/registry.ts. Nothing here states a
// capability status in its own words.

const cap = (id: string) => capability(id);

export default function Home() {
  return (
    <>
      <PublicHeader />

      <main className="mx-auto max-w-5xl px-6 py-12">
        {/* 1 — Hero and current status */}
        <section>
          <p className="text-xs font-medium uppercase tracking-wide text-olive">
            Behavioral health platform · Development prototype
          </p>
          <h1 className="mt-2 max-w-3xl type-display text-5xl font-medium leading-tight text-ground">
            Behavioral health support that continues between visits.
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-ground/80">
            Steady connects structured self-guided experiences, clinician review workflows,
            and longitudinal behavioral health signals in one reviewable platform. The
            current environment uses fabricated data and is built for investor, clinical,
            payer, and security evaluation.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/request-review"
              className="rounded-full bg-ground px-5 py-2.5 text-sm font-medium text-ivory"
            >
              Request a platform review
            </Link>
            <Link
              href="/platform"
              className="rounded-full border border-ground/25 px-5 py-2.5 text-sm font-medium text-ground"
            >
              See how the platform works
            </Link>
          </div>

          <div className="mt-8">
            <BoundaryNote />
          </div>
        </section>

        {/* 2 — The gap Steady addresses. Stated as a structural problem, with
            no outcome promise attached. */}
        <section className="mt-16">
          <h2 className="type-display text-3xl font-medium text-ground">The gap</h2>
          <p className="mt-3 max-w-3xl text-ground/80">
            Most behavioral health care happens in scheduled appointments. The weeks between
            them are where symptoms move, patterns form, and people decide whether to
            continue — and almost none of that reaches the care team. What does arrive is
            recalled, summarised, and weeks old.
          </p>
          <ul className="mt-6 grid gap-4 sm:grid-cols-3">
            {[
              ["Between visits", "Structured support exists in fragments across apps that do not connect to care."],
              ["Fragmented signal", "What happens between appointments is recalled at the next one, not observed."],
              ["Limited visibility", "Care teams see episodes. They rarely see the trajectory that produced them."],
            ].map(([h, b]) => (
              <li key={h} className="rounded-2xl border border-ground/10 bg-linen/40 px-5 py-4">
                <h3 className="font-medium text-ground">{h}</h3>
                <p className="mt-1 text-sm text-ground/80">{b}</p>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-olive">
            Steady is built to close that gap. It has not yet demonstrated that it does —
            see <Link href="/evidence" className="underline">Evidence and validation</Link>.
          </p>
        </section>

        {/* 3 — Three-part platform */}
        <section className="mt-16">
          <h2 className="type-display text-3xl font-medium text-ground">One platform, three layers</h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-3">
            {[
              ["Steady Personal", "Structured between-visit experiences: check-ins, grounding, exercises, education, and companion support."],
              ["Steady Clinical", "A clinician-facing workflow for caseload, timelines, alerts, cited summaries, and review actions."],
              ["Steady Intelligence", "The event, policy, audit, tenancy, and analysis layer connecting member and clinical activity over time."],
            ].map(([h, b]) => (
              <li key={h} className="rounded-2xl border border-ground/15 bg-ivory px-5 py-4">
                <h3 className="type-display text-xl font-medium text-ground">{h}</h3>
                <p className="mt-1 text-sm text-ground/80">{b}</p>
              </li>
            ))}
          </ul>
          <Link href="/platform" className="mt-4 inline-block text-sm font-medium text-ground underline">
            How the three layers fit together →
          </Link>
        </section>

        {/* 4 — Working demonstration. Status comes from the registry. */}
        <section className="mt-16">
          <h2 className="type-display text-3xl font-medium text-ground">What you can review today</h2>
          <p className="mt-2 max-w-3xl text-ground/80">
            The review environment runs the system described above using fabricated people
            and records. Each capability below carries its current status.
          </p>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {["daily-checkin", "clinical-caseload", "cited-summaries", "event-spine"].map((id) => (
              <CapabilityCard key={id} c={cap(id)} />
            ))}
          </ul>
        </section>

        {/* 5 — Human oversight and safety */}
        <section className="mt-16">
          <h2 className="type-display text-3xl font-medium text-ground">Human oversight and safety</h2>
          <p className="mt-2 max-w-3xl text-ground/80">
            Access decisions are made by deterministic, human-authored rules — not by a
            model. Where AI is used, its output is checked before display, cites the events
            it rests on, and is reviewed by a person before it carries any clinical
            consequence.
          </p>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {["safety-gate-chain", "review-actions", "audit-chain", "autonomous-engine"].map((id) => (
              <CapabilityCard key={id} c={cap(id)} />
            ))}
          </ul>
          <p className="mt-4 rounded-2xl border border-ground/15 bg-linen px-5 py-4 text-sm text-ground">
            {BOUNDARY.noMonitoring} Grounding tools and crisis resources are reachable at any
            time and are never placed behind a subscription, a tier, or a successful write.
          </p>
        </section>

        {/* 6 — Built for each audience. Investor sits in a secondary band (§5). */}
        <section className="mt-16">
          <h2 className="type-display text-3xl font-medium text-ground">Built for review</h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            <AudienceCard
              href="/clinical"
              title="For clinical leaders"
              body="The intended workflow, where accountability sits, and the questions that still need clinical review."
              cta="Request a clinical review"
            />
            <AudienceCard
              href="/organizations"
              title="For healthcare organizations"
              body="Deployment model, care-team workflow, integration direction, and what a pilot would require."
              cta="Discuss a pilot"
            />
            <AudienceCard
              href="/payers"
              title="For payers and value-based care"
              body="Engagement and measurement design, population questions, and how an evaluation could be structured."
              cta="Discuss an evaluation"
            />
            <AudienceCard
              href="/trust"
              title="For security and privacy review"
              body="Trust boundaries, data flows, current and planned controls, and the gaps we have already found."
              cta="Request the security packet"
            />
          </ul>
          <p className="mt-4 text-sm text-olive">
            Investor materials are available on request —{" "}
            <Link href="/request-review?path=investor" className="underline">
              request investor materials
            </Link>
            .
          </p>
        </section>

        {/* 7 — Evidence and validation stage. Method evidence is kept
            explicitly separate from product evidence (§2, §11). */}
        <section className="mt-16">
          <h2 className="type-display text-3xl font-medium text-ground">Evidence and stage</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-ground/10 bg-linen/40 px-5 py-4">
              <h3 className="font-medium text-ground">Evidence for the method</h3>
              <p className="mt-1 text-sm text-ground/80">
                Published research and guidelines describe EMDR delivered by trained
                clinicians. That is evidence about the method — it is not evidence about
                Steady.
              </p>
            </div>
            <div className="rounded-2xl border border-ground/10 bg-linen/40 px-5 py-4">
              <h3 className="font-medium text-ground">Evidence for Steady</h3>
              <p className="mt-1 text-sm text-ground/80">
                Deterministic tests, replay verification, safety scenarios, tenant attack
                cases, and accessibility checks. Human-factors work, clinical review,
                security audit, and outcome evaluation are still needed.
              </p>
            </div>
          </div>
          <Link href="/evidence" className="mt-4 inline-block text-sm font-medium text-ground underline">
            What is proven, what is simulated, and what is still needed →
          </Link>
        </section>

        {/* 8 — Current versus target, stated plainly. */}
        <section className="mt-16">
          <h2 className="type-display text-3xl font-medium text-ground">Current and target</h2>
          <p className="mt-2 max-w-3xl text-ground/80">
            A short, honest matrix matters more than a long feature list. This is where the
            platform actually stands.
          </p>
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <caption className="sr-only">Current capability status against target</caption>
              <thead>
                <tr className="border-b border-ground/15 text-left">
                  <th scope="col" className="py-2 pr-4 font-medium">Capability</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Today</th>
                  <th scope="col" className="py-2 font-medium">Target</th>
                </tr>
              </thead>
              <tbody className="text-ground/80">
                {[
                  ["Member experience and safety gates", "Working demo", "Supervised pilot after clinical review"],
                  ["Clinician workflow", "Working demo, policies in review", "Pilot-approved workflow with named accountability"],
                  ["Event history and replay", "Working demo", "Event-authoritative writes on managed Postgres"],
                  ["Tenant separation", "Built and attack-tested, not on the request path", "Enforced end to end with row-level security active"],
                  ["Organization and payer views", "Planned", "Aggregate views with agreed measures"],
                  ["Regulatory posture", "Prototype; no BAAs; counsel review not begun", "Contracts and controls required before real data"],
                ].map(([a, b, c]) => (
                  <tr key={a} className="border-b border-ground/10 align-top">
                    <td className="py-2 pr-4 font-medium text-ground">{a}</td>
                    <td className="py-2 pr-4">{b}</td>
                    <td className="py-2">{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* 9 — Final CTA and FAQ preview */}
        <ReviewCTA />

        <section className="mt-12">
          <h2 className="type-display text-2xl font-medium text-ground">Common questions</h2>
          <dl className="mt-4 space-y-4">
            {[
              ["Can individuals sign up?", "Not at this stage. Public enrollment and subscription billing are closed while Steady is prepared for clinical, security, privacy, and partner review."],
              ["Is Steady therapy or medical care?", "No. The current environment does not provide therapy, medical care, diagnosis, treatment, or emergency services."],
              ["Are clinicians monitoring activity?", "No. The demonstration shows a proposed clinician workflow, but no one monitors activity in real time and no care team is assigned."],
              ["Does the demo contain real health information?", "It must not. The review environment is restricted to fabricated personas and scripted data. Any real-person information is a stop condition."],
            ].map(([q, a]) => (
              <div key={q} className="rounded-2xl border border-ground/10 bg-linen/40 px-5 py-4">
                <dt className="font-medium text-ground">{q}</dt>
                <dd className="mt-1 text-sm text-ground/80">{a}</dd>
              </div>
            ))}
          </dl>
          <Link href="/faq" className="mt-4 inline-block text-sm font-medium text-ground underline">
            All questions, by audience →
          </Link>
        </section>
      </main>

      <PublicFooter />
    </>
  );
}
