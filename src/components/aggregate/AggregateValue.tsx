import { PROVENANCE_NOTE, type Presented } from "@/lib/experience/aggregate";

// One aggregate number, with everything §6 requires beside it.
//
// §6: "Observed and modelled are visually separate. Unit, period, denominator,
// and material lag sit beside the value. A user must never have to open a
// drawer to learn a number is modelled."
//
// THE LAST CLAUSE IS WHY THIS COMPONENT EXISTS RATHER THAN A `<span>`. Method
// belongs in a drawer — it is long, and most readers do not want it. The word
// `modelled` does not, because the reader who never opens the drawer is
// exactly the reader who will quote the number. So the label renders in the
// same visual field as the value, and it comes from `presentValue`, which
// stamps it — a component cannot pass an empty one for a card that felt
// cluttered.
//
// AND WITHHELD IS NOT ZERO. §6: "Suppression shows as withheld, never as zero."
// The presented value is a discriminated union with no `value` field on the
// withheld branch, so there is nothing here to format as 0 — the mistake this
// prevents is `{value ?? 0}` in a template, which renders a suppressed cohort
// of four people as a confident zero.

export function AggregateValue({ shown }: { shown: Presented }) {
  return (
    <div>
      <p className="text-sm text-olive">{shown.label}</p>

      <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
        {shown.kind === "value" ? (
          <span className="type-display text-2xl font-medium text-app-ink">
            {shown.value.toLocaleString()}
            <span className="ml-1 text-base font-normal text-olive">{shown.unit}</span>
          </span>
        ) : shown.kind === "withheld" ? (
          <span className="text-lg font-medium text-app-ink">withheld</span>
        ) : (
          <span className="text-lg font-medium text-app-ink">not available</span>
        )}

        {/* The provenance word, in the same visual field as the number.
            Never behind a disclosure. */}
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            shown.provenance === "modelled"
              ? "bg-state-caution-bg text-ground"
              : "bg-app-accent text-app-ink"
          }`}
          title={PROVENANCE_NOTE[shown.provenance]}
        >
          {shown.provenanceLabel}
        </span>
      </p>

      {/* Unit, period, denominator, lag — beside the value, as §6 lists them. */}
      <p className="mt-1 text-xs text-olive">
        {shown.period} · of {shown.denominator.toLocaleString()}
        {shown.materialLagDays > 0
          ? ` · lags real events by about ${shown.materialLagDays} days`
          : " · no material lag"}
      </p>

      {shown.kind === "withheld" && (
        <p className="measure mt-1 text-xs text-ground">
          {shown.reason}
          {shown.below > 0 && ` Fewer than ${shown.below}.`}
        </p>
      )}
      {shown.kind === "unavailable" && (
        <p className="measure mt-1 text-xs text-ground">{shown.reason}</p>
      )}
    </div>
  );
}
