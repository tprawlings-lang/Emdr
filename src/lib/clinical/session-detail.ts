// One session's event sequence, with where each line came from (17 September
// handoff, P4).
//
//   "Session detail — order events and connect notes to their sources.
//   Timeline and provenance are understandable."
//
// THE TIMES WERE PARTLY INVENTED. The sequence was assembled from the session
// row alone, and three of its lines had no recorded time of their own, so they
// borrowed one: "Highest during the session" was stamped with `started_at` and
// rendered in a monospace clock column beside lines that really did happen
// then. A reader counting down that column saw the peak occurring at the moment
// the session opened. A time nobody recorded is not a small inaccuracy on a
// screen whose heading is "what happened".
//
// THE POST-SESSION CHECK WAS MISSING ENTIRELY. It is a separate row, written
// later, with a real timestamp — how the person was in the hours afterwards,
// whether they felt safe that night, whether anything escalated. On a screen
// called Session response, it is arguably the response.
//
// AND EVERY LINE NOW NAMES ITS SOURCE. "Distress after: 3 of 10" and "Safe
// tonight: yes" are both facts about the same session and they come from
// different records, written at different moments by different people. Which
// is which is the provenance the handoff asks for, and it is not recoverable
// from the sentences.

export type EventSource = "session_record" | "post_session_check" | "safety_rule";

export const SOURCE_LABEL: Record<EventSource, string> = {
  session_record: "from the session record",
  post_session_check: "from the check afterwards",
  safety_rule: "from a fixed safety rule",
};

export interface SessionEvent {
  /** The event's own time, or null when nothing recorded one. */
  at: string | null;
  text: string;
  source: EventSource;
  /** Where it sits in the reading order when it has no time of its own. */
  order: number;
}

export interface SessionRow {
  id: string;
  moduleId: string;
  moduleName: string;
  status: string;
  preSuds: number | null;
  postSuds: number | null;
  peakSuds: number | null;
  hardStopReason: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface PostSessionCheck {
  id: string;
  distress: number;
  oriented: boolean;
  safeTonight: boolean;
  delayedRisk: number;
  recoveryConfirmed: boolean;
  escalated: boolean;
  createdAt: string;
}

const yesNo = (v: boolean) => (v ? "yes" : "no");

/**
 * The sequence, in reading order, with provenance.
 *
 * Pure: the caller loads the rows. Nothing here reads a clock — an event with
 * no recorded time gets `at: null` and says so on screen rather than being
 * given the session's.
 */
export function sessionEvents(
  s: SessionRow, checks: ReadonlyArray<PostSessionCheck>
): SessionEvent[] {
  const out: SessionEvent[] = [];
  let n = 0;
  const push = (at: string | null, text: string, source: EventSource) =>
    out.push({ at, text, source, order: n++ });

  push(s.startedAt, `Session started — ${s.moduleName}`, "session_record");
  if (s.preSuds !== null) {
    // Taken at the open, which is a real time rather than a borrowed one.
    push(s.startedAt, `Distress before: ${s.preSuds} of 10`, "session_record");
  }
  if (s.peakSuds !== null) {
    // NO TIME. The peak is a number on the session row; when it happened was
    // never recorded, and stamping it with the session's start put it before
    // the first minute of the session in the column a reader counts down.
    push(null, `Highest during the session: ${s.peakSuds} of 10`, "session_record");
  }
  if (s.hardStopReason) {
    push(
      s.endedAt,
      `Fixed rule ended the session — ${s.hardStopReason}. No model made or cleared this.`,
      "safety_rule",
    );
  }
  if (s.postSuds !== null) {
    push(s.endedAt, `Distress after: ${s.postSuds} of 10`, "session_record");
  }
  if (s.endedAt) push(s.endedAt, "Session ended", "session_record");

  for (const check of [...checks].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    push(
      check.createdAt,
      `Checked afterwards: distress ${check.distress} of 10, oriented ${yesNo(check.oriented)}, ` +
      `safe tonight ${yesNo(check.safeTonight)}, risk in the hours after ${check.delayedRisk} of 10` +
      (check.escalated ? " — escalated." : "."),
      "post_session_check",
    );
  }

  return out;
}

/**
 * What the sequence does NOT establish, in words.
 *
 * A session with no close reading and a session whose reading did not move look
 * identical in a column of numbers, and only one of them is a measurement.
 */
export function sequenceGaps(s: SessionRow, checks: ReadonlyArray<PostSessionCheck>): string[] {
  const out: string[] = [];
  if (s.preSuds === null || s.postSuds === null) {
    out.push(
      "Distress was not recorded on both sides of this session, so there is no before-and-after " +
      "to read. That is a missing measurement, not a zero change."
    );
  }
  if (s.peakSuds !== null) {
    out.push("Nothing recorded when the highest reading happened, only that it was the highest.");
  }
  if (s.endedAt === null) {
    out.push("This session has no recorded ending, so everything after it is undated.");
  }
  if (checks.length === 0) {
    out.push("No check was recorded after this session, so how the hours afterwards went is unknown.");
  }
  return out;
}
