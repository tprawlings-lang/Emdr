// What makes an action on a queue row wrong (17 September handoff, queue
// stability).
//
//   "Revalidate consequential actions against current server state."
//   "Do not move a row beneath a pointer while an action is being taken."
//
// THE CHECK EXISTED AND WAS DISABLED. `completeReview` compares the version the
// reader's page was built from against the one the server holds now, and
// returns `stale` rather than acknowledging on top of somebody else's decision.
// The queue passed `expectedVersion={null}` at both call sites, and the
// comparison is written `if (command.expectedVersion && …)` — so the guard
// short-circuited on every request since it was written. Two clinicians could
// each complete a review of the same row and neither would be told.
//
// SO THE VERSION IS COMPUTED IN ONE PLACE, and that is the point of this
// module rather than an expression at each end. The surface has to send the
// same string the action recomputes; a version built from `lastDetectedAt` in
// the queue and `evidenceAt` in the action would look right, compile, and
// reject every action a clinician ever took. Those are two real fields on the
// same signal and they differ.
//
// A VERSION IS NOT A TIMESTAMP. It is whatever changing would make the reader's
// decision wrong: for a signal, its state and the evidence it was evaluated
// against; for a safety alert, which alerts are open. Something that changed
// without changing the decision — a display name, an owner's initials — is
// deliberately not in it, because a version that moves for cosmetic reasons
// trains people to press through the warning.

/** The parts of a signal a version rests on. Structural, so this module needs
 *  no import and stays usable from a client component. */
export interface VersionedSignal {
  state: string;
  /** The cutoff the provider evaluated against — NOT `lastDetectedAt`. */
  evidenceAt: string;
}

/** The version of a row that came from an attention signal. */
export function signalRowVersion(s: VersionedSignal): string {
  return `${s.state}@${s.evidenceAt}`;
}

/** The parts of an alert a version rests on. */
export interface VersionedAlert {
  id: string;
  status: string;
}

/**
 * The version of a row that came from safety alerts.
 *
 * Over the ids AND their statuses, sorted, because the decision a clinician is
 * about to take is "close what is open for this person". An alert closed by
 * somebody else between the page rendering and the button being pressed is
 * exactly the collision this catches, and an alert raised in that window is
 * one the reader has not seen.
 */
export function alertRowVersion(alerts: ReadonlyArray<VersionedAlert>): string {
  const parts = alerts
    .map((a) => `${a.id}:${a.status}`)
    .sort()
    .join(",");
  return `alerts@${parts}`;
}

/**
 * Why a caseload-derived row carries no version.
 *
 * Recorded as a value rather than left as an absence somebody has to explain
 * later. A caseload row is a person the model surfaced — days since contact,
 * unresolved distress — and completing a review of one closes nothing and
 * changes nothing: the row is still there tomorrow because what raised it has
 * not changed. There is no state for a second clinician to collide with, so a
 * version would be a warning that could only ever be a false alarm.
 */
export const CASELOAD_ROW_HAS_NO_VERSION =
  "A caseload row records a review and changes nothing, so there is no state for a " +
  "concurrent decision to collide with.";
