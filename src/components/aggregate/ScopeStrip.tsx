import Link from "next/link";
import { scopeChanges, type Scope } from "@/lib/experience/aggregate";

// The scope strip (handoff 09 §6; Package 5).
//
// §6: "Organization, period, and data freshness travel together in a scope
// strip, carried into every drilldown, with a warning before change and an
// obvious reset."
//
// TOGETHER, ON ONE ROW, ABOVE THE CHARTS. §6 opens the section with "Scope
// before charts" and the ordering is the instruction: a reader who sees a
// number before they see what it is scoped to has already formed an
// impression, and the strip below then reads as a caveat rather than as the
// frame.
//
// THE WARNING SAYS WHAT CHANGES, NOT THAT SOMETHING WILL. `scopeChanges`
// returns a consequence per field — a different-length period breaks counts
// but not rates, a different dataset build moves figures for reasons that have
// nothing to do with the population. A dialog that says "are you sure?" is a
// dialog people click through; one that says "these periods are different
// lengths, so counts are not comparable" is information.
//
// AND THE RESET IS A LINK, NOT A CLEVERNESS. §6 asks for "an obvious reset".
// It renders whenever the current scope differs from the default, it is
// visible rather than in a menu, and it goes to the unparameterised route —
// which is the default by construction rather than by a second definition of
// it.

export function ScopeStrip({
  scope,
  defaultScope,
  resetHref,
  pending,
  periods,
  governs,
}: {
  scope: Scope;
  /** What this console shows when nobody has narrowed it. */
  defaultScope: Scope;
  resetHref: string;
  /** A scope the reader is about to move to, when they are mid-change. The
   *  warning renders from this rather than from a guess. */
  pending?: Scope | null;
  /** The windows a reader may choose, already resolved to hrefs on the route
   *  being rendered. Passed in rather than computed here, because the strip is
   *  a client-safe component and the route comes from a request header. */
  periods?: Array<{ label: string; href: string; days: number; selected: boolean }>;
  /** What the period actually applies to, where it does not apply to the whole
   *  console. Required by honesty rather than by layout — see the note at the
   *  render site. */
  governs?: string;
}) {
  const narrowed = scopeChanges(defaultScope, scope).length > 0;
  const warning = pending ? scopeChanges(scope, pending) : [];

  return (
    <section
      aria-label="Reporting scope"
      className="mb-6 rounded-2xl border border-ground/15 bg-app-surface px-5 py-4"
    >
      <dl className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-olive">Organization</dt>
          <dd className="text-sm font-medium text-app-ink">{scope.organizationLabel}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-olive">Period</dt>
          <dd className="text-sm font-medium text-app-ink">{scope.period.label}</dd>
          {/* WHAT THE PERIOD GOVERNS, when it does not govern everything. Most
              figures on these consoles are all-time counts; saying "Last 90
              days" over them without qualification is the strip over-claiming,
              and a reader has no way to tell. */}
          {governs && <dd className="text-xs text-olive">{governs}</dd>}
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-olive">Data</dt>
          <dd className="text-sm text-app-ink">
            {scope.freshness.refreshedAt
              ? `rebuilt ${scope.freshness.refreshedAt.slice(0, 10)}`
              : "never built"}{" "}
            <span className="font-mono text-xs text-olive">{scope.freshness.dataVersion}</span>
          </dd>
        </div>

        {periods && periods.length > 0 && (
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-olive">
              Change the window
            </dt>
            <dd className="mt-0.5 flex flex-wrap gap-1">
              {periods.map((p) => (
                <Link
                  key={p.days}
                  href={p.href}
                  aria-current={p.selected ? "true" : undefined}
                  className={`rounded-full px-3 py-1 text-sm transition-colors ${
                    p.selected
                      ? "bg-app-accent font-medium text-app-ink"
                      : "text-olive hover:bg-app-accent/50"
                  }`}
                >
                  {p.label}
                </Link>
              ))}
            </dd>
          </div>
        )}

        {narrowed && (
          <div className="ml-auto">
            <Link href={resetHref} className="text-sm text-state-info underline">
              Reset to {defaultScope.period.label}
            </Link>
          </div>
        )}
      </dl>

      {warning.length > 0 && (
        <div role="alert" className="mt-3 rounded-xl border border-state-caution/50 bg-state-caution-bg/60 px-4 py-3">
          <p className="text-sm font-semibold text-ground">Changing the scope changes what these numbers mean</p>
          <ul className="mt-1 space-y-1">
            {warning.map((w) => (
              <li key={w.field} className="measure text-sm text-ground">
                <span className="font-medium">
                  {w.from} → {w.to}.
                </span>{" "}
                {w.consequence}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
