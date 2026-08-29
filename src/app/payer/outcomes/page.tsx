import { PayerPage } from "@/components/app/PayerPage";
import { EnvelopeView } from "@/components/presentation/EnvelopeView";
import { Note, Panel, WithNote } from "@/components/app/surfaces";
import { Figure, StackedAllocation, num } from "@/components/charts/aggregate";
import { buildPayerPathway } from "@/lib/intelligence/payer";
import { resolvePayerTenant } from "@/lib/intelligence/scope";

export const dynamic = "force-dynamic";
export const metadata = { title: "Outcomes — Steady Intelligence" };

// Outcomes (§26: "Review observed cohort change — coverage and missingness —
// Open rules").
//
// "Coverage and missingness" comes before "change" in that sentence, and the
// ordering is the instruction. A cohort outcome figure is only as good as the
// share of the cohort it was measured on, so this screen reports how many
// people have a recorded outcome at all BEFORE it reports anything about what
// those outcomes were. Missing follow-up stays in the denominator.

export default async function PayerOutcomesPage() {
  const tenantId = await resolvePayerTenant();
  const envelope = tenantId ? await buildPayerPathway(tenantId) : null;

  return (
    <PayerPage
      layer="progress"
      here="/payer/outcomes"
      title="Outcomes"
      lede="How much of the cohort was measured at all, before anything about what the measurements said."
    >
      {!envelope ? (
        <Panel title="No plan in scope">
          <p className="measure text-ground/90">This account is not bound to exactly one contracted plan.</p>
        </Panel>
      ) : (
        <EnvelopeView envelope={envelope} title="Outcomes" audience="operations">
          {(p) => (
            <WithNote
              note={
                <Note
                  tone="info"
                  title="Boundary"
                  owner="Plan analytics, with clinical quality for the definitions"
                  boundary="An observed cohort pattern with no causal claim. Nothing here establishes that the programme produced a change, and unmeasured people stay in the denominator."
                >
                  <p>
                    Coverage first: {num(p.outcomes[0].n)} of {num(p.outcomeTotal)} people who
                    started care have a recorded outcome. A change statistic computed on the
                    measured share alone would describe a different population.
                  </p>
                </Note>
              }
            >
              <Panel>
                <Figure
                  title="Outcome coverage across the cohort"
                  summary={`Recorded and unrecorded outcomes across ${num(p.outcomeTotal)} people who started care.`}
                  footnote={`Denominator ${num(p.outcomeTotal)} — everyone who started care. People with no recorded outcome remain in the total rather than being excluded.`}
                >
                  <StackedAllocation slices={p.outcomes} total={p.outcomeTotal} />
                </Figure>
              </Panel>
            </WithNote>
          )}
        </EnvelopeView>
      )}
    </PayerPage>
  );
}
