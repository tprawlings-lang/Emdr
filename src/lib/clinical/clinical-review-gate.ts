// Features awaiting their own clinical review (handoff 09 §10.1).
//
// §10.1: "Therapeutic Load and Readiness may plug into the clinician
// task-provider contract AFTER its own clinical review. This handoff must not
// invent its state or thresholds."
//
// FOUND BY READING §10.1 AGAINST THE CODE, and it was live. The
// therapeutic-load provider was registered unconditionally, so
// `therapeutic_load.stabilize` and `therapeutic_load.consider_progression`
// were reaching the clinician attention queue as work — before the ratifying
// review that sentence requires. Nothing was wrong with the states; what was
// wrong was that a clinician was being handed them as a reason to act while
// the review establishing they are safe to act on had not happened.
//
// THE SURFACE IS NOT WHAT §10.1 GATES. `/clinician/member/[id]/load` stays: it
// is inside this environment, it is reachable only by opening a person, and it
// says on the screen what it is. The sentence is specifically about the
// TASK-PROVIDER CONTRACT — the thing that turns a reading into a row in
// somebody's queue — and that is the difference between a clinician choosing
// to look and a clinician being told to.
//
// WITHHELD RATHER THAN SILENT — BUT NOT IN THE COVERAGE NOTE. §9's coverage
// exists so an empty queue can be told apart from a broken one, and a feature
// that quietly returns nothing defeats it. The provider does stay registered
// and does run: a held provider lands in `coverage.ran` having produced no
// candidates, which is honest but says "found nothing", not "not cleared" —
// `ProviderCoverage` has two buckets, `ran` and `failed`, and a hold is
// neither. Giving it a third would change a contract with a published
// conformance check and a version, which is more than §10.1 asks for.
//
// So the withholding is stated where a reader goes to ask what is missing:
// /review/status names this feature and what it withholds, from
// `AWAITING_CLINICAL_REVIEW` below, and tests/delivery-sequence.test.ts holds
// that surface to it. If the registry ever grows a `held` bucket, that is the
// better home and this list is what fills it.
//
// HOW THIS CLEARS. A ratifying clinical reviewer records the review, and the
// constant below becomes true with the review named beside it — the same shape
// as the member score exception in src/lib/experience/member-projection.ts,
// where a boolean without an authority is not evidence of anything.

export interface ClinicalReviewState {
  /** Whether a ratifying review has been recorded. */
  reviewed: boolean;
  /** Who recorded it, and when. Empty while `reviewed` is false — a review
   *  with no author is not a review. */
  authority: string;
  /** Where the record lives. */
  evidence: string;
  /** What is withheld until it is done, in the reviewer's terms. */
  withholds: string;
}

/**
 * Therapeutic Load & Readiness.
 *
 * Flipping `reviewed` to true is a clinical act, not a code change: whoever
 * does it also fills in `authority` and `evidence`, and the guard checks that
 * a reviewed state carries both. A `true` with an empty authority is how this
 * mechanism would quietly stop meaning anything.
 */
export const THERAPEUTIC_LOAD_REVIEW: ClinicalReviewState = {
  reviewed: false,
  authority: "",
  evidence: "",
  withholds:
    "Therapeutic Load states do not enter the clinician attention queue. The reading stays " +
    "readable on the person's Load screen, where a clinician chooses to open it.",
};

/** Whether a feature may plug into the task-provider contract. */
export function mayEnterTaskQueue(review: ClinicalReviewState): boolean {
  // A review that claims to be done without saying who did it does not count.
  // The alternative is a boolean somebody sets to unblock a demo.
  return review.reviewed && review.authority.trim().length > 0 && review.evidence.trim().length > 0;
}

/** Every feature this gate holds, for the surfaces that report what is
 *  withheld and why. */
export const AWAITING_CLINICAL_REVIEW: ReadonlyArray<{ feature: string; review: ClinicalReviewState }> = [
  { feature: "Therapeutic Load & Readiness", review: THERAPEUTIC_LOAD_REVIEW },
];
