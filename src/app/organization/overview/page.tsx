import { OrgPage } from "@/components/app/OrgPage";
import { EnvelopeView } from "@/components/presentation/EnvelopeView";
import { Callout, Note, Panel, SummaryCards, WithNote } from "@/components/app/surfaces";
import { Figure, Funnel, num, pct } from "@/components/charts/aggregate";
import { buildOrgOverview } from "@/lib/intelligence/organization";
import { resolveOrgTenant } from "@/lib/intelligence/scope";

export const dynamic = "force-dynamic";
export const metadata = { title: "Operating overview — Steady Intelligence" };

// Operating overview (§26: "See network change and action — aggregate summary
// and queue — review location").
//
// The three cards are the network's current state in three numbers, and each
// carries its denominator because §29.1 does not allow otherwise. The funnel
// underneath is the same access pathway /organization/access opens in full;
// it is here because "where does the network lose people" is the first
// question this screen exists to answer, not a drill-down.

export default async function OrgOverviewPage() {
  const tenantId = await resolveOrgTenant();
  const envelope = tenantId
    ? await buildOrgOverview(tenantId)
    : null;

  return (
    <OrgPage
      layer="overview"
      here="/organization/overview"
      title="Operating overview"
      lede="The network as it stands, counted from the record rather than reported into a spreadsheet."
    >
      {!envelope ? (
        <Panel title="No organization in scope">
          <p className="measure text-ground/90">
            This account is not bound to exactly one organization, so there is nothing to
            report on. Scoped access is granted through a review request, which is not built
            in this deployment.
          </p>
        </Panel>
      ) : (
        <EnvelopeView envelope={envelope} title="Operating overview" audience="operations">
          {(o) => (
            <div className="space-y-6">
              {o.changed && <Callout label="What changed">{o.changed}</Callout>}

              <SummaryCards
                cards={[
                  {
                    label: "First contact",
                    value: o.firstContactDays === null ? "Not enough contacts" : `${o.firstContactDays} days`,
                    detail: "median, referral to first contact",
                  },
                  {
                    label: "Started care",
                    value: pct(o.engaged),
                    detail: "of covered lives",
                  },
                  {
                    label: "Measure coverage",
                    value: pct(o.measureCoverage),
                    detail: "of people who started care",
                  },
                ]}
              />

              <WithNote
                note={
                  <Note
                    tone="caution"
                    title="Read this first"
                    boundary="A funnel shows where people stop appearing, not why. None of these stages establishes a cause, and no stage is evidence about any individual."
                  >
                    <p>
                      Every stage is counted against the same denominator — the{" "}
                      {num(o.funnel[0].count.of)} people referred — so the last bar is the
                      share of referrals that reached care, not the share of the step before
                      it.
                    </p>
                  </Note>
                }
              >
                <Panel>
                  <Figure
                    title="Referral to care start"
                    summary={`Access pathway for ${num(o.population)} covered lives, five stages, each against ${num(o.funnel[0].count.of)} referrals.`}
                    footnote={`All referrals on record. Denominator ${num(o.funnel[0].count.of)}. Counts are distinct people, not events.`}
                  >
                    <Funnel stages={o.funnel} />
                  </Figure>
                </Panel>
              </WithNote>
            </div>
          )}
        </EnvelopeView>
      )}
    </OrgPage>
  );
}
