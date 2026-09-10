import Link from "next/link";
import { OrgPage } from "@/components/app/OrgPage";
import { Panel } from "@/components/app/surfaces";
import { ExportPanel } from "@/components/app/ExportPanel";
import { requestOrgExport } from "@/lib/intelligence/export-actions";
import { listExports } from "@/lib/intelligence/export";
import { resolveOrgTenant } from "@/lib/intelligence/scope";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reports — Steady Intelligence" };

// Reports (§26: "Create review-ready packets — governed exports — download").
//
// The word that stops this shipping as a download button is "governed", and
// this screen carried a panel saying so for as long as the only alternative
// WAS a download button.
//
// It is built now, and the six requirements below are columns on export_jobs
// rather than intentions: filter parity, cohort version, suppression, stated
// purpose, audit event, signed file. The purpose field is the visible half —
// a file cannot be produced without saying what it is for, in a sentence, and
// the sentence is recorded with it.

const REQUIREMENTS: { label: string; body: string }[] = [
  {
    label: "Filter parity",
    body: "The file contains exactly the cohort on screen. An export that silently widens the filter is a disclosure nobody authorised.",
  },
  {
    label: "Cohort version",
    body: "The cohort definition is versioned and travels with the file, so the same report can be reproduced after the definition changes.",
  },
  {
    label: "Suppression",
    body: "Small cells are suppressed in the file exactly as on screen. Suppression that only applies to the rendering is not suppression.",
  },
  {
    label: "Stated purpose",
    body: "The requester names a purpose before the file exists, and the purpose is recorded with it.",
  },
  {
    label: "Audit event",
    body: "Who exported what, under which filter hash and for which purpose, appended to the immutable log.",
  },
  {
    label: "Signed file",
    body: "The file carries a signature, so a copy circulating later can be checked against what was actually released.",
  },
];

export default async function OrgReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ export?: string; refused?: string; error?: string }>;
}) {
  const { export: exportId, refused, error } = await searchParams;
  const tenantId = await resolveOrgTenant();
  const history = tenantId ? await listExports(tenantId) : [];

  return (
    <OrgPage
      layer="evidence"
      here="/organization/reports"
      title="Reports"
      lede="A governed export: it states its purpose, carries its filter and cohort, suppresses small cells in the file, and writes an audit event before it exists."
    >
      <div className="space-y-6">
        <ExportPanel
          action={requestOrgExport}
          title="Export site comparison"
          describe="One row per site: referred, contacted, started care, and median wait."
          exportId={exportId}
          refused={refused}
          error={error}
          history={history}
        />

        <Panel title="What a review-ready packet carries">
          <dl className="divide-y divide-ground/5">
            {REQUIREMENTS.map((r) => (
              <div key={r.label} className="grid gap-1 py-3 sm:grid-cols-[9rem_1fr] sm:gap-4">
                <dt className="text-sm font-medium text-app-ink">{r.label}</dt>
                <dd className="measure text-sm text-ground">{r.body}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel title="What is still by hand">
          <p className="measure text-sm text-ground">
            A packet is one export at a time. Assembling several into a single signed bundle,
            and scheduling one to recur, are not built — and a recurring export is a standing
            disclosure, so it needs an expiry and a review date before it should be.
          </p>
          <p className="measure mt-3 text-sm text-olive">
            Every figure on the{" "}
            <Link href="/organization/overview" className="text-state-info underline">operating overview</Link>,{" "}
            <Link href="/organization/access" className="text-state-info underline">access pipeline</Link> and{" "}
            <Link href="/organization/outcomes" className="text-state-info underline">outcomes</Link>{" "}
            screens carries its denominator, window and projection version, so a packet built
            from them by hand can still be checked.
          </p>
        </Panel>
      </div>
    </OrgPage>
  );
}
