import { OrgPage } from "@/components/app/OrgPage";
import { EnvelopeView } from "@/components/presentation/EnvelopeView";
import { Note, Panel, WithNote } from "@/components/app/surfaces";
import { Figure, Line, num, pct } from "@/components/charts/aggregate";
import { buildOrgSafetyOps } from "@/lib/intelligence/organization";
import { resolveOrgTenant } from "@/lib/intelligence/scope";

export const dynamic = "force-dynamic";
export const metadata = { title: "Safety operations — Steady Intelligence" };

// Safety operations (§26: "Monitor response workflow — gate volume and
// response time — open action").
//
// §29.1 forbids turning a safety surface into a predictive risk score, and
// this is the screen where that would be easiest to do and hardest to notice:
// gate volume by site, divided by population, sorted descending, reads as a
// risk ranking within about a second of someone looking at it.
//
// So this screen counts two things and nothing else — how often a FIXED rule
// fired, and how often a human responded. There is no rate per site, no
// ranking and no trendline fitted through the volume, because each of those is
// a claim about who is likely to be unsafe rather than a record of what
// happened.

export default async function OrgSafetyPage() {
  const tenantId = await resolveOrgTenant();
  const envelope = tenantId ? await buildOrgSafetyOps(tenantId) : null;

  return (
    <OrgPage
      layer="overview"
      here="/organization/safety"
      title="Safety operations"
      lede="How often the fixed gates fired, and whether a person responded. Volume and response — never a risk score."
    >
      {!envelope ? (
        <Panel title="No organization in scope">
          <p className="measure text-ground/90">This account is not bound to exactly one organization.</p>
        </Panel>
      ) : (
        <EnvelopeView envelope={envelope} title="Safety operations" audience="operations">
          {(s) => (
            <div className="space-y-6">
              <WithNote
                note={
                  <Note
                    tone="support"
                    title="What this is not"
                    owner="Clinical safety — gate response is a clinician action, not an operations one"
                    boundary="Not a risk score, not a ranking, and not evidence about any site or person. A gate firing records that a fixed rule matched an answer."
                  >
                    <p>
                      Volume is deliberately not divided by site population here. A rate per
                      site sorted descending is a risk ranking whatever it is labelled.
                    </p>
                  </Note>
                }
              >
                <Panel>
                  <p className="mb-4 text-sm text-ground">
                    {num(s.triggered)} people met a fixed gate. A human response is recorded
                    for {pct(s.responded)}. No model makes, clears or reverses a gate.
                  </p>
                  <Figure
                    title="Gate volume by month"
                    summary="Count of fixed safety-gate events per month, last six months."
                    footnote="Counts of rule matches, not people at risk. A month with fewer than 11 events reports no value and the line breaks."
                  >
                    <Line unit="events" series={[{ name: "Gates fired", points: s.byMonth, observed: true }]} />
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
