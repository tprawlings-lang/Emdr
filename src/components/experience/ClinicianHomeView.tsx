import Link from "next/link";
import type { ClinicianHome } from "@/lib/experience/clinician-home";
import { UI_GROUP_LABEL, type UiGroup } from "@/lib/clinical/work-queue";
import { coverageNote } from "@/lib/experience/role-home";
import { summary as filterSummary, type ViewState } from "@/lib/experience/view-state";
import { QueueRow } from "./QueueRow";
import { QueueEvidencePanel } from "./QueueEvidencePanel";
import { RestoreFocus } from "./RestoreFocus";
import { QueueConfirmations } from "./QueueConfirmations";
import { RowActions } from "./RowActions";
import { ownershipDebtStatement, OWNERSHIP_DEBT_LIMIT } from "@/lib/clinical/ownership-debt";

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
  showingAll = false,
  environmentGeneration,
}: {
  home: ClinicianHome;
  view: ViewState;
  /** Which row's evidence is open, from `?row=`. */
  selectedRowId: string | null;
  assignees: Array<{ id: string; name: string }>;
  basePath?: string;
  /** Whether the caller asked for the whole list rather than the first page. */
  showingAll?: boolean;
  /** The rebuild this page was rendered from, carried into every command so a
   *  tab that predates a reset is refused rather than acting on records that
   *  no longer exist. */
  environmentGeneration: string;
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
    // The confirmation region wraps BOTH columns.
    //
    // ./QueueConfirmations.tsx says why it exists at all: a confirmed review
    // can remove the row it came from, so the confirmation cannot live inside
    // the row. It has to wrap the panel as well as the list, because the panel
    // is derived from the same items — a removed row closes the panel too, and
    // an action taken there would vanish the same way.
    <QueueConfirmations>
    {/* SIDE BY SIDE ONLY WHERE BOTH FIT. Measured at 1024px with the panel
        open, a queue row was 262px wide — the panel takes a fixed 24rem out of
        the row and the list gets whatever is left. UX 011 reports exactly that:
        "the evidence drawer compresses queue rows". Below xl the panel becomes
        the detail view instead, which is the handoff's own small-screen answer:
        "open a dedicated detail view or accessible sheet instead of squeezing
        the list." */}
    <div className="flex flex-col xl:flex-row xl:gap-8">
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

        {/* UNCLAIMED WORK, BEFORE THE ROWS, for the reason coverage is: a count
            under a list is a count somebody reads after deciding the list is
            complete. Rendered only when there is some — a panel that says
            "0 unclaimed" every morning is a panel nobody reads on the morning
            it says nine.

            NOT A WARNING TONE. There is no rule in this build for who
            unclaimed work falls to or after how long, so nothing here is late
            — and a caution colour would be this screen inventing the deadline
            the register says it must not. Neutral, with the absence of the
            rule stated in words. */}
        {home.debt.unowned > 0 && (
          <div
            data-testid="ownership-debt"
            className="mt-4 rounded-2xl border border-ground/15 bg-linen px-4 py-3"
          >
            <p className="measure text-sm text-app-ink">
              {ownershipDebtStatement(home.debt)}
              {home.debt.oldestWaitDays !== null && home.debt.oldestPersonName && (
                <>
                  {" "}The longest has been waiting{" "}
                  <strong>
                    {home.debt.oldestWaitDays} day{home.debt.oldestWaitDays === 1 ? "" : "s"}
                  </strong>{" "}
                  ({home.debt.oldestPersonName}).
                </>
              )}
            </p>
            <p className="measure mt-1 text-xs text-olive">{OWNERSHIP_DEBT_LIMIT}</p>
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
                    expectedVersion={row.version}
                    // Which rebuild this page was rendered from. A tab left
                    // open across a demo reset is showing records that no
                    // longer exist, and no per-row version can say so.
                    environmentGeneration={environmentGeneration}
                    assignees={assignees}
                  />
                )}
              </QueueRow>
            ))}
          </ul>
        )}

        {/* UX 001. This control used to build its own href — `?filter=` when
            something was showing, the bare path otherwise — and the cap only
            applies when NOTHING is showing, so it always resolved to the page
            the reader was already on. Clicking "29 more" redrew the same
            twenty-nine-short list.

            It goes through `hrefFor` now, like every other control here, which
            is also what keeps the active filter and the open row on the way
            through. */}
        {home.totalItems > home.items.length && (
          <p className="mt-3 text-sm">
            <Link href={hrefFor({ rows: "all" })} className="underline">
              Show the remaining {home.totalItems - home.items.length}
            </Link>{" "}
            <span className="text-xs text-olive">
              — in the same server order, nothing filtered out.
            </span>
          </p>
        )}

        {/* And back. A list that can only grow is a control with no opposite,
            and the reader who opened 300 rows to find one has no way to
            restore the view they were working in. */}
        {showingAll && home.totalItems > 0 && (
          <p className="mt-3 text-sm">
            <span className="text-xs text-olive">
              Showing all {home.totalItems}.{" "}
            </span>
            <Link href={hrefFor({ rows: null })} className="underline">
              Show the first page instead
            </Link>
          </p>
        )}

        <p className="measure mt-8 text-xs text-olive">
          Opening a record is not acknowledgement, and nothing on a row changes anything until the
          server confirms it. Queue order is the domain&rsquo;s and is deterministic for a given
          policy version and evidence set; the buckets above choose which part to show and never
          reorder it.
        </p>
      </div>

      {/* The panel. An aside on wide screens; the detail view below xl.
          ORDER-FIRST BELOW xl, and this is the half that was actually broken
          rather than merely tight. Measured on a 390x844 screen, the panel
          opened at y=3204 — 2,360px below the fold — so a clinician who tapped
          "why this is here" saw the screen not change at all. Stacking it under
          the queue put the answer behind the entire list — the previous comment
          here called stacking "§5's small-screen answer", and it was not one.
          The container is flex at EVERY width for this reason: `order-first` is
          a flex property, and on a block container it is silently ignored. The
          first attempt at this fix set the order and changed nothing, which the
          measurement caught and reading the class list would not have. */}
      {selected && (
        <div className="order-first mb-8 xl:order-none xl:mb-0 xl:w-[24rem] xl:shrink-0">
          <QueueEvidencePanel
            row={selected}
            mode="nonmodal"
            // The fragment is the focus-return target, so closing puts the
            // keyboard back on the control that opened the panel rather than
            // on <body> at the top of the document.
            closeHref={`${hrefFor({ row: null })}#row-${selected.id}`}
          >
            <RowActions
              personId={selected.personId}
              signalId={selected.signalId}
              action={selected.action ?? "open"}
              personName={selected.personName}
              expectedVersion={selected.version}
              environmentGeneration={environmentGeneration}
              assignees={assignees}
            />
          </QueueEvidencePanel>
        </div>
      )}
    </div>
    {/* Keyed on which row is open, so closing the panel re-runs the effect.
        The first version mounted once with an empty dependency list, and a
        client-side navigation re-renders without remounting — so focus was
        still landing on <body> after the fix, exactly as before it. */}
    <RestoreFocus token={selected?.id ?? "closed"} />
    </QueueConfirmations>
  );
}
