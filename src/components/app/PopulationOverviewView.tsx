import { Panel, Note, WithNote, SummaryCards } from "@/components/app/surfaces";
import { Figure, BarList, pct } from "@/components/charts/aggregate";
import type { PopulationOverview } from "@/lib/intelligence/population";
import type { ProjectionMeta } from "@/lib/presentation/envelope";

// The population overview, shared by the organization and payer consoles
// (handoff 07 §4.2, p41).
//
// ONE component for two roles, because p41 gives them one contract. The
// questions differ — an organization asks "are people reached, where are the
// service gaps"; a payer asks "who is reached, how does access vary" — and the
// shared contract is the answer to both: cohort, n/N, conversion stages,
// region and language views, retention and paired results, observed
// utilisation kept separate from modelled cost.
//
// Two consoles reading two components would drift, and a difference between
// the organization's number and the payer's is indistinguishable from a bug in
// either. They read the same projection over the same ledger.

export function PopulationOverviewView({
  data, meta, audience,
}: {
  data: PopulationOverview;
  meta: ProjectionMeta;
  audience: "organization" | "payer";
}) {
  const missedPct = data.missedMeasures.of > 0
    ? Math.round((data.missedMeasures.n / data.missedMeasures.of) * 100) : 0;

  return (
    <div className="space-y-6">
      <SummaryCards
        cards={[
          {
            label: "Covered",
            value: data.covered.toLocaleString(),
            detail: `${data.byRegion.length} regions · ${data.window}`,
          },
          {
            label: "Measured twice",
            value: pct(data.measuredTwice),
            detail: "A change needs two readings; one is a baseline.",
          },
          {
            label: "Measures missed",
            value: `${missedPct}%`,
            detail: `${data.missedMeasures.n.toLocaleString()} of ${data.missedMeasures.of.toLocaleString()} that came due`,
          },
        ]}
      />

      <WithNote
        note={
          <Note
            title="What this does not say"
            boundary="These are observed counts over a fabricated cohort in a fixed window. Nothing here is a treatment effect: nobody was randomised, the people who engaged chose to, and a difference between groups may be who they are rather than what they received."
            owner="Clinical review"
            due="Before any figure here is quoted outside the demo"
          >
            <p>
              Improvement is counted as a later measure lower than the first, among people with
              at least two. It is not a responder rate and not a clinical threshold — handoff 07
              p36 puts a configured threshold at the &ldquo;descriptive&rdquo; rung of the release
              ladder, where the permitted wording is <em>observed among this cohort</em>.
            </p>
          </Note>
        }
      >
        <Panel
          title="Observed change"
          footnote={`Window: ${data.window}. Projection ${meta.schemaVersion} · dataset ${meta.projectionVersion} · newest event ${meta.sourceWatermark ?? "none"} · generated ${meta.generatedAt}.`}
        >
          <p className="measure text-sm text-ground">
            {pct(data.improved)} of people with two or more measures had a lower later reading.
            The denominator is people who could be compared, not everyone covered — a rate
            against the whole population would report a measurement gap as an outcome.
          </p>
          <p className="measure mt-3 text-sm text-olive">
            {pct(data.active)} completed at least one check-in.
          </p>
        </Panel>
      </WithNote>

      <Panel
        title="Why a measure was not completed"
        footnote="Recorded at the time, with a reason, rather than inferred from an absence later. A value that was declined and one that was never due are different facts, and only one of them is about the person."
      >
        {data.missedByReason.length === 0 ? (
          <p className="measure text-sm text-ground">
            Nothing came due and went uncompleted in this window. That is an empty result, not a
            failure to load.
          </p>
        ) : (
          <Figure
            title="Missed measures by reason"
            summary={`${data.missedMeasures.n} measures came due and were not completed, out of ${data.missedMeasures.of}. The most common reason is ${data.missedByReason[0].reason.replace(/_/g, " ")}.`}
            footnote={`Denominator ${data.missedMeasures.of.toLocaleString()} — every measure that came due in the window. ${data.window}.`}
          >
            <BarList
              bars={data.missedByReason.map((r) => ({
                label: r.reason.replace(/_/g, " "),
                value: r.n,
                // The denominator travels with every bar. §29.1: never a
                // proportion without the numerator and denominator in view.
                detail: `of ${data.missedMeasures.n.toLocaleString()} missed`,
              }))}
            />
          </Figure>
        )}
      </Panel>

      <Panel
        title="By region"
        footnote="U.S. Census regions — a reporting dimension, not an estimate of clinical need. A group smaller than the small-cell threshold is withheld whole rather than reported as a suppressed numerator over a tiny denominator."
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ground/10 text-left text-xs text-olive">
              <th className="pb-2 font-medium">Region</th>
              <th className="pb-2 font-medium">Covered</th>
              <th className="pb-2 font-medium">Checked in</th>
              <th className="pb-2 font-medium">Measured twice</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ground/5">
            {data.byRegion.map((r) => (
              <tr key={r.label}>
                <td className="py-2.5 text-app-ink">{r.label}</td>
                <td className="py-2.5 text-ground">{r.covered.toLocaleString()}</td>
                <td className="py-2.5 text-ground">{r.active}</td>
                <td className="py-2.5 text-ground">{r.measured}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title={audience === "payer" ? "What a payer cannot reach from here" : "What an organization cannot reach from here"}>
        <p className="measure text-sm text-ground">
          {audience === "payer"
            ? "No patient-level clinical record and no person search. This projection is refused at build time if it carries a person identifier — it does not render with the identifier hidden, it does not render."
            : "No payer-wide data and no other organization. This projection is refused at build time if it carries a person identifier — it does not render with the identifier hidden, it does not render."}
        </p>
      </Panel>
    </div>
  );
}
