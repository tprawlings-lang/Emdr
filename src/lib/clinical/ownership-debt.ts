// Work nobody has claimed, counted where somebody will see it.
//
// THE FAILURE IS THE WORD "UNNOTICED". The failure register's scenario is
// "work nobody owns builds up unnoticed", and the noticing is the part a queue
// cannot do by itself: ownership is on every row, so a clinician scanning
// twenty rows can read twenty owners and still not know that nine of them say
// nobody. A count says it in one line; twenty rows say it only to somebody who
// was already counting.
//
// IT IS COUNTED OVER THE WHOLE QUEUE, NOT THE BUCKET ON SCREEN. Pressing
// "Review today" must not change how much unclaimed work exists. A debt figure
// that moved with a filter would be read as work appearing and disappearing,
// and the one number on the screen that is supposed to be stable would be the
// least stable thing on it.
//
// WHAT THIS DELIBERATELY DOES NOT DO IS ESCALATE. Who unclaimed work falls to,
// and after how long, is an operational decision about how a service is run —
// not a constant a codebase gets to pick. So there is no threshold here, no
// "overdue for assignment", and no tone that implies one: a number and an age,
// with the absence of a rule stated on the screen rather than papered over
// with a default nobody chose. `OWNERSHIP_DEBT_LIMIT` is that sentence, kept
// beside the calculation so it cannot be dropped from the surface quietly.

import { parseStamp, type WorkItem } from "./work-queue";

/**
 * What a reader must be told alongside the number.
 *
 * ON THE MODULE, NOT IN THE PAGE, for the same reason `CONTACT_MEANING` is on
 * the care-history module: this is the sentence the figure turns on, and a
 * screen that printed the count without it would let somebody read a backlog
 * as a queue that is being worked through.
 */
export const OWNERSHIP_DEBT_LIMIT =
  "Nothing escalates. There is no rule in this build for who unclaimed work falls to, or after " +
  "how long, so it stays here until somebody assigns it. Any age shown is how long the evidence " +
  "has been waiting, not a deadline anybody has agreed.";

export interface OwnershipDebt {
  /** Every item the queue is showing, whatever bucket. */
  total: number;
  /** Items with nobody recorded as owner. */
  unowned: number;
  /** The people behind those items. Fewer than `unowned` whenever one person
   *  has two rows, which is the usual case — and counting rows alone would
   *  report a busy person as a staffing gap. */
  peopleUnowned: number;
  /** Whole days the oldest unclaimed item's evidence has been waiting, or null
   *  when nothing is unclaimed. */
  oldestWaitDays: number | null;
  /** That item's person, so the number leads somewhere rather than sitting
   *  there. Null when nothing is unclaimed. */
  oldestPersonName: string | null;
}

const DAY_MS = 86_400_000;

/**
 * Count it.
 *
 * OWNERSHIP IS THE NAME, NOT THE ID. A row carries an owner id and an owner
 * name, and the two disagree in a case this product has already shipped once:
 * an id that resolves to no name renders as unassigned, so a count keyed on the
 * id would have read zero debt while every row on screen said Unassigned. The
 * count has to agree with what the reader is looking at.
 */
export function ownershipDebt(items: readonly WorkItem[], now: Date): OwnershipDebt {
  const unowned = items.filter((i) => !i.ownerName);
  let oldest: WorkItem | null = null;
  for (const i of unowned) {
    if (!oldest || parseStamp(i.evidenceAt) < parseStamp(oldest.evidenceAt)) oldest = i;
  }
  return {
    total: items.length,
    unowned: unowned.length,
    peopleUnowned: new Set(unowned.map((i) => i.personId)).size,
    oldestWaitDays: oldest
      ? Math.max(0, Math.floor((now.getTime() - parseStamp(oldest.evidenceAt)) / DAY_MS))
      : null,
    oldestPersonName: oldest?.personName ?? null,
  };
}

/**
 * The sentence the panel leads with.
 *
 * WRITTEN HERE SO IT CANNOT SAY SOMETHING THE NUMBERS DO NOT. "All of it" and
 * "none of it" are different findings from "nine of thirty-five", and a
 * template that interpolated a count into one fixed sentence would eventually
 * render "0 of 0 items have no owner" on a clear day — which reads as a fault.
 */
export function ownershipDebtStatement(d: OwnershipDebt): string {
  if (d.total === 0) return "There is nothing on the queue to own.";
  if (d.unowned === 0) return "Everything on the queue has somebody recorded against it.";
  const people = d.peopleUnowned === 1 ? "1 person" : `${d.peopleUnowned} people`;
  const items = d.unowned === 1 ? "1 item" : `${d.unowned} items`;
  return d.unowned === d.total
    ? `Nothing on this queue has an owner — ${items}, across ${people}.`
    : `${items} of ${d.total} have no owner, across ${people}.`;
}
