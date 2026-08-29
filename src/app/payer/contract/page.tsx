import { PayerPage } from "@/components/app/PayerPage";
import { EnvelopeView } from "@/components/presentation/EnvelopeView";
import { Note, Panel, WithNote } from "@/components/app/surfaces";
import { buildContractReport } from "@/lib/intelligence/payer";
import { resolvePayerTenant } from "@/lib/intelligence/scope";

export const dynamic = "force-dynamic";
export const metadata = { title: "Contract report — Steady Intelligence" };

// Contract report (§26: "Review agreed measures — observed versus target —
// Download").
//
// Two rules govern the table below and both are about what a miss looks like.
//
// A measure that MISSES renders exactly as legibly as one that meets. A report
// that softens a miss is worse than no report, because the softening is
// invisible to the person relying on it — and this is the screen where the
// incentive to soften is strongest.
//
// A measure that CANNOT BE COMPUTED renders as blank with a reason, never as
// zero and never as a pass. Utilisation measures use only months whose claims
// have arrived, so a rate here is never flattered by a partial month.
//
// Download is absent for the same reason it is absent on the organization's
// reports screen: an export is a disclosure, and it needs filter parity, a
// cohort version, suppression, a stated purpose, an audit event and a
// signature before it is one.

export default async function PayerContractPage() {
  const tenantId = await resolvePayerTenant();
  const envelope = tenantId ? await buildContractReport(tenantId) : null;

  return (
    <PayerPage
      layer="evidence"
      here="/payer/contract"
      title="Contract report"
      lede="Every agreed measure against its target, including the ones that miss and the ones that cannot be computed."
    >
      {!envelope ? (
        <Panel title="No plan in scope">
          <p className="measure text-ground/90">This account is not bound to exactly one contracted plan.</p>
        </Panel>
      ) : (
        <EnvelopeView envelope={envelope} title="Contract report" audience="operations">
          {(r) => (
            <WithNote
              note={
                <Note
                  tone="info"
                  title="What this is not"
                  owner="Plan analytics, with actuarial review for anything modelled"
                  boundary="Observed measures against agreed targets. Meeting a target is not evidence that the programme caused it, and nothing here is a cost or savings figure."
                >
                  <p>
                    Cohort <span className="font-mono text-xs">{r.contract.cohortVersion}</span>,
                    period {r.contract.periodStart} to {r.contract.periodEnd}.
                  </p>
                </Note>
              }
            >
              <Panel
                title={r.contract.name}
                footnote={`Utilisation measures use only months whose claims have arrived, so no rate here is flattered by a partial month. Contract expects a ${r.contract.claimsLagDays}-day claims lag.`}
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Agreed measures, observed value against target</caption>
                    <thead>
                      <tr className="border-b border-ground/10 text-left">
                        <th scope="col" className="py-2 pr-4 font-semibold text-app-ink">Measure</th>
                        <th scope="col" className="py-2 pr-4 font-semibold text-app-ink">Observed</th>
                        <th scope="col" className="py-2 pr-4 font-semibold text-app-ink">Target</th>
                        <th scope="col" className="py-2 font-semibold text-app-ink">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.measures.map((m) => (
                        <tr key={m.metric} className="border-b border-ground/5 last:border-0 align-top">
                          <th scope="row" className="py-3 pr-4 text-left font-medium text-ground">
                            {m.label}
                            <span className="block text-xs font-normal text-olive">{m.unit}</span>
                          </th>
                          <td className="py-3 pr-4 text-ground">
                            {m.observed === null ? <span className="text-olive">not reported</span> : m.observed}
                          </td>
                          <td className="py-3 pr-4 text-ground">
                            {m.target}
                            <span className="block text-xs text-olive">
                              {m.better === "lower" ? "lower is better" : "higher is better"}
                            </span>
                          </td>
                          <td className="py-3">
                            {m.met === null ? (
                              <span className="text-sm text-olive">
                                <span aria-hidden>○</span> not computed
                                {m.withheld && <span className="block text-xs">{m.withheld}</span>}
                              </span>
                            ) : m.met ? (
                              <span className="text-sm font-medium text-state-safe">
                                <span aria-hidden>◆</span> met
                              </span>
                            ) : (
                              // Exactly as legible as "met". A report that
                              // softens a miss is worse than no report.
                              <span className="text-sm font-medium text-state-support">
                                <span aria-hidden>▲</span> not met
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </WithNote>
          )}
        </EnvelopeView>
      )}
    </PayerPage>
  );
}
