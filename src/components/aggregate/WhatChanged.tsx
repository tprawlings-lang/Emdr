import Link from "next/link";
import {
  leadWith, MAX_LEADING_CHANGES, NO_OWNERSHIP_NOTE, mayOfferOwnership,
  type Change,
} from "@/lib/experience/aggregate";

// What changed (handoff 09 §6, §10 Package 5).
//
// §6: "Scope before charts. Lead with two or three meaningful changes, then
// the supporting table."
//
// THE CAP IS THE FEATURE, NOT A LAYOUT CONSTRAINT. A "what changed" list of
// eleven items is the supporting table with a different heading — it hands the
// reader back the job of deciding what matters, which is the job this framing
// exists to do for them. Three, and then the count of what else moved, so
// nothing is hidden and nothing is promoted by accident.
//
// NO OWNERSHIP CHIP. §6: "Do not offer Assign follow-up unless a persisted,
// authorized ownership workflow exists. An owner chip that implies someone
// accepted responsibility, when nobody did, is a clinical-safety misstatement
// wearing a UI costume." There is no such workflow on the aggregate consoles,
// so the panel says plainly that nobody is assigned rather than leaving the
// question open — an absent chip and a stated absence read very differently to
// somebody deciding whether to act.

export function WhatChanged({
  changes,
  tableHref,
}: {
  changes: readonly Change[];
  /** Where the supporting table is. §6: the changes lead, the table follows. */
  tableHref: string;
}) {
  const { leading, remaining } = leadWith(changes);

  return (
    <section aria-labelledby="what-changed" className="mb-6">
      <h2 id="what-changed" className="type-display text-xl font-medium text-app-ink">
        What changed
      </h2>

      {leading.length === 0 ? (
        <p className="measure mt-2 text-sm text-ground">
          Nothing moved enough this period to lead with. The supporting table below is the
          whole picture, which is a finding rather than an empty screen.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {leading.map((c) => (
            <li key={c.label} className="rounded-2xl border border-ground/15 bg-app-surface px-5 py-4">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium text-app-ink">{c.label}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    c.provenance === "modelled"
                      ? "bg-state-caution-bg text-ground"
                      : "bg-app-accent text-app-ink"
                  }`}
                >
                  {c.provenance}
                </span>
              </div>
              <p className="measure mt-1 text-sm text-ground">{c.statement}</p>
              <Link href={c.href} className="mt-2 inline-block text-sm text-state-info underline">
                Look at this
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-sm text-olive">
        {remaining > 0
          ? `${remaining} other ${remaining === 1 ? "figure" : "figures"} moved this period. `
          : ""}
        <Link href={tableHref} className="text-state-info underline">
          The supporting table
        </Link>{" "}
        has every figure with its denominator.
        {leading.length >= MAX_LEADING_CHANGES && " Three lead; the rest are not ranked."}
      </p>

      {!mayOfferOwnership() && (
        <p className="measure mt-3 rounded-xl border border-ground/15 bg-linen/50 px-4 py-3 text-sm text-ground">
          {NO_OWNERSHIP_NOTE}
        </p>
      )}
    </section>
  );
}
