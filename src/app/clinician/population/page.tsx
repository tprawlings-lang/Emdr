import Link from "next/link";
import { ClinicianPage } from "@/components/clinical/ClinicianPage";
import { Panel, Note, WithNote, SummaryCards } from "@/components/app/surfaces";
import { requireClinician } from "@/lib/auth";
import { buildClinicianPanel } from "@/lib/clinical/panel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Population — Steady Clinical" };

// The clinician's population view (handoff 07 §4.1, p40).
//
// The same ledger the organization console aggregates, read at PERSON level by
// the one role with a care relationship. That is the whole of Wave 4's claim:
// six roles, one set of facts, and the difference between them is what each is
// allowed to see rather than where the numbers come from.
//
// p40 puts five things above the fold and the order is the argument: the
// safety queue first because it is immediate fixed-state work, then who
// changed and how fresh it is, then whether the outcome views have coverage,
// then module use, and planning signals LAST — read-only aggregate hypotheses,
// never mixed into patient orders.
//
// Names appear here and nowhere aggregate. The rule is per-role, not global: a
// clinician reading their own panel has the care relationship that makes a
// name appropriate, and an analyst does not.

export default async function ClinicianPopulationPage() {
  const clinician = await requireClinician();
  const envelope = await buildClinicianPanel(clinician.tenantId);
  // Narrowed once, here. The envelope's data is optional by design — a failed
  // or denied projection has none — and threading that optionality through
  // every read below would put a `?.` in front of numbers the reader is meant
  // to trust.
  const panel = envelope.state === "ready" ? envelope.data : undefined;
  if (!panel) {
    return (
      <ClinicianPage title="Population" lede="Your panel." layer="overview" here="/clinician/population">
        <Panel title="Nothing to show">
          <p className="measure text-sm text-ground">
            This account is not bound to a tenant with an enrolled population.
          </p>
        </Panel>
      </ClinicianPage>
    );
  }
  // p40's first row: immediate fixed-state work. Sorted by state rather than
  // by a score — §29.1 forbids a predictive risk score, and a queue ordered by
  // one would be that score wearing a different name.
  const needsAttention = panel.rows.filter((r) => r.safetyState === "paused");
  const stale = panel.rows.filter((r) => r.daysSinceCheckIn !== null && r.daysSinceCheckIn > 14);
  const missingMeasures = panel.rows.filter((r) => r.missing > 0);

  return (
    <ClinicianPage
      title="Population"
      lede="Your panel, counted from the same events the organization console aggregates."
      layer="overview"
      here="/clinician/population"
    >
      <div className="space-y-6">
        <SummaryCards
          cards={[
            { label: "On your panel", value: String(panel.population), detail: panel.window },
            {
              label: "Paused",
              value: String(needsAttention.length),
              detail: "A fixed safety state, awaiting review",
            },
            {
              label: "Quiet 14+ days",
              value: String(stale.length),
              detail: `of ${panel.population} — not a risk score`,
            },
          ]}
        />

        <WithNote
          note={
            <Note
              title="What ordering this list does not do"
              boundary="Nobody here is ranked. The groups below are fixed states — paused, quiet, measure outstanding — and a person can be in more than one or none. There is no score, no priority number, and no ordering that implies who is most at risk."
              owner={clinician.name}
            >
              <p>
                Steady does not produce a predicted risk score, and a queue ordered by one would
                be that score under a different name. What is sorted here is the work: a fixed
                safety state is immediate, a fortnight&rsquo;s silence is a contact decision, an
                outstanding measure is a coverage gap.
              </p>
            </Note>
          }
        >
          <Panel
            title="Needs a decision"
            footnote={`${panel.window}. Refreshed ${panel.refreshedAt}. A person may appear in more than one group.`}
          >
            <Group
              title="Fixed safety state"
              empty="Nobody on your panel is currently paused."
              rows={needsAttention}
            />
            <Group
              title="No check-in for 14 days or more"
              empty="Everyone on your panel has checked in within a fortnight."
              rows={stale}
            />
            <Group
              title="Measure came due and was not completed"
              empty="No outstanding measures."
              rows={missingMeasures}
            />
          </Panel>
        </WithNote>

        <Panel
          title="Everyone on your panel"
          footnote="Baseline and latest are the first and most recent completed measure. A change needs both — one reading is a baseline, not a trajectory."
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-ground/10 text-left text-xs text-olive">
                  <th className="pb-2 font-medium">Person</th>
                  <th className="pb-2 font-medium">Check-ins</th>
                  <th className="pb-2 font-medium">Last</th>
                  <th className="pb-2 font-medium">Baseline → latest</th>
                  <th className="pb-2 font-medium">Missed</th>
                  <th className="pb-2 font-medium">State</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ground/5">
                {panel.rows.map((r) => (
                  <tr key={r.personId}>
                    <td className="py-2.5">
                      <Link
                        href={`/clinician/member/${r.personId}`}
                        className="text-state-info underline"
                      >
                        {r.name}
                      </Link>
                    </td>
                    <td className="py-2.5 text-ground">{r.checkIns}</td>
                    <td className="py-2.5 text-ground">
                      {r.daysSinceCheckIn === null
                        ? "never"
                        : r.daysSinceCheckIn === 0
                          ? "today"
                          : `${r.daysSinceCheckIn}d ago`}
                    </td>
                    <td className="py-2.5 text-ground">
                      {r.baseline === null
                        ? "no measure"
                        : r.latest === null || r.latest === r.baseline
                          ? `${r.baseline} — unchanged`
                          : `${r.baseline} → ${r.latest}`}
                    </td>
                    <td className="py-2.5 text-ground">{r.missing === 0 ? "—" : r.missing}</td>
                    <td className="py-2.5 text-olive">
                      {r.safetyState ? r.safetyState.replace(/_/g, " ") : "no active gate"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </ClinicianPage>
  );
}

function Group({
  title, rows, empty,
}: {
  title: string;
  rows: Array<{ personId: string; name: string }>;
  empty: string;
}) {
  return (
    <div className="border-b border-ground/5 py-3 last:border-0">
      <p className="text-sm font-medium text-app-ink">
        {title} <span className="font-normal text-olive">({rows.length})</span>
      </p>
      {rows.length === 0 ? (
        // An empty group SAYS it is empty. A blank space reads as a failure to
        // load, and §30.8 requires an absence to explain whether it is expected.
        <p className="mt-1 text-sm text-olive">{empty}</p>
      ) : (
        <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          {rows.map((r) => (
            <li key={r.personId}>
              <Link href={`/clinician/member/${r.personId}`} className="text-sm text-state-info underline">
                {r.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
