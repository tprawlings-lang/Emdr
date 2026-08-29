import { PayerPage } from "@/components/app/PayerPage";
import { EnvelopeView } from "@/components/presentation/EnvelopeView";
import { Note, Panel, WithNote } from "@/components/app/surfaces";
import { Figure, IntervalChart } from "@/components/charts/aggregate";
import { buildCostModel } from "@/lib/intelligence/payer";
import { resolvePayerTenant } from "@/lib/intelligence/scope";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cost model — Steady Intelligence" };

// Payer cost model (p69, chart p83; §26's evidence screen, cost view).
//
// The contract row on p69 is a prohibition rather than a requirement: "Never
// label estimated value as observed savings." Everything here follows from it.
//
//   - Only an APPROVED model version renders. A draft shown beside an approved
//     one, in the same shape, is how a working estimate leaves the building as
//     a finding.
//   - The RANGE is the mark and the point estimate is a tick inside it. A
//     point drawn as the value is how "$8" travels without "$5 to $13".
//   - The assumptions are on the screen, not behind a link. An estimate whose
//     assumptions take a click to reach is an estimate that will be quoted
//     without them.
//   - Superseded versions stay listed, so an older report can be reproduced.

export default async function PayerCostModelPage() {
  const tenantId = await resolvePayerTenant();
  const envelope = tenantId ? await buildCostModel(tenantId) : null;

  return (
    <PayerPage
      layer="evidence"
      here="/payer/evidence"
      title="Cost model"
      lede="A modelled range, not observed savings. Nothing on this screen is a measurement."
    >
      {!envelope ? (
        <Panel title="No plan in scope">
          <p className="measure text-ground/90">This account is not bound to exactly one contracted plan.</p>
        </Panel>
      ) : (
        <EnvelopeView envelope={envelope} title="Cost model" audience="operations">
          {(m) => (
            <div className="space-y-6">
              <WithNote
                note={
                  <Note
                    tone="support"
                    title="Model boundary"
                    owner="Actuarial review — approval is theirs, not analytics'"
                    boundary="Never quote a value from this screen as observed savings. These are estimates under stated assumptions, and observed claims replace them as they arrive."
                  >
                    <p>
                      Version <span className="font-mono text-xs">{m.modelVersion}</span>,
                      approved{m.approvedBy ? ` by ${m.approvedBy}` : ""}
                      {m.approvedAt ? ` on ${m.approvedAt.slice(0, 10)}` : ""}.
                    </p>
                  </Note>
                }
              >
                <Panel>
                  <Figure
                    title="Estimated cost range"
                    summary={`Three modelled scenarios, each a range in PMPM with a mid estimate. Estimates, not observed values.`}
                    footnote="Modelled PMPM. Not observed savings. Ranges are the estimate; the tick is the midpoint, not a measurement."
                  >
                    <IntervalChart
                      intervals={m.scenarios.map((s) => ({
                        label: s.scenario, low: s.low, point: s.point, high: s.high,
                      }))}
                      unit="PMPM (per member per month)"
                      prefix="$"
                    />
                  </Figure>
                </Panel>
              </WithNote>

              <Panel
                title="Assumptions this model rests on"
                footnote="On the screen rather than behind a link: an estimate whose assumptions take a click to reach is one that will be quoted without them."
              >
                <ul className="space-y-2">
                  {m.assumptions.map((a) => (
                    <li key={a} className="measure text-sm text-ground">{a}</li>
                  ))}
                </ul>
              </Panel>

              {m.supersededVersions.length > 0 && (
                <Panel title="Superseded versions">
                  <p className="measure text-sm text-ground">
                    {m.supersededVersions.map((v) => (
                      <span key={v} className="mr-2 font-mono text-xs">{v}</span>
                    ))}
                  </p>
                  <p className="measure mt-2 text-sm text-olive">
                    Kept readable rather than deleted. A report published under an earlier
                    model has to remain reproducible, and an estimate that quietly changes
                    underneath a published figure is worse than one that changed openly.
                  </p>
                </Panel>
              )}
            </div>
          )}
        </EnvelopeView>
      )}
    </PayerPage>
  );
}
