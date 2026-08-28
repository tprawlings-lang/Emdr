import Link from "next/link";
import { PublicPage, BoundaryNote } from "@/components/site/PublicChrome";
import { BOUNDARY } from "@/lib/site/registry";

export const metadata = {
  title: "Request a review — Steady",
  description: "Controlled access to the Steady review environment for clinical, organization, payer, investor, and security reviewers.",
};

const PATHS = [
  ["clinical", "Clinical review", "Assess the intended workflow, alert duties, policy modes, and the questions still open for clinical decision."],
  ["organization", "Organization / pilot", "Review the deployment model, care-team workflow, roles a pilot requires, and integration direction."],
  ["payer", "Evaluation design", "Review candidate measures, population questions, and how an evaluation could be structured."],
  ["security", "Security and privacy", "Inspect trust boundaries, data flows, controls, attack cases, and the known-gap register."],
  ["investor", "Investor materials", "Platform overview, architecture, roadmap, risks, and current stage."],
] as const;

// The review gateway (Redesign handoff §12). Replaces public signup.
//
// Access is requested, not self-served, and no credentials appear anywhere on a
// public page. This is also the route /signup now redirects to — closing the
// path that was letting real email addresses into a fabricated environment.
export default function RequestReview({
  searchParams,
}: { searchParams: Promise<{ from?: string; path?: string }> }) {
  return (
    <PublicPage
      eyebrow="Controlled access"
      title="Request a review"
      lede="Steady is not open for public enrollment. Access to the review environment is granted per reviewer, scoped to a purpose."
    >
      <div className="mt-8"><BoundaryNote extra={BOUNDARY.demoData} /></div>

      <section className="mt-12">
        <h2 className="type-display text-2xl font-medium text-ground">Choose a review path</h2>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2">
          {PATHS.map(([id, title, body]) => (
            <li key={id} className="rounded-2xl border border-ground/10 bg-linen/40 px-5 py-4">
              <h3 className="font-medium text-ground">{title}</h3>
              <p className="mt-1 text-sm text-ground/80">{body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12">
        <h2 className="type-display text-2xl font-medium text-ground">What happens next</h2>
        <ol className="mt-4 space-y-3">
          {[
            ["Tell us the review purpose", "Which of the paths above, and who is reviewing."],
            ["Read the boundary", "Fabricated data, no clinical care, no real-time monitoring, no public enrollment."],
            ["Receive scoped access", "An access code limited to your review path. Permissions match the role; nothing is shared publicly."],
            ["Enter a guided scenario", "A fabricated persona, scripted scenario steps, expected states, status labels, and a feedback path."],
          ].map(([h, b], i) => (
            <li key={h} className="flex gap-4 rounded-2xl border border-ground/10 bg-ivory px-5 py-4">
              <span className="type-display text-2xl text-olive">{i + 1}</span>
              <div>
                <h3 className="font-medium text-ground">{h}</h3>
                <p className="mt-0.5 text-sm text-ground/80">{b}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-12 rounded-2xl border border-ground/15 bg-moss/30 px-6 py-6">
        <h2 className="type-display text-2xl font-medium text-ground">Contact</h2>
        <p className="mt-2 text-sm text-ground/80">
          Review access is arranged directly while the request workflow is being built. Include
          your review path, your organization, and what you most want to inspect.
        </p>
        <p className="mt-3 text-sm text-olive">
          A reviewer intake form is a planned capability. Until it ships, requests are handled
          by direct arrangement so that every access grant is scoped and recorded.
        </p>
      </section>

      <p className="mt-8 text-sm text-olive">
        Looking for support rather than a review? Steady is not open for enrollment, and it is
        not an emergency service. The{" "}
        <Link href="/crisis" className="underline">crisis resources page</Link> is public and
        always available.
      </p>
    </PublicPage>
  );
}
