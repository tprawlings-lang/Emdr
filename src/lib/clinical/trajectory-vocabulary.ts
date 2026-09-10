// The review vocabulary, split out so a client component can read it.
//
// The same split as intervention-vocabulary, response-vocabulary and
// attention-vocabulary, and for the same reason: a client component importing
// the engine pulls better-sqlite3 into the browser bundle and the build stops.
// Words that appear on a screen belong on the client side of that line; the
// rules that use them stay on the server side.

export const REVIEW_STATES = ["reviewed", "agreed", "disagreed", "needs_context"] as const;
export type TrajectoryReviewState = (typeof REVIEW_STATES)[number];

/** How each option is put to a clinician. None of them is "dismiss": a
 *  disagreement is recorded beside the state, and the state stays. */
export const REVIEW_LABEL: Record<TrajectoryReviewState, string> = {
  reviewed: "Read it",
  agreed: "Agrees with it",
  disagreed: "Disagrees with it",
  needs_context: "Needs context Steady does not have",
};
