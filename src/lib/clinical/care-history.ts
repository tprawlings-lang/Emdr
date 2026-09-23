// What a clinician did between visits, on the record where they would look for
// it.
//
// THE ACTIONS WERE WRITTEN AND NEVER READ BACK. `recordContact` writes a care
// action, `assignWork` writes another, and the only surface that read the care
// ledger filtered it to reviews — so a clinician could record three contact
// attempts and find nothing about them anywhere on the person's record. The
// rows were in the database the whole time. That is the same failure the review
// ledger was built to fix, one action type over: a rule about recording
// something needs somewhere it can be read.
//
// AND IT IS NOT THE REVIEW LEDGER WITH MORE ROWS. A review has a CURRENCY — it
// was made against evidence, and the record can move underneath it — and the
// currency policy says plainly that asking whether a phone call has gone out of
// date is not a question. Rendering both in one list would either put a
// currency label on a contact attempt or drop it from the reviews, and the
// handoff's own line is that these kinds must not be confusable.

import { CARE_ACTIONS, type CareAction, type CareActionRecord } from "./attention-vocabulary";

/**
 * The care actions this ledger is about: everything that is not a review.
 *
 * DERIVED, NOT LISTED, AND THAT IS THE FIX RATHER THAN A TIDY-UP. The four
 * names were written out by hand, and the hand missed three of the eight:
 * `record_thought`, `open_session_prep` and `review_trajectory` were in the
 * vocabulary and in neither ledger, so a clinician could record one and find
 * it nowhere. The docstring said "everything that is not a review" and the
 * list did not, which is the kind of disagreement a reader has no way to spot.
 * Now the sentence IS the list, and a ninth action joins it by existing.
 */
export const CONTACT_LEDGER_ACTIONS: readonly CareAction[] =
  CARE_ACTIONS.filter((a) => a !== "review");

/** What each one is, in a clinician's words rather than the column's. */
export const CARE_ACTION_LABEL: Record<CareAction, string> = {
  review: "Review",
  contact: "Contact attempted",
  add_followup: "Follow-up recorded",
  record_thought: "Note recorded",
  open_session_prep: "Session prep opened",
  review_trajectory: "Trajectory read",
  adjust_plan_link: "Plan link adjusted",
  resolve: "Resolved",
};

/**
 * What a contact entry may and may not be read as.
 *
 * ON THE ENTRY RATHER THAN IN THE PROSE, because this is the sentence the whole
 * feature turns on: `recordContact`'s own result says "this is not proof of
 * delivery", and a ledger that listed attempts without repeating it would let a
 * reader count rows and conclude somebody was reached.
 */
export const CONTACT_MEANING =
  "An attempt, recorded by the clinician who made it. Not proof that anybody was reached, and not " +
  "a message the person received — Steady has no delivery path.";

export interface CareHistoryEntry {
  id: string;
  action: CareAction;
  label: string;
  note: string | null;
  at: string;
  /** Set when this entry corrects an earlier one. Corrections append. */
  corrects: string | null;
  correctionReason: string | null;
  /** The owner an assignment recorded, when it recorded one. */
  owner: string | null;
}

/**
 * The history, shaped for a screen.
 *
 * Pure over records so it can be tested without a database, and so the ordering
 * and the labelling are one decision rather than one per surface.
 */
export function careHistory(records: readonly CareActionRecord[]): CareHistoryEntry[] {
  return records
    .filter((r) => CONTACT_LEDGER_ACTIONS.includes(r.action))
    .map((r) => ({
      id: r.id,
      action: r.action,
      label: CARE_ACTION_LABEL[r.action],
      note: r.note,
      at: r.completedAt,
      corrects: r.supersedesId,
      correctionReason: r.correctionReason,
      // `outcomeState` carries `owner:<id>` for an assignment. Read rather than
      // assumed: a state that does not name an owner is not an assignment, and
      // inventing one would put a name beside work nobody claimed.
      owner: r.outcomeState?.startsWith("owner:") ? r.outcomeState.slice("owner:".length) : null,
    }))
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** What an empty history means, said rather than left blank. */
export const NO_CARE_HISTORY =
  "Nothing has been recorded between visits for this person. That is a state of the record, not a " +
  "judgement about whether anything was needed.";
