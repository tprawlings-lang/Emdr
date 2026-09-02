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
// THIS SCREEN SPENT ITS WHOLE LIFE IN §30.8's PARTIAL STATE, and that was the
// honest answer rather than a shortfall: demand was countable — people with a
// scheduled visit and no care start — and supply was not, because no calendar,
// slot record or clinician availability existed anywhere in this deployment.
// The temptation was to draw the demand bars alone and title the screen
// "Capacity", leaving a reader to take the ratio the title promises from a
// chart that has half of it.
//
// `capacity_slots` is now seeded as a fabricated stand-in for the scheduling
// integration, so the ratio is computable and the screen is ready rather than
// partial. Two things carry over from the years it was honest about not
// knowing. The partial branch is still there for any tenant whose feed is not
// wired up. And the FEED AGE travels with the numbers: a total assembled from
// a site whose feed froze months ago is wrong in a way nobody can see, so the
// age of the slowest site is on the screen beside the ratio it produced.

export default async function OrgCapacityPage() {
  const tenantId = await resolveOrgTenant();
  const envelope = tenantId ? await buildOrgCapacity(tenantId) : null;

  return (
    <OrgPage
      layer="actions"
      here="/organization/capacity"
      title="Capacity"
      lede="Demand for a first visit against open slots, by site — and how old the slot feed is."
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
                  tone={c.feedAgeDays > 7 ? "caution" : "info"}
                  title={c.feedAgeDays > 7 ? "The slot feed is stale" : "Demand against slots"}
                  owner="Network operations"
                  boundary="A ratio above one means demand outran the slots that were open. It does not say why, and it is not a forecast: a site can be over on a ratio and fine in practice if its slots turn over faster than this period assumes."
                >
                  <p>
                    Demand is people with a scheduled visit and no recorded care start. Supply is
                    open first-visit slots from the scheduling feed, which is{" "}
                    <strong>{c.feedAgeDays} day{c.feedAgeDays === 1 ? "" : "s"} old</strong> at its
                    slowest site.
                    {c.feedAgeDays > 7 && " Past a week, this is a reading about the past rather than about now."}
                  </p>
                </Note>
              }
            >
              <div className="space-y-4">
                <Panel>
                  <Figure
                    title="Demand against open slots, by site"
                    summary="People waiting for a first visit, over the open first-visit slots in the period."
                    footnote={`A ratio above 1.0 means demand outran supply. Slot feed age at its slowest site: ${c.feedAgeDays} days.`}
                  >
                    {c.ratio.length === 0 ? (
                      <p className="measure text-sm text-ground/90">
                        No site has both a demand count and a slot feed, so no ratio can be drawn.
                      </p>
                    ) : (
                      <BarList bars={c.ratio} unit="× capacity" />
                    )}
                  </Figure>
                </Panel>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Panel>
                    <Figure
                      title="Waiting for a first visit, by site"
                      summary="People with a scheduled visit and no recorded care start."
                      footnote="Observed demand. Not a forecast."
                    >
                      <BarList bars={c.demand} unit="waiting" />
                    </Figure>
                  </Panel>
                  <Panel>
                    <Figure
                      title="Open first-visit slots, by site"
                      summary="Slots the scheduling feed reports as open in the period."
                      footnote="Observed supply, from the scheduling feed. Not a forecast."
                    >
                      <BarList bars={c.supply} unit="slots" />
                    </Figure>
                  </Panel>
                </div>
              </div>
            </WithNote>
          )}
        </EnvelopeView>
      )}
    </OrgPage>
  );
}
