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

/**
 * What actually changed, in words a clinician can act on.
 *
 * 17 September handoff, P6: "Clinician acts on stale evidence → DETECT THE
 * VERSION MISMATCH AND SHOW THE RELEVANT CHANGE." Detection was built; the
 * showing was a version string. A reader told "the queue now holds
 * open@2026-09-12T08:00:00Z" has been given the evidence that something moved
 * and none of the information they need, so the honest response to the warning
 * is to press through it — which is the behaviour a version check exists to
 * prevent.
 *
 * TWO KINDS OF CHANGE MEAN DIFFERENT THINGS, and a reader has to be able to
 * tell them apart before deciding whether to look again. Somebody else acting
 * is a question about coordination: the work may be done. New evidence arriving
 * is a question about the decision itself: what you read is not what the record
 * now says.
 *
 * Returns null when the two versions are equal, so a caller cannot produce a
 * conflict sentence for a row that did not move.
 */
export function explainVersionChange(expected: string, current: string): string | null {
  if (expected === current) return null;

  const before = parseSignalVersion(expected);
  const after = parseSignalVersion(current);
  if (before && after) {
    if (before.state !== after.state && before.evidenceAt !== after.evidenceAt) {
      return (
        `Both moved: this is now ${readable(after.state)}, and evidence newer than the reading you ` +
        `were shown arrived (${day(after.evidenceAt)}).`
      );
    }
    if (before.state !== after.state) {
      return `Somebody else acted: this is now ${readable(after.state)}.`;
    }
    return (
      `New evidence arrived after the reading you were shown (${day(after.evidenceAt)}). ` +
      "The decision in front of you was made against the older one."
    );
  }

  const beforeAlerts = parseAlertVersion(expected);
  const afterAlerts = parseAlertVersion(current);
  if (beforeAlerts && afterAlerts) {
    const closed = beforeAlerts.filter(
      (a) => afterAlerts.find((b) => b.id === a.id)?.status !== a.status && a.status === "open",
    ).length;
    const added = afterAlerts.filter((b) => !beforeAlerts.some((a) => a.id === b.id)).length;
    if (added > 0 && closed > 0) {
      return `${closed} alert(s) were closed and ${added} raised since this page was built.`;
    }
    if (added > 0) {
      return `${added} safety alert(s) were raised after this page was built, which you have not seen.`;
    }
    if (closed > 0) {
      return `${closed} of the alerts you were shown have been closed by somebody else.`;
    }
    return "The safety alerts on this person changed after this page was built.";
  }

  // DIFFERENT SHAPES, WHICH IS NOT A COMPARISON. A signal version against an
  // alert version means the row itself became a different kind of row, and
  // guessing at a sentence for that would be inventing a change.
  return "This row is no longer the same item it was when the page was built.";
}

function parseSignalVersion(v: string): { state: string; evidenceAt: string } | null {
  if (v.startsWith("alerts@")) return null;
  const at = v.indexOf("@");
  if (at <= 0) return null;
  return { state: v.slice(0, at), evidenceAt: v.slice(at + 1) };
}

function parseAlertVersion(v: string): Array<{ id: string; status: string }> | null {
  if (!v.startsWith("alerts@")) return null;
  const body = v.slice("alerts@".length);
  if (!body) return [];
  return body.split(",").map((p) => {
    const i = p.lastIndexOf(":");
    return { id: p.slice(0, i), status: p.slice(i + 1) };
  });
}

function readable(state: string): string {
  return state.replace(/_/g, " ");
}

/** A date a person reads, from a version that holds a timestamp. Falls back to
 *  the raw value rather than printing "Invalid Date" over a real difference. */
function day(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toISOString().slice(0, 10);
}
