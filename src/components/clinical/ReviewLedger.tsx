import { REVIEW_CURRENCY_LABEL, REVIEW_CURRENCY_POLICY, type ReviewWithCurrency } from "@/lib/clinical/review-currency";

// Reviews recorded on this person, and whether each still describes the record
// (17 September handoff, completion semantics).
//
//   "If material evidence changes later, the interface should identify the
//   earlier review as out of date under an approved policy."
//
// THERE WAS NO INTERFACE. `careActionsForPerson` had no caller anywhere in the
// product: reviews were written to the care-time ledger and never read back, so
// a completed review was something the queue acted on and nobody could see. A
// rule about identifying stale reviews needs somewhere to identify them.
//
// A REVIEW IS NOT WRONG WHEN IT GOES OUT OF DATE, and the copy is careful about
// that. The clinician decided what they decided on what they had; the record
// moved afterwards. Saying "out of date" where the honest meaning is "reviewed
// before newer evidence" would read as a criticism of a colleague's judgement,
// and a label people read as an accusation is a label they learn to dismiss.

const TONE: Record<string, string> = {
  current: "text-state-safe",
  out_of_date: "text-state-caution",
  unknown: "text-olive",
};

export function ReviewLedger({ reviews }: { reviews: ReviewWithCurrency[] }) {
  if (reviews.length === 0) {
    return (
      <section aria-labelledby="reviews" className="mt-8">
        <h2 id="reviews" className="type-display text-lg font-medium text-ground">
          Recorded reviews
        </h2>
        {/* Absence with a name, again: nobody having reviewed this person is a
            different fact from the ledger being unreadable. */}
        <p className="measure mt-2 text-sm text-olive">
          Nobody has recorded a review of this person yet. That is a state of the record, not a
          judgement about whether one is needed.
        </p>
      </section>
    );
  }

  const stale = reviews.filter((r) => r.currency.state === "out_of_date").length;

  return (
    <section aria-labelledby="reviews" className="mt-8">
      <h2 id="reviews" className="type-display text-lg font-medium text-ground">
        Recorded reviews{" "}
        <span className="text-base font-normal text-olive">({reviews.length})</span>
      </h2>
      <p className="mt-1 measure text-sm text-olive">
        {stale > 0
          ? `${stale} of these ${stale === 1 ? "was" : "were"} made before evidence that has arrived since. ` +
            "The decision stands; it no longer describes the current record."
          : "Each review records the newest evidence it was made against, so it can be told later whether the record has moved."}
      </p>

      <ul className="mt-3 space-y-3">
        {reviews.map((r) => (
          <li key={r.id} className="rounded-3xl border border-ground/10 bg-linen p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-ground">
                Reviewed {r.completedAt.slice(0, 16)}
              </p>
              <p className={`text-xs font-semibold ${TONE[r.currency.state] ?? "text-olive"}`}>
                {/* Word, never colour alone. */}
                {REVIEW_CURRENCY_LABEL[r.currency.state]}
              </p>
            </div>
            {r.note && <p className="measure mt-1 text-sm text-ground/90">{r.note}</p>}
            <p className="measure mt-2 text-xs text-olive">{r.currency.because}</p>
            <p className="mt-1 text-xs text-olive">
              {r.nextResponsibleParty
                ? `Held next by ${r.nextResponsibleParty.slice(0, 8)}.`
                : /* A completion that names nobody leaves the person between two
                     people, and saying so is more use than leaving it blank. */
                  "No next responsible party was recorded."}
              {r.currency.state !== "unknown" && ` Under ${r.currency.policyVersion}.`}
            </p>
          </li>
        ))}
      </ul>

      <p className="measure mt-3 text-xs text-olive">
        A review is counted as out of date when {REVIEW_CURRENCY_POLICY.materialChange.toLowerCase()}
      </p>
    </section>
  );
}
