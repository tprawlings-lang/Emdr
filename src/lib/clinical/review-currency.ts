// Whether an earlier review still describes the evidence (17 September handoff,
// "Completion semantics").
//
//   "A completion record should contain the actor, reviewed evidence version,
//   action and reason, resulting workflow state, next responsible party, and
//   timestamp. IF MATERIAL EVIDENCE CHANGES LATER, THE INTERFACE SHOULD IDENTIFY
//   THE EARLIER REVIEW AS OUT OF DATE UNDER AN APPROVED POLICY."
//
// THE FAILURE THIS PREVENTS is the one a queue is most prone to. A clinician
// reviews somebody on Monday against what was on the record then, and the row
// leaves the queue. On Wednesday a check-in arrives that would have changed
// their mind. Nothing raises it, because the item was reviewed — and "reviewed"
// is being read as a property of the PERSON when it was a statement about a
// moment. The review is still true; it is just no longer about the current
// record.
//
// SO A REVIEW IS BOUND TO THE EVIDENCE IT WAS MADE AGAINST, which is the same
// mechanism as the clinical-approval hash one directory over: an attestation
// that cannot go stale is an attestation nobody can rely on. A review records
// the newest evidence it saw; evidence arriving after that makes it out of
// date, and the product says so rather than letting the reader assume.
//
// THREE STATES, NOT TWO. A review recorded before this existed carries no
// evidence version, and neither available verdict is honest about it: calling
// it current is a claim nobody checked, and calling it out of date is a false
// alarm on every historical row. `unknown` says what is actually known.
//
// NOT A SWEEP, NOT A JOB. Computed on read, like an overdue alert, so a review
// that went stale overnight reads as stale on the next screen rather than on
// the next run of something.

/** The rule, versioned, because the handoff asks for "an approved policy" and
 *  an unnamed rule cannot be approved, cited or changed deliberately. */
export const REVIEW_CURRENCY_POLICY = {
  id: "review-currency",
  version: "review-currency-2026-09-v1",
  /** What counts as material, in one sentence a reviewer can agree or disagree with. */
  materialChange:
    "Evidence recorded for this person after the newest evidence the reviewer had in front of them.",
  /** Deliberately excluded, so the boundary is visible rather than assumed. */
  excludes: [
    "A change of clinical policy version on its own. A policy bump would mark every review on " +
    "the caseload out of date on the same morning, which trains people to dismiss the label.",
    "The passage of time on its own. A review does not expire; it stops describing the record " +
    "when the record moves.",
  ],
} as const;

export type ReviewCurrencyState = "current" | "out_of_date" | "unknown";

export interface ReviewCurrency {
  state: ReviewCurrencyState;
  /** Why, in words a clinician can act on. */
  because: string;
  /** The policy that decided it, so a reader can find the rule. */
  policyVersion: string;
  /** The newest evidence the reviewer saw. Null when the review predates this. */
  reviewedEvidenceAt: string | null;
  /** The newest evidence now. Null when the person has none. */
  newestEvidenceAt: string | null;
}

/**
 * Is this review still about the current record?
 *
 * Takes stamps rather than rows so it can be called with a literal, and so the
 * comparison is one function rather than a rule re-implemented per surface.
 */
export function reviewCurrency(args: {
  /** What the review recorded as the newest evidence it saw. */
  reviewedEvidenceAt: string | null;
  /** The newest evidence on the record now. */
  newestEvidenceAt: string | null;
}): ReviewCurrency {
  const { reviewedEvidenceAt, newestEvidenceAt } = args;
  const base = {
    policyVersion: REVIEW_CURRENCY_POLICY.version,
    reviewedEvidenceAt,
    newestEvidenceAt,
  };

  if (!reviewedEvidenceAt) {
    return {
      ...base,
      state: "unknown",
      because:
        "This review did not record which evidence it was made against, so whether the record " +
        "has moved since cannot be answered. It is not being called current.",
    };
  }

  if (!newestEvidenceAt) {
    // Reviewed against something, and now there is nothing — a rebuild, a
    // deletion, or a read that failed. Not "current", because the comparison
    // could not be made.
    return {
      ...base,
      state: "unknown",
      because:
        "No evidence can be read for this person now, so this review cannot be compared against " +
        "the record. Treat the absence as unread rather than as unchanged.",
    };
  }

  // STRING COMPARISON, on purpose. Both stamps are the repository's
  // `YYYY-MM-DD HH:MM:SS`, which sorts correctly as text, and parsing them into
  // dates here would introduce a timezone question that the stored format does
  // not have.
  if (newestEvidenceAt > reviewedEvidenceAt) {
    return {
      ...base,
      state: "out_of_date",
      because:
        `Evidence recorded ${newestEvidenceAt} arrived after the ${reviewedEvidenceAt} reading ` +
        "this review was made against. The review is still what was decided; it no longer " +
        "describes the current record.",
    };
  }

  return {
    ...base,
    state: "current",
    because: `Nothing has been recorded for this person since ${reviewedEvidenceAt}.`,
  };
}

/** What to show beside an out-of-date review. Here rather than on each surface
 *  so two screens cannot describe the same state differently. */
export const REVIEW_CURRENCY_LABEL: Record<ReviewCurrencyState, string> = {
  current: "Review is current",
  out_of_date: "Reviewed before newer evidence",
  unknown: "Cannot tell whether this review is current",
};

/** A recorded review with the verdict on whether it still describes the record. */
export interface ReviewWithCurrency {
  id: string;
  completedAt: string;
  clinicianPersonId: string;
  note: string | null;
  nextResponsibleParty: string | null;
  currency: ReviewCurrency;
}

/**
 * Apply the rule to a person's recorded reviews.
 *
 * Takes the records and the current evidence stamp rather than reading either,
 * so the rule can be exercised with literals and so the caller decides how far
 * back to look.
 */
export function reviewsWithCurrency(
  records: ReadonlyArray<{
    id: string;
    completedAt: string;
    clinicianPersonId: string;
    action: string;
    note: string | null;
    nextResponsibleParty: string | null;
    reviewedEvidenceAt: string | null;
  }>,
  newestEvidenceAt: string | null
): ReviewWithCurrency[] {
  return records
    // Only reviews. The ledger also holds contacts and corrections, and asking
    // whether a phone call has gone out of date is not a question.
    .filter((r) => r.action === "review")
    .map((r) => ({
      id: r.id,
      completedAt: r.completedAt,
      clinicianPersonId: r.clinicianPersonId,
      note: r.note,
      nextResponsibleParty: r.nextResponsibleParty,
      currency: reviewCurrency({
        reviewedEvidenceAt: r.reviewedEvidenceAt,
        newestEvidenceAt,
      }),
    }));
}
