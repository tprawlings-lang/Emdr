import Link from "next/link";
import { PayerPage } from "@/components/app/PayerPage";
import { EnvelopeView } from "@/components/presentation/EnvelopeView";
import { Note, Panel, WithNote } from "@/components/app/surfaces";
import { Figure, Funnel, num } from "@/components/charts/aggregate";
import { buildPayerPathway } from "@/lib/intelligence/payer";
import { resolvePayerTenant } from "@/lib/intelligence/scope";

export const dynamic = "force-dynamic";
export const metadata = { title: "Population overview — Steady Intelligence" };

// Population overview (§26: "See reach, outcome and utilization — observed
// summary — Open methods").
//
// "Observed summary" is the whole instruction. Everything on this screen is
// counted from claims and events; the modelled figures live on their own
// screen, in their own visual register, behind their own approval. §29.1
// requires observed and modelled to use separate surfaces, and this is the
// surface a plan executive is most likely to read alone.

export default async function PayerOverviewPage() {
  const tenantId = await resolvePayerTenant();
  const envelope = tenantId ? await buildPayerPathway(tenantId) : null;

  return (
    <PayerPage
      layer="overview"
      here="/payer/overview"
      title="Population overview"
      lede="Reach across the contracted population, counted from the record. Observed only — modelled cost lives on its own screen."
    >
      {!envelope ? (
        <Panel title="No plan in scope">
          <p className="measure text-ground/90">This account is not bound to exactly one contracted plan.</p>
        </Panel>
      ) : (
        <EnvelopeView envelope={envelope} title="Population overview" audience="operations">
          {(p) => (
            <WithNote
              note={
                <Note
                  tone="info"
                  title="Interpretation"
                  owner="Plan analytics"
                  boundary="Observed results are separate from modelled estimates, and nothing here is a savings figure. Cohort version and claims lag travel with every number."
                >
                  <p>
                    Every stage is counted against the {num(p.stages[0].count.of)} eligible
                    members, so the last bar is the share of the plan that reached care.
                  </p>
                  <p className="mt-2">
                    <Link href="/payer/evidence/cost" className="text-state-info underline">
                      Modelled cost
                    </Link>{" "}
                    is a separate screen for a reason.
                  </p>
                </Note>
              }
            >
              <Panel>
                <Figure
                  title="Eligibility to active use"
                  summary={`Four stages from eligible to started care, each counted against ${num(p.stages[0].count.of)} eligible members.`}
                  footnote={`Denominator ${num(p.stages[0].count.of)} eligible members. Distinct people, not events.${
                    p.medianTimeToCareDays !== null
                      ? ` Median ${p.medianTimeToCareDays} days from referral to care start.`
                      : ""
                  }`}
                >
                  <Funnel stages={p.stages} />
                </Figure>
              </Panel>
            </WithNote>
          )}
        </EnvelopeView>
      )}
    </PayerPage>
  );
}
