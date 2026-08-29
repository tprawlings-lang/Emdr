import { OrgPage } from "@/components/app/OrgPage";
import { EnvelopeView } from "@/components/presentation/EnvelopeView";
import { Note, Panel, SummaryCards, WithNote } from "@/components/app/surfaces";
import { Figure, num, pct } from "@/components/charts/aggregate";
import { buildOrgCareDelivery } from "@/lib/intelligence/organization";
import { resolveOrgTenant } from "@/lib/intelligence/scope";

export const dynamic = "force-dynamic";
export const metadata = { title: "Care delivery — Steady Intelligence" };

// Care delivery (§26: "Track continuity and handoffs — completion and review
// coverage — open workflow").
//
// Handoffs are absent here for the same reason /clinician/handoffs is empty:
// transfer of accountability is not recorded as its own event, so continuity
// across a handoff cannot be measured. Ownership on a work item is not the
// same fact, and inferring one from the other is how people get lost between
// clinicians. What IS measurable is delivery and review coverage, and that is
// what this screen limits itself to.

export default async function OrgCareDeliveryPage() {
  const tenantId = await resolveOrgTenant();
  const envelope = tenantId ? await buildOrgCareDelivery(tenantId) : null;

  return (
    <OrgPage
      layer="progress"
      here="/organization/care-delivery"
      title="Care delivery"
      lede="What was delivered to the people who started care, and how much of it a human has looked at."
    >
      {!envelope ? (
        <Panel title="No organization in scope">
          <p className="measure text-ground/90">This account is not bound to exactly one organization.</p>
        </Panel>
      ) : (
        <EnvelopeView envelope={envelope} title="Care delivery" audience="operations">
          {(d) => (
            <div className="space-y-6">
              <SummaryCards
                cards={[
                  { label: "Started care", value: num(d.started), detail: "distinct people" },
                  { label: "Sessions delivered", value: num(d.sessions), detail: `${(d.sessions / Math.max(1, d.started)).toFixed(1)} per person` },
                  { label: "Clinician review", value: pct(d.reviewed), detail: "of people who started care" },
                ]}
              />

              <WithNote
                note={
                  <Note
                    tone="info"
                    title="Not measured here"
                    boundary="Continuity across a handoff is not measured. Accountability transfer is not recorded as an event, and ownership on a work item is a different fact."
                  >
                    <p>
                      Review coverage counts people with at least one recorded clinician
                      review. It does not say the review was timely, or that what was
                      reviewed was the thing that mattered.
                    </p>
                  </Note>
                }
              >
                <Panel>
                  <Figure
                    title="Coverage against people who started care"
                    summary={`Review and measurement coverage across ${num(d.started)} people who started care.`}
                    footnote={`Denominator ${num(d.started)} — everyone who started care. Distinct people, not events.`}
                  >
                    <ul className="space-y-2.5">
                      {[
                        { label: "Seen by a clinician at least once", c: d.reviewed },
                        { label: "Has at least one validated measure", c: d.measured },
                      ].map((r) => (
                        <li key={r.label} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ground/5 pb-2 text-sm last:border-0">
                          <span className="text-ground">{r.label}</span>
                          <span className="font-medium text-ground">{pct(r.c)}</span>
                        </li>
                      ))}
                    </ul>
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
