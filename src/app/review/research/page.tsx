import { ReviewPage } from "@/components/clinical/ReviewPage";
import { Panel, Callout, SummaryCards } from "@/components/app/surfaces";
import { requireReviewAccess } from "@/lib/auth";
import { cohortTable } from "@/lib/review/research";
import { registryVersion } from "@/lib/metrics/cohorts";
import { listExports } from "@/lib/intelligence/export";
import { PLANNING_TENANT_ID } from "@/lib/planning/scope";
import { requestResearchExport } from "@/lib/review/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Research workspace — Steady Review" };

// §26 p44: "Research workspace — /review/research — Use approved
// de-identified data — Consent and cohort guardrails — Request export".
//
// The guardrails are the screen. A research workspace that shows the data
// first and its constraints in a footnote has the emphasis backwards: the
// reason this surface can exist at all is that it cannot reach a person, and
// that has to be the first thing it says and the thing its structure makes
// true.

export default async function ResearchWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ export?: string; refused?: string; error?: string }>;
}) {
  await requireReviewAccess();
  const { export: exportId, refused, error } = await searchParams;

  const table = await cohortTable();
  const version = registryVersion();
  const recent = await listExports(PLANNING_TENANT_ID, 10);

  const suppressed = table.rows.filter((r) => r.suppressed).length;

  return (
    <ReviewPage
      layer="evidence"
      here="/review/research"
      title="Research workspace"
      lede="Cohort-level counts over the fabricated population. There is no person-level column here and no path to one — the workspace loads observations and resolves them into groups, and the groups are all it can see."
    >
      {error === "purpose_required" && (
        <Callout tone="support" label="Not exported" className="mb-6">
          An export needs a stated purpose, recorded before the file exists. A purpose supplied afterwards is a justification.
        </Callout>
      )}
      {refused && (
        <Callout tone="support" label="Export refused" className="mb-6">
          {decodeURIComponent(refused)}
        </Callout>
      )}
      {exportId && (
        <Callout tone="safe" label="Export recorded" className="mb-6">
          Job <span className="font-mono text-xs">{exportId}</span> written to the disclosure register with its filter hash,
          row count, suppressed cells and signature.
        </Callout>
      )}

      <SummaryCards
        cards={[
          { label: "Cohorts in the registry", value: `${table.rows.length}`, detail: "each with an immutable definition" },
          { label: "Observations resolved", value: table.observations.toLocaleString(), detail: "across the demo organizations" },
          { label: "Cells below threshold", value: `${suppressed}`, detail: `suppressed under ${table.smallCell}` },
        ]}
      />

      <Panel title="The guardrails" className="mt-6">
        <ul className="space-y-3 text-sm text-olive">
          <li>
            <strong className="text-app-ink">Eligibility is resolved before any group filter.</strong> The two are separate
            fields in the cohort definition, and a cohort whose eligibility rule contains an activity predicate is refused
            rather than discouraged — so &ldquo;what fraction of people who engaged, engaged&rdquo; is not a number this
            workspace can produce.
          </li>
          <li>
            <strong className="text-app-ink">Counts below {table.smallCell} are suppressed in the file, not only on the
            screen.</strong> Suppression that applies to the rendering and not the export is not suppression.
          </li>
          <li>
            <strong className="text-app-ink">Every file carries its filter hash.</strong> It is computed from the filter this
            screen was showing, so a file can be checked against the view that produced it — an export that widened its own
            filter is a disclosure nobody authorised, and without the hash nobody could tell afterwards.
          </li>
          <li>
            <strong className="text-app-ink">The registry version is derived from the cohorts.</strong> Adding, removing or
            altering any cohort changes the identity of every file produced from the set, so an old report cannot be quietly
            reproduced under a different registry.
          </li>
        </ul>
      </Panel>

      <Panel title="Cohorts" className="mt-6" footnote={`Registry version ${version}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ground/10 text-left text-olive">
                <th className="py-2 pr-4 font-medium">Cohort</th>
                <th className="py-2 pr-4 font-medium">Question it is for</th>
                <th className="py-2 pr-4 text-right font-medium">Eligible</th>
                <th className="py-2 text-right font-medium">In group</th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r) => (
                <tr key={r.cohortId} className="border-b border-ground/5 align-top">
                  <td className="py-2 pr-4">
                    <div className="font-medium text-app-ink">{r.label}</div>
                    <div className="font-mono text-xs text-olive">
                      {r.cohortId} v{r.cohortVersion}
                    </div>
                  </td>
                  <td className="py-2 pr-4 text-olive">{r.question}</td>
                  <td className="py-2 pr-4 text-right tabular-nums text-app-ink">{r.eligibleN.toLocaleString()}</td>
                  <td className="py-2 text-right tabular-nums text-app-ink">
                    {r.suppressed ? <span className="text-olive">suppressed</span> : r.groupN.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Request an export" className="mt-6">
        <form action={requestResearchExport} className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block text-olive">What the file is needed for</span>
            <textarea
              name="purpose"
              rows={2}
              maxLength={500}
              required
              className="w-full rounded-xl border border-ground/20 bg-app-surface px-3 py-2"
            />
          </label>
          <label className="flex items-start gap-2 text-sm text-olive">
            <input type="checkbox" required className="mt-1" />
            <span>
              I am requesting cohort-level counts at registry version <span className="font-mono text-xs">{version}</span>.
              This creates a signed, audited disclosure record.
            </span>
          </label>
          <button className="rounded-full bg-app-ink px-4 py-2 text-sm font-medium text-app-surface">Request export</button>
        </form>
      </Panel>

      <Panel title="Disclosure register" className="mt-6" footnote="Every export ever produced from this surface, with the hash that ties the file to the audit record.">
        {recent.length === 0 ? (
          <p className="text-sm text-olive">No exports have been produced. An empty register, not an unavailable one.</p>
        ) : (
          <ul className="space-y-3">
            {recent.map((e) => (
              <li key={e.id} className="rounded-xl border border-ground/10 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-app-ink">{e.surface}</span>
                  <span className="font-mono text-xs text-olive">{new Date(e.createdAt).toLocaleString()}</span>
                </div>
                <p className="mt-1 text-olive">{e.purpose}</p>
                <p className="mt-1 font-mono text-xs text-olive">
                  {e.rowCount} rows · {e.suppressedCells} cells suppressed · filter {e.filterHash} · content {e.contentHash.slice(0, 16)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </ReviewPage>
  );
}
