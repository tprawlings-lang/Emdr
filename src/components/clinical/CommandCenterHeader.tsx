import Link from "next/link";
import type { UiGroup, WorkQueue } from "@/lib/clinical/work-queue";
import { UI_GROUP_LABEL } from "@/lib/clinical/work-queue";
import { relativeAge } from "./primitives";

// The Command Center header strip (expansion handoff 03 §3).
//
// §1's "first 10 seconds" is the whole brief for this component:
//
//   How many people need attention now?
//   How many should be reviewed today?
//   What is waiting on somebody else?
//   How much of the caseload is currently stable with no suggested action?
//
// Four numbers, and each one is a filter. §3: "counts are clickable filters."
//
// STABLE IS THE ONE THAT NEEDS THE MOST CARE, and it gets a sentence of its
// own. §3: "the stable count is not a quality score. It means no current work
// item under the active policy", and §23: "stable means no current suggested
// action under policy, not healthy or low risk." A big number next to the word
// "stable" reads as "most of my caseload is doing well" unless something says
// otherwise, so something says otherwise, in the copy, every time.
//
// AND THE FRESHNESS IS THE PROJECTION'S, NOT THE BROWSER'S. §3 asks for
// "projection freshness and policy version in a low-emphasis status
// affordance", and §20's stale state requires "last successful compute time. Do
// not pretend queue is current." A component that computed age from its own
// clock would say "updated just now" about a projection built an hour ago.

const FILTERS: Array<{ key: UiGroup | "stable"; label: string }> = [
  { key: "needs_attention", label: UI_GROUP_LABEL.needs_attention },
  { key: "review_today", label: UI_GROUP_LABEL.review_today },
  { key: "waiting", label: UI_GROUP_LABEL.waiting },
  { key: "stable", label: "Stable / no action" },
];

export function CommandCenterHeader({
  queue, active, basePath = "/clinician/today",
}: {
  queue: WorkQueue;
  /** The filter currently applied, or null for everything. */
  active: UiGroup | "stable" | null;
  basePath?: string;
}) {
  const countFor = (key: UiGroup | "stable"): number =>
    key === "stable" ? queue.stableCount : queue.uiCounts[key];

  const failed = queue.coverage.providersFailed;

  return (
    <div>
      <nav aria-label="Filter by attention state">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {FILTERS.map((f) => {
            const isActive = active === f.key;
            return (
              <li key={f.key}>
                <Link
                  href={isActive ? basePath : `${basePath}?filter=${f.key}`}
                  aria-current={isActive ? "true" : undefined}
                  className={`block rounded-2xl border px-4 py-3 transition-colors ${
                    isActive
                      ? "border-ground/40 bg-app-accent/50"
                      : "border-ground/10 bg-linen hover:border-ground/25"
                  }`}
                >
                  <span className="block text-xs font-medium uppercase tracking-wide text-olive">
                    {f.label}
                  </span>
                  <span className="mt-1 block text-2xl font-semibold text-ground">
                    {countFor(f.key)}
                  </span>
                  {/* Not colour alone (§19). The selected filter says so in
                      words for a screen reader and shows it in the border for
                      everyone else. */}
                  {isActive && <span className="sr-only">Filter applied. Select again to clear.</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <p className="measure mt-3 text-xs text-olive">
        Stable means no suggested action under policy {queue.policyVersion} — not healthy, not low
        risk, and not a score. Updated {relativeAge(queue.computedAt, queue.computedAt)}.
      </p>

      {/* §20: "one provider failed → keep other work. Surface partial coverage."
          Named rather than implied: a clinician who cannot tell a quiet day from
          a broken provider is a clinician who has to distrust both. */}
      {failed.length > 0 && (
        <p className="measure mt-2 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-900">
          <span aria-hidden>◆ </span>
          {failed.length === 1 ? "One source" : `${failed.length} sources`} did not run just now
          ({failed.map((f) => f.providerId).join(", ")}). Everything else below is current — this
          list may be missing work those sources would have raised.
        </p>
      )}

      {queue.coverage.truncated && (
        <p className="measure mt-2 text-xs text-olive">
          Signals were refreshed for the part of your caseload the model is most concerned about.
          People beyond that still show any signal already raised for them.
        </p>
      )}
    </div>
  );
}
