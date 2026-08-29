import { PayerPage } from "@/components/app/PayerPage";
import { EnvelopeView } from "@/components/presentation/EnvelopeView";
import { Note, Panel, WithNote } from "@/components/app/surfaces";
import { Figure, Funnel, num } from "@/components/charts/aggregate";
import { buildPayerPathway } from "@/lib/intelligence/payer";
import { resolvePayerTenant } from "@/lib/intelligence/scope";

export const dynamic = "force-dynamic";
export const metadata = { title: "Access — Steady Intelligence" };

// Access (§26: "Review time to care — wait, start, abandonment — Open action").
//
// Time to care is a median, not a mean: one member who started a year after
// referral moves a mean and tells a reader something false about the typical
// wait. Below the suppression threshold there is no median to report at all.

export default async function PayerAccessPage() {
  const tenantId = await resolvePayerTenant();
  const envelope = tenantId ? await buildPayerPathway(tenantId) : null;

  return (
    <PayerPage
      layer="actions"
      here="/payer/access"
      title="Access"
      lede="How long members wait, where they stop, and against which denominator."
    >
      {!envelope ? (
        <Panel title="No plan in scope">
          <p className="measure text-ground/90">This account is not bound to exactly one contracted plan.</p>
        </Panel>
      ) : (
        <EnvelopeView envelope={envelope} title="Access" audience="operations">
          {(p) => (
            <div className="space-y-6">
              <Panel title="Time from referral to care start">
                <p className="text-2xl text-app-ink">
                  {p.medianTimeToCareDays === null
                    ? "Not enough completed pathways"
                    : `${p.medianTimeToCareDays} days`}
                </p>
                <p className="measure mt-1 text-sm text-olive">
                  Median, not mean. One member who started a year after referral moves a mean
                  and says something false about the typical wait.
                </p>
              </Panel>

              <WithNote
                note={
                  <Note
                    tone="caution"
                    title="Where members stop"
                    owner="Plan network operations"
                    boundary="The marked stage is the largest drop in count. It is not the cause of the loss, and case mix, network adequacy and referral source are all absent from this comparison."
                  >
                    <p>
                      Each stage is counted against the {num(p.stages[0].count.of)} eligible
                      members rather than against the step before it.
                    </p>
                  </Note>
                }
              >
                <Panel>
                  <Figure
                    title="Eligibility to care start"
                    summary={`Four access stages, each counted against ${num(p.stages[0].count.of)} eligible members.`}
                    footnote={`Denominator ${num(p.stages[0].count.of)} eligible members. Distinct people, not events.`}
                  >
                    <Funnel stages={p.stages} />
                  </Figure>
                </Panel>
              </WithNote>
            </div>
          )}
        </EnvelopeView>
      )}
    </PayerPage>
  );
}
