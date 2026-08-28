import Link from "next/link";
import { PublicPage, BoundaryNote, CapabilityCard, ReviewCTA } from "@/components/site/PublicChrome";
import { capability } from "@/lib/site/registry";

export const metadata = {
  title: "For healthcare organizations — Steady",
  description: "Deployment model, care-team workflow, integration direction, and what a pilot would require.",
};

// Organizations page (Redesign handoff §10). Claims boundary is explicit: no
// workload, outcome, readiness, or integration claims without evidence.
export default function OrganizationsPage() {
  return (
    <PublicPage
      eyebrow="For healthcare organizations"
      title="A reviewable platform for structured support between visits"
      lede="Steady is at the prototype stage. This page describes the intended deployment model and what a supervised pilot would require — not a product ready to deploy."
    >
      <div className="mt-8"><BoundaryNote /></div>

      <section className="mt-12">
        <h2 className="type-display text-2xl font-medium text-ground">Operating model</h2>
        <p className="mt-2 max-w-3xl text-ground/80">
          Each organization is a separate tenant. A synthetic organization can be created and
          shown separated from another tenant in the review environment, including the attack
          cases that test the boundary.
        </p>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2">
          {["tenant-isolation", "audit-chain", "clinical-caseload", "population-views"].map((id) => (
            <CapabilityCard key={id} c={capability(id)} />
          ))}
        </ul>
        <p className="mt-3 text-sm text-olive">
          Tenant separation controls are built and adversarially tested. They are not yet on the
          request path of the running environment, which uses SQLite — stated here rather than
          left for a security reviewer to discover.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="type-display text-2xl font-medium text-ground">Care-team workflow</h2>
        <p className="mt-2 max-w-3xl text-ground/80">
          The demonstration uses a primary-owner plus coverage-pool model, which is a
          configurable assumption rather than a decided policy. A reviewer can switch it to
          strict ownership or an open pool and see the difference in permissions and alert
          routing.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="type-display text-2xl font-medium text-ground">Roles a pilot would require</h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {[
            ["Clinical owner", "Accountable for the workflow, alert response, and escalation."],
            ["Security owner", "Reviews controls, boundaries, logging, and incident handling."],
            ["Privacy and legal review", "Determines lane, contracts, consent, and disclosure."],
            ["Support", "Handles participant questions and access issues."],
            ["Incident response", "Named path for safety and security events."],
            ["Evaluation owner", "Agrees measures and data boundaries in advance."],
          ].map(([h, b]) => (
            <li key={h} className="rounded-2xl border border-ground/10 bg-linen/40 px-5 py-4">
              <h3 className="font-medium text-ground">{h}</h3>
              <p className="mt-0.5 text-sm text-ground/80">{b}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12">
        <h2 className="type-display text-2xl font-medium text-ground">Integration</h2>
        <p className="mt-2 max-w-3xl text-ground/80">
          Record-system and identity integration are target architecture. No integration exists
          in the reviewed build, and none is claimed.
        </p>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2">
          <CapabilityCard c={capability("ehr-integration")} />
          <CapabilityCard c={capability("event-spine")} />
        </ul>
      </section>

      <section className="mt-12 rounded-2xl border border-support/30 bg-support/5 px-6 py-5">
        <h2 className="type-display text-2xl font-medium text-ground">What we do not claim</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ground/80">
          <li>Reduced clinician workload</li>
          <li>Improved patient outcomes</li>
          <li>Deployment readiness</li>
          <li>Existing integrations</li>
          <li>Regulatory compliance certification</li>
        </ul>
        <p className="mt-3 text-sm text-ground/80">
          Each of those requires evidence Steady does not yet have. See{" "}
          <Link href="/evidence" className="underline">Evidence and validation</Link>.
        </p>
      </section>

      <ReviewCTA
        heading="Discuss a pilot design"
        body="A pilot conversation covers scope, roles, consent, protocol, measures, security review, and the gates that must pass before any real participant is involved."
      />
    </PublicPage>
  );
}
