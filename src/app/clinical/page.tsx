import Link from "next/link";
import { PublicPage, BoundaryNote, CapabilityCard, ReviewCTA } from "@/components/site/PublicChrome";
import { capability, BOUNDARY } from "@/lib/site/registry";
import { T1_DEFAULT_POLICY } from "@/lib/clinical-policy";

export const metadata = {
  title: "For clinical leaders — Steady",
  description: "The intended clinician workflow, where accountability sits, and the questions that still need clinical review.",
};

// Clinical page (Redesign handoff §9). Written so a clinical leader can see the
// intended workflow, find exactly where people remain accountable, and identify
// what still needs their decision.
export default function ClinicalPage() {
  return (
    <PublicPage
      eyebrow="For clinical leaders"
      title="A clinician review layer for between-visit behavioral health support"
      lede="This is a fabricated prototype of a clinician workflow. It is not in use with patients, and it has not been ratified for clinical use."
    >
      <div className="mt-8">
        <BoundaryNote extra={BOUNDARY.noMonitoring} />
      </div>

      <section className="mt-12">
        <h2 className="type-display text-2xl font-medium text-ground">The workflow</h2>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2">
          {["clinical-caseload", "member-timeline", "cited-summaries", "review-actions"].map((id) => (
            <CapabilityCard key={id} c={capability(id)} />
          ))}
        </ul>
      </section>

      <section className="mt-12">
        <h2 className="type-display text-2xl font-medium text-ground">Where people stay accountable</h2>
        <ul className="mt-4 space-y-3 text-ground/80">
          <li className="rounded-2xl border border-ground/10 bg-linen/40 px-5 py-4">
            <strong className="text-ground">Access decisions are deterministic.</strong> Fourteen
            ordered, human-authored checks decide whether a guided session may begin. No model
            participates in that decision.
          </li>
          <li className="rounded-2xl border border-ground/10 bg-linen/40 px-5 py-4">
            <strong className="text-ground">AI drafts; it does not decide.</strong> Every displayed
            claim cites the events it rests on. A claim that cannot cite is suppressed before
            display and reported, so a clinician sees that something was withheld rather than a
            confident gap.
          </li>
          <li className="rounded-2xl border border-ground/10 bg-linen/40 px-5 py-4">
            <strong className="text-ground">Approve, correct, and override are separate.</strong>{" "}
            Approving records that a person read something; it does not make it evidence.
            Correcting appends a superseding entry and never erases the original. An override
            relaxes pacing only — it can never relax a safety stop.
          </li>
          <li className="rounded-2xl border border-ground/10 bg-linen/40 px-5 py-4">
            <strong className="text-ground">Alerts have owners and deadlines.</strong> Deadlines are
            computed from the configured coverage schedule, so they reflect what a rota can
            actually meet. Immediate and high bands close with a documented action, never an
            acknowledgement, and never by the passage of time.
          </li>
        </ul>
      </section>

      <section className="mt-12">
        <h2 className="type-display text-2xl font-medium text-ground">Policies you can compare</h2>
        <p className="mt-2 max-w-3xl text-ground/80">
          Six clinical policy questions are implemented as versioned configuration rather than
          fixed behaviour, so a reviewer can switch a mode and watch the product change instead
          of imagining it. <strong>Every default below is a demonstration assumption, not a
          clinical approval.</strong>
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-sm">
            <caption className="sr-only">Configurable clinical policies and their provisional defaults</caption>
            <thead>
              <tr className="border-b border-ground/15 text-left">
                <th scope="col" className="py-2 pr-4 font-medium">Policy</th>
                <th scope="col" className="py-2 pr-4 font-medium">Provisional default</th>
                <th scope="col" className="py-2 font-medium">Alternatives</th>
              </tr>
            </thead>
            <tbody className="text-ground/80">
              {[
                ["Companion content visibility", T1_DEFAULT_POLICY.companionVisibility, "never · member shared · always"],
                ["Caseload model", T1_DEFAULT_POLICY.caseload, "owned · pooled"],
                ["Coverage schedule", T1_DEFAULT_POLICY.coverage.replace("_", " "), "none · extended · 24 hour"],
                ["Immediate alert consequence", T1_DEFAULT_POLICY.alertConsequence.replace("_", " "), "notify only · lock workflow · emergency path"],
                ["Re-entry after a stop", T1_DEFAULT_POLICY.reEntry.replace("_", " "), "automatic · timed"],
                ["Autonomous engine", T1_DEFAULT_POLICY.autonomous, "recommend (governing is not selectable)"],
              ].map(([a, b, c]) => (
                <tr key={a} className="border-b border-ground/10 align-top">
                  <td className="py-2 pr-4 font-medium text-ground">{a}</td>
                  <td className="py-2 pr-4"><code className="text-xs">{b}</code></td>
                  <td className="py-2 text-xs">{c}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-olive">
          The three with the largest consequences — companion-content visibility, caseload
          ownership, and coverage — are open questions for clinical reviewers. They do not block
          the demonstration; they do determine permissions, accountability, consent, and the
          exact language members are shown.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="type-display text-2xl font-medium text-ground">BLS Part 6</h2>
        <div className="mt-4">
          <ul className="grid gap-4 sm:grid-cols-2">
            <CapabilityCard c={capability("bls-part-6")} />
            <CapabilityCard c={capability("autonomous-engine")} />
          </ul>
        </div>
        <p className="mt-3 text-sm text-ground/80">
          Bilateral stimulation Part 6 continues as a separate clinical-validation workstream
          with its own reviewer, protocol, and evidence. The environment can show the intended
          workflow as a labelled simulation. Real-use access remains gated by its own approvals,
          and autonomous stimulation is off.
        </p>
      </section>

      <section className="mt-12 rounded-2xl border border-pause/50 bg-pause-soft px-6 py-5">
        <h2 className="type-display text-2xl font-medium text-ground">About the prior review record</h2>
        <p className="mt-2 text-sm text-ground/80">
          A previous configuration was ratified with conditions by two independent licensed
          clinicians in July 2026. That record covered the <strong>consumer self-guided
          product</strong>. It did not cover multi-tenancy, the clinician surface,
          clinical-record summaries, the payer view, or BLS Part 6, and it is not presented as
          covering them.
        </p>
        <p className="mt-2 text-sm text-ground/80">
          The packet seeking review of this workflow is a separate, proposed document. It has
          not been submitted, reviewed, or ratified.
        </p>
      </section>

      <ReviewCTA
        heading="Request a clinical workflow review"
        body="Clinical reviewers receive the workflow specification, the proposed review packet, and a guided fabricated scenario set covering routine progress, suppressed claims, alert coverage, companion access, coverage handoff, pause and re-entry, and a Part 6 simulation."
      />
      <p className="mt-4 text-sm text-olive">
        Not the right page? <Link href="/organizations" className="underline">Healthcare organizations</Link>{" "}
        · <Link href="/payers" className="underline">Payers</Link> ·{" "}
        <Link href="/trust" className="underline">Security and privacy</Link>
      </p>
    </PublicPage>
  );
}
