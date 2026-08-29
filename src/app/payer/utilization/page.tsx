import { PayerPage } from "@/components/app/PayerPage";
import { EnvelopeView } from "@/components/presentation/EnvelopeView";
import { Note, Panel, WithNote } from "@/components/app/surfaces";
import { Figure, Line, num } from "@/components/charts/aggregate";
import { buildPayerUtilization } from "@/lib/intelligence/payer";
import { resolvePayerTenant } from "@/lib/intelligence/scope";

export const dynamic = "force-dynamic";
export const metadata = { title: "Utilisation — Steady Intelligence" };

// Utilisation (§26: "Review claims-based use — per-1,000 trend and lag — open
// claims method"; chart p82).
//
// The most dangerous chart in the product, and the danger is not the maths.
//
// A claim is incurred on one date and arrives sixty-odd days later. Count only
// what has arrived and the last three months fall off a cliff — every time,
// for every payer, for every measure. That fall looks exactly like the
// programme working, and it is the shape someone screenshots for a board pack.
//
// So months below the completeness floor report NO VALUE. The line breaks, the
// months are named as incomplete, and the envelope renders `partial` above the
// chart rather than beneath it. A short chart that a reader has to ask about
// is the correct outcome here.

export default async function PayerUtilizationPage() {
  const tenantId = await resolvePayerTenant();
  const envelope = tenantId ? await buildPayerUtilization(tenantId) : null;

  return (
    <PayerPage
      layer="overview"
      here="/payer/utilization"
      title="Utilisation"
      lede="Acute behavioural use per 1,000 eligible members. Months whose claims have not arrived report nothing rather than reporting low."
    >
      {!envelope ? (
        <Panel title="No plan in scope">
          <p className="measure text-ground/90">This account is not bound to exactly one contracted plan.</p>
        </Panel>
      ) : (
        <EnvelopeView envelope={envelope} title="Utilisation" audience="operations">
          {(u) => (
            <WithNote
              note={
                <Note
                  tone="info"
                  title="Reading this"
                  owner="Plan analytics — the claims feed is theirs"
                  boundary="Observed events, not a savings claim. Nothing here says the programme caused a change, and no month with incomplete claims contributes a value."
                >
                  <p>
                    Rates are per 1,000 of {num(u.eligible)} eligible members.{" "}
                    {u.incompleteMonths.length > 0
                      ? `${u.incompleteMonths.length} recent month(s) are withheld: their claims have not arrived, and a partial month drawn as a value falls.`
                      : "Every month in the window has enough claims received to report."}
                  </p>
                </Note>
              }
            >
              <Panel>
                <Figure
                  title="Acute behavioural utilisation"
                  summary={`ED visits and inpatient admissions per 1,000 of ${num(u.eligible)} eligible members, by month of service.`}
                  footnote={`Per 1,000 eligible members, by month INCURRED, not received. Contract expects a ${u.expectedLagDays}-day claims lag. Months below 85% of claims received report no value and the line breaks.`}
                >
                  <Line
                    unit="per 1,000"
                    series={[
                      {
                        name: "ED visits per 1,000",
                        observed: true,
                        points: u.months.map((m) => ({ x: m.month.slice(5), y: m.edPer1000 })),
                      },
                      {
                        name: "Inpatient admissions per 1,000",
                        observed: true,
                        points: u.months.map((m) => ({ x: m.month.slice(5), y: m.inpatientPer1000 })),
                      },
                    ]}
                  />
                </Figure>
              </Panel>
            </WithNote>
          )}
        </EnvelopeView>
      )}
    </PayerPage>
  );
}
