import Link from "next/link";
import { PublicPage, BoundaryNote } from "@/components/site/PublicChrome";
import { controlsByArea, KNOWN_GAPS, CONTROL_STATE_LABEL, CONTROL_STATE_MEANING, type ControlState } from "@/lib/site/trust";
import { BOUNDARY } from "@/lib/site/registry";

export const metadata = {
  title: "Trust & Safety — Steady",
  description: "Current posture, data flows, control status, vendor exposure, and the gaps we have already found.",
};

const STATE_STYLE: Record<ControlState, string> = {
  current: "bg-safe/20 text-ground border-safe/40",
  dormant: "bg-pause-soft text-ground border-pause/50",
  planned: "bg-linen text-olive border-ground/15",
};

function StateBadge({ state }: { state: ControlState }) {
  return (
    <span
      data-testid="control-state"
      title={CONTROL_STATE_MEANING[state]}
      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${STATE_STYLE[state]}`}
    >
      {CONTROL_STATE_LABEL[state]}
    </span>
  );
}

// Trust Center (Redesign handoff §11). Earns confidence through precision, not
// reassurance: it names what is dormant and lists the gaps rather than waiting
// for a reviewer to find them.
export default function TrustPage() {
  const areas = controlsByArea();
  return (
    <PublicPage
      eyebrow="Trust & Safety"
      title="What is enforced, what is dormant, and what is missing"
      lede="This page is written to be checked. Where a control is built but not yet on the request path, it says so — a control that would pass a code review and protect nobody is the one worth naming."
    >
      <div className="mt-8"><BoundaryNote extra={BOUNDARY.demoData} /></div>

      <section className="mt-12">
        <h2 className="font-serif text-2xl font-medium text-ground">Current posture</h2>
        <ul className="mt-3 space-y-2 text-ground/80">
          <li>Fabricated data only. No real patient, payer, or employee information exists in any environment.</li>
          <li>No production healthcare claim. Steady is not HIPAA compliant and is nobody&rsquo;s business associate.</li>
          <li>No real-person use. There is no public enrollment and no assigned care team.</li>
          <li>Counsel review of the regulatory lane has not begun, and no independent security review has been performed.</li>
        </ul>
      </section>

      <section className="mt-12">
        <h2 className="font-serif text-2xl font-medium text-ground">System and data flow</h2>
        <p className="mt-2 max-w-3xl text-ground/80">
          Six governance zones separate operational records, patient memory, the clinical
          record, analytics, research, and model development. Retrieval is scoped by tenant,
          zone, and purpose.
        </p>
        <h3 className="mt-6 font-medium text-ground">Where data leaves Steady</h3>
        <p className="mt-1 text-sm text-ground/80">
          The complete list. Any egress not on it is a finding, and that is the property the
          threat model tests.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <caption className="sr-only">Egress points and the control required before real data</caption>
            <thead>
              <tr className="border-b border-ground/15 text-left">
                <th scope="col" className="py-2 pr-4 font-medium">Destination</th>
                <th scope="col" className="py-2 pr-4 font-medium">What it carries</th>
                <th scope="col" className="py-2 font-medium">Required before real data</th>
              </tr>
            </thead>
            <tbody className="text-ground/80">
              {[
                ["Model provider", "Companion messages, recent conversation history, model-exposable memories, profile context", "Agreement with zero or minimal retention and no training on submitted content"],
                ["Object storage", "Full database backups, encrypted before upload", "Agreement, key custody, and a rehearsed restore"],
                ["Hosting provider", "Everything at rest and in flight", "Agreement and a region commitment"],
                ["Email", "Backup failure alerts only — no member content", "Agreement if member-facing email is introduced"],
                ["Error reporting", "Not present", "Scrubbing proven by test, or no such service at all"],
                ["Analytics", "Not present", "A documented re-identification assessment before it is built"],
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
        <p className="mt-3 text-sm text-olive">
          Field encryption protects data <strong>at rest</strong> and in backups. Content sent to
          the model provider is decrypted by definition, so &ldquo;member content is
          encrypted&rdquo; would be misleading without that qualifier.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="font-serif text-2xl font-medium text-ground">Control status</h2>
        <p className="mt-2 max-w-3xl text-ground/80">
          Current means enforcing today. Dormant means built and tested but not on the request
          path. Planned means no control exists yet.
        </p>
        {Object.entries(areas).map(([area, controls]) => (
          <div key={area} className="mt-6">
            <h3 className="font-medium text-ground">{area}</h3>
            <ul className="mt-2 space-y-2">
              {controls.map((c) => (
                <li key={c.id} data-testid="control-row" className="rounded-2xl border border-ground/10 bg-linen/40 px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ground">{c.name}</span>
                    <StateBadge state={c.state} />
                  </div>
                  <p className="mt-1 text-sm text-ground/80">{c.detail}</p>
                  <p className="mt-1 text-xs text-olive">
                    Owner: {c.owner}
                    {c.evidence ? <> · Evidence: <code className="text-[11px]">{c.evidence}</code></> : null}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="mt-12">
        <h2 className="font-serif text-2xl font-medium text-ground">Known gaps</h2>
        <p className="mt-2 max-w-3xl text-ground/80">
          Given to reviewers rather than left for them to find. Each carries an owner, the tier
          it must close before, the interim mitigation, and the test that decides it is closed.
        </p>
        <ul className="mt-4 space-y-3">
          {KNOWN_GAPS.map((g) => (
            <li key={g.id} data-testid="known-gap" className="rounded-2xl border border-support/25 bg-support/5 px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-ground/10 px-2 py-0.5 text-xs font-medium uppercase tracking-wide">
                  {g.risk} risk
                </span>
                <span className="text-xs text-olive">closes before {g.targetTier}</span>
                <span className="text-xs text-olive">· owner: {g.owner}</span>
              </div>
              <p className="mt-1 text-sm text-ground">{g.finding}</p>
              <p className="mt-1 text-xs text-ground/80"><strong>Interim mitigation:</strong> {g.mitigation}</p>
              <p className="mt-0.5 text-xs text-ground/80"><strong>Closed when:</strong> {g.acceptance}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12 rounded-2xl border border-ground/15 bg-moss/30 px-6 py-6">
        <h2 className="font-serif text-2xl font-medium text-ground">Request the security packet</h2>
        <p className="mt-2 text-sm text-ground/80">
          Controlled access to the threat model and abuse cases, the risk register, the vendor
          and agreement register, the identity and privilege model, the logging and monitoring
          plan, the incident and breach-response supplement, and the test evidence index.
        </p>
        <Link href="/request-review?path=security" className="mt-4 inline-block rounded-full bg-ground px-5 py-2 text-sm font-medium text-ivory">
          Request security review access
        </Link>
      </section>
    </PublicPage>
  );
}
