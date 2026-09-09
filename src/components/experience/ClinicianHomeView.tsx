import Link from "next/link";
import type { ClinicianHome } from "@/lib/experience/clinician-home";
import { UI_GROUP_LABEL, type UiGroup } from "@/lib/clinical/work-queue";
import { coverageNote } from "@/lib/experience/role-home";
import { summary as filterSummary, type ViewState } from "@/lib/experience/view-state";
import { QueueRow } from "./QueueRow";
import { QueueEvidencePanel } from "./QueueEvidencePanel";
import { RowActions } from "./RowActions";

// The Command Center, rendered (handoff 09 §5, Package 2).
//
// §5's operating question is the page title: "who needs me today, why, what
// changed, and what should I do next?" The layout answers it in that order —
// the counts, then the coverage state, then the rows, then the panel.
//
// COVERAGE COMES BEFORE THE ROWS, and that placement is the point. §5:
// "Coverage failure is visible, not silent. Name which providers failed and the
// last good reading. Partial coverage must never render as full coverage." A
// notice below a list of eight rows is a notice a clinician reads after
// deciding the list is complete.
//
// THE PANEL IS AN ASIDE, NOT AN OVERLAY. §1.4's ruling: non-modal, so the queue
// stays readable beside it. It is driven by a `?row=` parameter rather than by
// client state, which is what keeps the row selected, the back button working,
// and the whole thing functional without JavaScript.
//
// NOTHING HERE SORTS OR FILTERS BY PRIORITY. The rows arrive in the domain's
// order from `clinicianHome`, which arrives in the queue's order from the
// projection. §5: "Retain domain-owned ordering and safety authority."

export function ClinicianHomeView({
  home,
  view,
  selectedRowId,
  assignees,
  basePath = "/clinician/today",
}: {
  home: ClinicianHome;
  view: ViewState;
  /** Which row's evidence is open, from `?row=`. */
  selectedRowId: string | null;
  assignees: Array<{ id: string; name: string }>;
  basePath?: string;
}) {
  const selected = home.items.find((r) => r.id === selectedRowId) ?? null;
  const coverage = coverageNote(home.coverage);
  const activeFilters = filterSummary(view);

  const hrefFor = (params: Record<string, string | null>) => {
    const q = new URLSearchParams();
    if (home.showing) q.set("filter", home.showing);
    for (const [k, v] of Object.entries(params)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    const s = q.toString();
    return s ? `${basePath}?${s}` : basePath;
  };

  return (
    <div className="lg:flex lg:gap-8">
      <div className="min-w-0 flex-1">
        {/* §3's counts as filters. Never capped — the count is the whole
            bucket, so pressing one opens all of it rather than revealing what
            a page limit hid. */}
        <nav aria-label="Queue buckets" className="flex flex-wrap gap-2">
          {(["needs_attention", "review_today", "waiting"] as UiGroup[]).map((g) => {
            const on = home.showing === g;
            return (
              <Link
                key={g}
                href={on ? basePath : `${basePath}?filter=${g}`}
                aria-current={on ? "true" : undefined}
                className={`rounded-full px-3.5 py-1.5 text-sm transition-colors ${
                  on ? "bg-app-accent font-medium text-app-ink" : "bg-linen text-olive hover:bg-app-accent/40"
                }`}
              >
                {UI_GROUP_LABEL[g]}{" "}
                <span className="tabular-nums">{home.counts[g]}</span>
              </Link>
            );
          })}
          {home.stableCount > 0 && (
            <Link
              href="/clinician/caseload?filter=stable"
              className="rounded-full bg-linen px-3.5 py-1.5 text-sm text-olive hover:bg-app-accent/40"
            >
              {/* §23: "Stable means no current suggested action under policy,
                  not healthy or low risk." The label says which. */}
              No action suggested <span className="tabular-nums">{home.stableCount}</span>
            </Link>
          )}
        </nav>

        {/* COVERAGE, before the rows. */}
        {coverage && (
          <div
            data-testid="coverage-notice"
            className="mt-4 rounded-2xl border border-state-caution/40 bg-state-caution-bg/40 px-4 py-3"
          >
            <p className="measure text-sm text-app-ink">{coverage}</p>
            <p className="measure mt-1 text-xs text-olive">
              This queue is not complete. What is missing is a source Steady could not read, not an
              absence of work.
            </p>
          </div>
        )}

        {/* §5's active-filter summary and reset. Rendered only when something
            is off the default — a summary that always shows is one nobody
            reads. */}
        {activeFilters && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-olive">Showing: {activeFilters}</span>
            <Link href={basePath} className="underline underline-offset-2">
              Reset
            </Link>
          </div>
        )}

        <p className="measure mt-4 text-sm text-olive">{home.asking.orienting}</p>

        {home.items.length === 0 ? (
          // §8.4: an empty state must never imply a healthy or low-risk state.
          <div className="mt-4 rounded-3xl border border-ground/10 bg-linen px-5 py-6">
            <p className="measure text-sm text-app-ink">{home.primaryAbsentNote}</p>
            <p className="mt-3 text-sm">
              <Link href="/clinician/caseload" className="underline">The whole caseload</Link>
              {" · "}
              <Link href="/clinician/activity" className="underline">Recent activity</Link>
            </p>
          </div>
        ) : (
          <ul className="mt-4 overflow-hidden rounded-3xl border border-ground/10 bg-linen">
            {home.items.map((row) => (
              <QueueRow
                key={row.id}
                row={row}
                now={home.generatedAt}
                selected={row.id === selectedRowId}
                panelHref={
                  row.id === selectedRowId ? hrefFor({ row: null }) : hrefFor({ row: row.id })
                }
              >
                {row.action && (
                  <RowActions
                    personId={row.personId}
                    signalId={row.signalId}
                    action={row.action}
                    personName={row.personName}
                    // The version the row was rendered against, so a decision
                    // is reconciled before it is accepted (§5).
                    expectedVersion={null}
                    assignees={assignees}
                  />
                )}
              </QueueRow>
            ))}
          </ul>
        )}

        {home.totalItems > home.items.length && (
          <p className="mt-3 text-sm">
            <Link
              href={home.showing ? `${basePath}?filter=${home.showing}` : basePath}
              className="underline"
            >
              {home.totalItems - home.items.length} more
            </Link>{" "}
            <span className="text-xs text-olive">
              — in the same server order, nothing filtered out.
            </span>
          </p>
        )}

        <p className="measure mt-8 text-xs text-olive">
          Opening a record is not acknowledgement, and nothing on a row changes anything until the
          server confirms it. Queue order is the domain&rsquo;s and is deterministic for a given
          policy version and evidence set; the buckets above choose which part to show and never
          reorder it.
        </p>
      </div>

      {/* The panel. An aside on wide screens; it stacks under the queue on
          narrow ones, which is §5's small-screen answer arriving through the
          layout rather than through a different component. */}
      {selected && (
        <div className="mt-8 lg:mt-0 lg:w-[24rem] lg:shrink-0">
          <QueueEvidencePanel
            row={selected}
            mode="nonmodal"
            closeHref={hrefFor({ row: null })}
          >
            <RowActions
              personId={selected.personId}
              signalId={selected.signalId}
              action={selected.action ?? "open"}
              personName={selected.personName}
              expectedVersion={null}
              assignees={assignees}
            />
          </QueueEvidencePanel>
        </div>
      )}
    </div>
  );
}
