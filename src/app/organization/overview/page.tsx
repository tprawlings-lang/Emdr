import { OrgPage } from "@/components/app/OrgPage";
import { EnvelopeView } from "@/components/presentation/EnvelopeView";
import { Note, Panel, WithNote } from "@/components/app/surfaces";
import { Figure, Funnel, num } from "@/components/charts/aggregate";
import { buildOrgOverview } from "@/lib/intelligence/organization";
import { resolveOrgTenant } from "@/lib/intelligence/scope";

export const dynamic = "force-dynamic";
export const metadata = { title: "Operating overview — Steady Intelligence" };

// Operating overview (§26: "See network change and accountable action —
// aggregate summary and queue — review location").
//
// The three summary cards are NOT here. They are the shell's standing header,
// because every organization page example carries the same three and a header
// each screen opts into is a header two screens forget.
//
// What changed sits in the side card rather than in a banner across the top.
// That is where the page example puts it, and it is the better place for a
// reason the example does not state: the finding and the funnel it came from
// are then readable side by side, and the card has room for the part a banner
// does not — who is accountable, and by when.

export default async function OrgOverviewPage() {
  const tenantId = await resolveOrgTenant();
  const envelope = tenantId ? await buildOrgOverview(tenantId) : null;

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
            <WithNote
              note={
                o.changed ? (
                  <Note
                    tone="support"
                    title="What changed"
                    owner="Not assigned — no owner record exists for a network finding"
                    boundary="A difference between sites is not a cause. Case mix, referral source and staffing all differ, and none of them is in this comparison."
                  >
                    <p>{o.changed}</p>
                  </Note>
                ) : (
                  <Note
                    tone="safe"
                    title="What changed"
                    boundary="Nothing moved enough to name. That is a finding rather than the absence of one."
                  >
                    <p>
                      No site is more than two points off the network&apos;s contact rate this
                      period.
                    </p>
                  </Note>
                )
              }
            >
              <Panel>
                <Figure
                  title="Access pathway"
                  summary={`Five access stages for ${num(o.population)} covered lives, each counted against ${num(o.funnel[0].count.of)} referrals.`}
                  footnote={`Referral to contact to scheduled to started. Denominator ${num(o.funnel[0].count.of)}. Distinct people, not events.`}
                >
                  <Funnel stages={o.funnel} />
                </Figure>
              </Panel>
            </WithNote>
          )}
        </EnvelopeView>
      )}
    </OrgPage>
  );
}
