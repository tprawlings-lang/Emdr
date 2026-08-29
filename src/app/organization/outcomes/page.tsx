import { OrgPage } from "@/components/app/OrgPage";
import { EnvelopeView } from "@/components/presentation/EnvelopeView";
import { Note, Panel, WithNote } from "@/components/app/surfaces";
import { Figure, StackedAllocation, num } from "@/components/charts/aggregate";
import { buildOrgOutcomes } from "@/lib/intelligence/organization";
import { resolveOrgTenant } from "@/lib/intelligence/scope";

export const dynamic = "force-dynamic";
export const metadata = { title: "Outcomes — Steady Intelligence" };

// Outcomes (§26: "See observed cohort patterns — coverage, change,
// missingness — open cohort").
//
// One bar, four slices, and the fourth is missing follow-up. That is the whole
// design argument: dropping unmeasured people from the denominator turns "62%
// of those we measured improved" into "62% improved", and §31.6 blocks a
// release for "any clean chart hiding incomplete data". The missing slice is
// the same size it really is, in the same bar, on the same scale.

export default async function OrgOutcomesPage() {
  const tenantId = await resolveOrgTenant();
  const envelope = tenantId ? await buildOrgOutcomes(tenantId) : null;

  return (
    <OrgPage
      layer="progress"
      here="/organization/outcomes"
      title="Outcomes"
      lede="Observed status across everyone who started care — including the people nobody measured again."
    >
      {!envelope ? (
        <Panel title="No organization in scope">
          <p className="measure text-ground/90">This account is not bound to exactly one organization.</p>
        </Panel>
      ) : (
        <EnvelopeView envelope={envelope} title="Outcomes" audience="operations">
          {(o) => (
            <WithNote
              note={
                <Note
                  tone="info"
                  title="Boundary"
                  boundary="An observed cohort pattern. No causal claim: nothing here establishes that care produced the change, and missing follow-up stays in the denominator."
                >
                  <p>
                    Status is what was recorded at the end of the window, not a prediction and
                    not a score. {num(o.slices[3].n)} people who started care have no recorded
                    follow-up and are counted as missing rather than excluded.
                  </p>
                </Note>
              }
            >
              <Panel>
                <Figure
                  title="Outcome status with missing follow-up visible"
                  summary={`Four observed statuses across ${num(o.total)} people who started care, including missing follow-up.`}
                  footnote={`Denominator ${num(o.total)} — everyone who started care. Missing follow-up remains in the total.`}
                >
                  <StackedAllocation slices={o.slices} total={o.total} />
                </Figure>
              </Panel>
            </WithNote>
          )}
        </EnvelopeView>
      )}
    </OrgPage>
  );
}
