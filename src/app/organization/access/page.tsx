import { OrgPage } from "@/components/app/OrgPage";
import { EnvelopeView } from "@/components/presentation/EnvelopeView";
import { Note, Panel, WithNote } from "@/components/app/surfaces";
import { Figure, Funnel, Line, BarList, cell, num } from "@/components/charts/aggregate";
import { buildOrgAccess } from "@/lib/intelligence/organization";
import { resolveOrgTenant } from "@/lib/intelligence/scope";

export const dynamic = "force-dynamic";
export const metadata = { title: "Access pipeline — Steady Intelligence" };

// Access pipeline (§26: "Find referral loss and wait — funnel and wait trend
// — open action list").
//
// The wait trend is the half that is easy to get wrong. A month with four
// completed contacts has a median, and it is meaningless and disclosive at
// once; the projection returns null for any month under the suppression
// threshold and the line BREAKS there rather than joining the two months
// either side. An interpolated gap is a claim about data that was never
// collected.

export default async function OrgAccessPage() {
  const tenantId = await resolveOrgTenant();
  const envelope = tenantId ? await buildOrgAccess(tenantId) : null;

  return (
    <OrgPage
      layer="actions"
      here="/organization/access"
      title="Access pipeline"
      lede="Where referrals stop, how long the first contact takes, and which sites carry the loss."
    >
      {!envelope ? (
        <Panel title="No organization in scope">
          <p className="measure text-ground/90">
            This account is not bound to exactly one organization, so there is nothing to
            report on.
          </p>
        </Panel>
      ) : (
        <EnvelopeView envelope={envelope} title="Access pipeline" audience="operations">
          {(a) => (
            <div className="space-y-6">
              <WithNote
                note={
                  <Note
                    tone="caution"
                    title="Where the loss is"
                    owner="Not assigned — no owner record exists for a network finding"
                    boundary="The marked stage is the largest drop in count. It is not the cause of the loss and not necessarily the stage to fix."
                  >
                    <p>
                      Each stage is measured against the {num(a.funnel[0].count.of)} referrals
                      received, so the bars are shares of the top of the pipeline throughout.
                    </p>
                  </Note>
                }
              >
                <Panel>
                  <Figure
                    title="Referral to care start"
                    summary={`Five access stages, each counted against ${num(a.funnel[0].count.of)} referrals.`}
                    footnote={`All referrals on record. Denominator ${num(a.funnel[0].count.of)}. Distinct people, not events.`}
                  >
                    <Funnel stages={a.funnel} />
                  </Figure>
                </Panel>
              </WithNote>

              <Panel>
                <Figure
                  title="Days from referral to first contact"
                  summary="Median days to first successful contact, by month of referral, last six months."
                  footnote="Median, not mean. A month with fewer than 11 completed contacts reports no value and the line breaks rather than bridging it."
                >
                  <Line
                    unit="days"
                    series={[{ name: "Median days to contact", points: a.waitTrend, observed: true }]}
                  />
                </Figure>
              </Panel>

              <Panel>
                <Figure
                  title="Contact rate by location"
                  summary="Share of referred people reached, per site."
                  footnote="Each site against its own referred population, so sites of different sizes are comparable."
                >
                  <ul className="space-y-2.5">
                    {a.byLocation.map((l) => (
                      <li
                        key={l.label}
                        className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ground/5 pb-2 text-sm last:border-0"
                      >
                        <span className="font-medium text-ground">{l.label}</span>
                        <span className="text-ground">{cell(l.count)}</span>
                      </li>
                    ))}
                  </ul>
                </Figure>
              </Panel>

              <Panel>
                <Figure
                  title="Referrals by location"
                  summary="Referral volume per site."
                  footnote="Counts of distinct people referred, all time on record."
                >
                  <BarList bars={a.byLocation.map((l) => ({ label: l.label, value: l.count.of }))} unit="referred" />
                </Figure>
              </Panel>
            </div>
          )}
        </EnvelopeView>
      )}
    </OrgPage>
  );
}
