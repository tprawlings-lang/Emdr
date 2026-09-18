// Reviewing the generated care plan, beside the plan (17 September handoff, P4).
//
//   "Care plan — place the permitted review action beside the plan. User does
//   not hunt through the full record."
//
// The plan screen ended with a sentence: "Approve or correct it on the full
// record, where the action is audited." That is the hunt, written down. It also
// pointed at the wrong thing — the control on the full record approves the
// generated SUMMARY, a different artefact with different evidence under it, so
// a clinician who followed the instruction would have attested to something
// they were not looking at.
//
// WHAT IS PERMITTED HERE, AND ONLY THIS. A clinician can record that they have
// read the plan and accept it. They cannot edit it: the plan is produced by
// fixed rules from the person's state, and a hand-edited copy would be a plan
// the rules would overwrite and the member would stop seeing. They cannot
// change access from here either — the safety engine decides that, elsewhere,
// on its own rules.
//
// AND THE REVIEW IS BOUND TO THE VERSION IT WAS MADE AGAINST, through the same
// currency policy the work queue uses. A plan regenerated after a review is a
// different plan; the approval stays true about the version it saw and stops
// describing the one on screen, and the screen says so.

import { readEvents } from "../events";
import { reviewCurrency, type ReviewCurrency } from "./review-currency";

/** The subject recorded on the review event. One constant, because the write
 *  and the read have to agree and a typo would silently produce a plan that
 *  has never been reviewed. */
export const PLAN_REVIEW_SUBJECT = "program_plan";

/** What approving the plan does, and what it does not touch. Rendered beside
 *  the control, because an action whose consequences are on another screen is
 *  the problem this whole item is about. */
export const PLAN_REVIEW_MEANS = {
  does: "Records that you have read this plan and accept it, against the version shown above.",
  doesNot: [
    "It does not change the plan. The plan is produced by fixed rules from this person's state; nothing here edits it.",
    "It does not open or close anything. Access is decided by the safety engine on its own rules, and no review here reaches it.",
    "It does not reach the member. They see the same plan and the same status label either way.",
  ],
} as const;

export interface PlanReviewRecord {
  eventId: string;
  at: string;
  clinicianId: string | null;
  note: string | null;
  /** The plan version the reviewer had in front of them. Null for a review
   *  recorded before this was stored. */
  planVersion: string | null;
}

export interface PlanReviewStanding {
  review: PlanReviewRecord | null;
  currency: ReviewCurrency | null;
  /** The whole state, in one sentence. */
  said: string;
}

/** The most recent review of this person's plan. */
export async function lastPlanReview(args: {
  personId: string; tenantId: string;
}): Promise<PlanReviewRecord | null> {
  const events = await readEvents({
    personId: args.personId, tenantId: args.tenantId, types: ["clinician.reviewed"],
  });
  const mine = events.filter((e) => e.payload?.subject === PLAN_REVIEW_SUBJECT);
  const last = mine[mine.length - 1];
  if (!last) return null;
  const at = String(last.payload?.evidenceAt ?? "");
  return {
    eventId: last.id,
    at: last.occurred_at,
    clinicianId: last.actor_id,
    note: typeof last.payload?.note === "string" ? last.payload.note : null,
    planVersion: at || null,
  };
}

/**
 * Where the plan's review stands against the plan on screen.
 *
 * `planVersion` is the plan's own generated-at. A regenerated plan is a
 * different plan, and an approval of the previous one is still true about that
 * one — it has simply stopped describing this.
 */
export function planReviewStanding(
  review: PlanReviewRecord | null, planVersion: string | null
): PlanReviewStanding {
  if (!review) {
    return {
      review: null, currency: null,
      // NOT "not approved". Nobody has been asked to approve it, and a plan
      // produced by rules is not waiting on a signature to be in force.
      said: "Nobody has recorded reading this plan.",
    };
  }
  const currency = reviewCurrency({
    reviewedEvidenceAt: review.planVersion,
    newestEvidenceAt: planVersion,
  });
  const when = review.at.slice(0, 10);
  if (currency.state === "current") {
    return { review, currency, said: `Read and accepted on ${when}, against this version of the plan.` };
  }
  if (currency.state === "out_of_date") {
    return {
      review, currency,
      said: `Read and accepted on ${when}, against an earlier version. The plan has been regenerated since.`,
    };
  }
  return {
    review, currency,
    said: `Read and accepted on ${when}. Which version it was read against was not recorded.`,
  };
}
