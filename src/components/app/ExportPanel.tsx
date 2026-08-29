import { Panel } from "@/components/app/surfaces";
import type { ExportRecord } from "@/lib/intelligence/export";

// The export control, shared by both aggregate consoles.
//
// The design is one decision: THE PURPOSE FIELD IS THE BUTTON. There is no way
// to produce a file without writing a sentence about what it is for, because
// the sentence is what makes the disclosure reviewable six months later — and
// a purpose collected after the fact is a justification rather than a reason.
//
// The history below is not a convenience. It IS the audit surface for exports:
// what left, under which filter hash, for what stated reason, and who asked.
// A console that can export but cannot show what it has exported has a
// disclosure log nobody can read.

export function ExportPanel({
  action,
  title,
  describe,
  exportId,
  refused,
  error,
  history,
}: {
  action: (formData: FormData) => void | Promise<void>;
  title: string;
  /** What one row of the file is. */
  describe: string;
  exportId?: string;
  refused?: string;
  error?: string;
  history: ExportRecord[];
}) {
  const latest = exportId ? history.find((h) => h.id === exportId) : undefined;

  return (
    <div className="space-y-6">
      <Panel
        title={title}
        footnote="Counts below the small-cell threshold are withheld in the FILE, not only on screen. Suppression that applies to the rendering alone is not suppression."
      >
        <p className="measure text-sm text-ground">{describe}</p>

        {refused && (
          <p
            role="status"
            className="mt-4 rounded-2xl border border-state-caution/40 bg-state-caution-bg/60 px-4 py-3 text-sm text-ground"
          >
            {refused}
          </p>
        )}
        {error === "scope" && (
          <p role="status" className="mt-4 text-sm text-state-support">
            This account is not bound to exactly one tenant, so there is nothing to export.
          </p>
        )}
        {error === "nodata" && (
          <p role="status" className="mt-4 text-sm text-state-support">
            The current view has no rows to export.
          </p>
        )}

        {latest && (
          <div className="mt-4 rounded-2xl border border-state-safe/40 bg-state-safe-bg/50 px-4 py-3">
            <p className="text-sm font-medium text-ground">
              Export released — {latest.rowCount} row{latest.rowCount === 1 ? "" : "s"}
              {latest.suppressedCells > 0 && `, ${latest.suppressedCells} cell(s) suppressed`}
            </p>
            <p className="mt-1 font-mono text-xs text-olive">
              filter {latest.filterHash} · cohort {latest.cohortVersion} · content{" "}
              {latest.contentHash.slice(0, 12)}
            </p>
            <a
              href={`/api/exports/${latest.id}`}
              className="mt-3 inline-block rounded-full border border-ground/25 px-5 py-2 text-sm font-medium text-ground transition-colors hover:bg-ground/5"
            >
              Download the signed manifest
            </a>
          </div>
        )}

        <form action={action} className="mt-5">
          <label className="block">
            <span className="text-sm font-medium text-ground">
              What is this file for?
            </span>
            <span className="measure mt-0.5 block text-xs text-olive">
              Recorded with the export and shown in the history below. A file cannot be
              produced without it — this is the field that makes the disclosure reviewable
              later.
            </span>
            <textarea
              name="purpose"
              required
              minLength={12}
              rows={2}
              placeholder="e.g. Quarterly access review with the North site lead, 14 March"
              className="mt-2 w-full rounded-2xl border border-ground/15 bg-app-surface px-4 py-2.5 text-sm focus:border-sage focus:outline-none"
            />
          </label>
          <button
            type="submit"
            className="mt-3 rounded-full bg-app-ink px-6 py-2.5 text-sm font-medium text-app-surface transition-opacity hover:opacity-90"
          >
            Create export
          </button>
        </form>
      </Panel>

      <Panel
        title="Export history"
        footnote="This is the disclosure log. A console that can export but cannot show what it has exported has an audit trail nobody can read."
      >
        {history.length === 0 ? (
          <p className="measure text-sm text-ground">
            Nothing has been exported from this tenant. That is an empty result, not a failure
            to load.
          </p>
        ) : (
          <ul className="divide-y divide-ground/5">
            {history.map((h) => (
              <li key={h.id} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-ground">{h.surface}</span>
                  <span className="text-xs text-olive">{h.createdAt}</span>
                </div>
                <p className="measure mt-1 text-sm text-ground">{h.purpose}</p>
                <p className="mt-1 font-mono text-xs text-olive">
                  {h.requestedByName ?? "unknown"} · filter {h.filterHash} · {h.rowCount} rows
                  {h.suppressedCells > 0 && ` · ${h.suppressedCells} suppressed`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
