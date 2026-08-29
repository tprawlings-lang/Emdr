import { OrgPage } from "@/components/app/OrgPage";
import { EnvelopeView } from "@/components/presentation/EnvelopeView";
import { Note, Panel, WithNote } from "@/components/app/surfaces";
import { Figure, BarList } from "@/components/charts/aggregate";
import { buildOrgCapacity } from "@/lib/intelligence/organization";
import { resolveOrgTenant } from "@/lib/intelligence/scope";

export const dynamic = "force-dynamic";
export const metadata = { title: "Capacity — Steady Intelligence" };

// Capacity (§26: "Balance demand and slots — location comparison —
// rebalance").
//
// This screen renders in §30.8's PARTIAL state, and that is the honest answer
// rather than a shortfall. Demand is countable: people with a scheduled visit
// and no care start yet. Supply is not — there is no calendar, no slot record
// and no clinician availability anywhere in this deployment.
//
// The temptation is to draw the demand bars alone and title the screen
// "Capacity". A reader would take the ratio the title promises from a chart
// that only has half of it. So the missing source is named by the envelope,
// above the chart, every time — "do not calculate a clean total from
// incomplete inputs."

export default async function OrgCapacityPage() {
  const tenantId = await resolveOrgTenant();
  const envelope = tenantId ? await buildOrgCapacity(tenantId) : null;

  return (
    <OrgPage
      layer="actions"
      here="/organization/capacity"
      title="Capacity"
      lede="Demand for a first visit, by site. The supply side needs a scheduling feed this deployment does not have."
    >
      {!envelope ? (
        <Panel title="No organization in scope">
          <p className="measure text-ground/90">This account is not bound to exactly one organization.</p>
        </Panel>
      ) : (
        <EnvelopeView envelope={envelope} title="Capacity" audience="operations">
          {(c) => (
            <WithNote
              note={
                <Note
                  tone="caution"
                  title="Half a ratio"
                  boundary="Demand alone cannot say whether a site is over or under capacity. Rebalancing on this chart would be acting on a number that has no denominator."
                >
                  <p>
                    These are people with a scheduled visit and no recorded care start. The
                    open-slot count that would make it a ratio does not exist as data.
                  </p>
                </Note>
              }
            >
              <Panel>
                <Figure
                  title="Waiting for a first visit, by site"
                  summary="People with a scheduled visit and no care start yet, per location."
                  footnote="Observed demand only. No forecast, and no supply figure — see the missing source above."
                >
                  <BarList bars={c.demand} unit="waiting" />
                </Figure>
              </Panel>
            </WithNote>
          )}
        </EnvelopeView>
      )}
    </OrgPage>
  );
}
