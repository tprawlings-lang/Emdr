// The last session, in a line (17 September handoff, P4).
//
//   "Patient overview — summarize changes, restrictions, work, goals, and
//   recent session. Next work is clear without opening many pages."
//
// Four of those five were on the overview. The recent session was not: the page
// carried a trajectory card, a load and safety card, a work queue and an
// engagement strip, and nowhere on it did it say when this person was last in a
// session, which module it was, or how it ended. The engagement strip counts
// session DAYS — "0 carry a session" — which is a different fact and reads as
// one on a page where every other panel is about the last three weeks.
//
// WHAT THE LINE HAS TO CARRY is what a clinician asks before opening the record:
// which module, how long ago, and whether it finished. A session that stopped
// early is the case the whole surface exists for, and it looks identical to a
// completed one in a count.
//
// AND WHAT IT MUST NOT DO is judge it. A hard stop is a session that ended when
// somebody decided to end it, which is the system working; "incomplete" would
// read as a failure of the person or of the clinician, and it is neither.

import { data } from "../data";
import { getModule } from "../modules";

export type SessionStanding = "completed" | "stopped_early" | "unfinished" | "in_progress";

export interface RecentSession {
  id: string;
  moduleId: string;
  moduleName: string;
  status: string;
  standing: SessionStanding;
  startedAt: string;
  endedAt: string | null;
  preSuds: number | null;
  postSuds: number | null;
  peakSuds: number | null;
  hardStopReason: string | null;
  /** Days between the session and the reading frame. */
  daysSince: number | null;
  /** Module, when, and how it ended. */
  said: string;
  /** The reading at open and close, or why there is none. */
  readings: string;
  /** What is unresolved about it, if anything. Null when nothing is. */
  outstanding: string | null;
}

interface Row {
  id: string; module_id: string; status: string;
  pre_suds: number | null; post_suds: number | null; peak_suds: number | null;
  hard_stop_reason: string | null; started_at: string; ended_at: string | null;
}

const DAY = 86400000;

/** Calendar days, like every other age on a clinician screen. Counting elapsed
 *  hours makes a session at 23:00 last night "today" and the same session at
 *  09:00 "1 day ago", and made this card disagree with Session Prep by one
 *  about the same session. */
function days(from: string, to: string): number | null {
  const day = (t: string) => Date.parse(`${t.slice(0, 10)}T00:00:00Z`);
  const a = day(from.includes("T") ? from : from.replace(" ", "T"));
  const b = day(to.includes("T") ? to : to.replace(" ", "T"));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / DAY));
}

function ago(n: number | null): string {
  if (n === null) return "";
  if (n === 0) return "today";
  if (n === 1) return "yesterday";
  return `${n} days ago`;
}

export function standingOf(status: string, endedAt: string | null): SessionStanding {
  if (status === "completed") return "completed";
  if (status === "hard_stop") return "stopped_early";
  if (status === "in_progress" && endedAt === null) return "in_progress";
  return "unfinished";
}

/** How a standing is named. Never a grade: a session that stopped is the safety
 *  system working, and "incomplete" reads as somebody's failure. */
export const STANDING_LABEL: Record<SessionStanding, string> = {
  completed: "ran to the end",
  stopped_early: "stopped early",
  unfinished: "has no recorded ending",
  in_progress: "is still open",
};

export function describeSession(row: {
  moduleName: string; standing: SessionStanding; startedAt: string; daysSince: number | null;
}): string {
  const when = row.daysSince === null
    ? row.startedAt.slice(0, 10)
    : `${ago(row.daysSince)}, ${row.startedAt.slice(0, 10)}`;
  return `${row.moduleName}, ${when} — ${STANDING_LABEL[row.standing]}.`;
}

export function describeReadings(row: {
  preSuds: number | null; postSuds: number | null; peakSuds: number | null;
}): string {
  if (row.preSuds === null && row.postSuds === null) {
    // NOT "0 to 0". A session nobody took a reading in is a different fact from
    // a session where the reading did not move.
    return "No reading was recorded at either end.";
  }
  if (row.postSuds === null) {
    return `Opened at ${row.preSuds}. No close reading, so the change across it is unknown.`;
  }
  if (row.preSuds === null) {
    return `Closed at ${row.postSuds}. No opening reading, so the change across it is unknown.`;
  }
  const peak = row.peakSuds !== null ? `, peaking at ${row.peakSuds}` : "";
  return `${row.preSuds} at the start, ${row.postSuds} at the end${peak}. The reading, not an outcome.`;
}

export function outstandingOn(row: {
  standing: SessionStanding; hardStopReason: string | null;
  preSuds: number | null; postSuds: number | null;
}): string | null {
  if (row.standing === "in_progress") return "This session is still open.";
  if (row.standing === "stopped_early") {
    return row.hardStopReason
      ? `Stopped: ${row.hardStopReason}`
      : "Stopped early, with no reason recorded.";
  }
  if (row.standing === "unfinished") return "It has no recorded ending.";
  if (row.postSuds === null) return "No close reading was recorded.";
  return null;
}

/**
 * The most recent session on file, or null.
 *
 * `asOf` is the caller's reading frame, so "three days ago" moves with the demo
 * clock like every other age on a clinician screen.
 */
export async function recentSession(
  personId: string, args: { asOf: string }
): Promise<RecentSession | null> {
  const c = await data();
  const row = (await c.get(
    `SELECT id, module_id, status, pre_suds, post_suds, peak_suds, hard_stop_reason,
            started_at, ended_at
       FROM therapy_sessions WHERE user_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1`,
    [personId]
  )) as Row | undefined;
  if (!row) return null;

  const moduleName = getModule(row.module_id)?.name ?? row.module_id;
  const standing = standingOf(row.status, row.ended_at);
  const daysSince = days(row.started_at, args.asOf);
  const base = {
    moduleName, standing, startedAt: row.started_at, daysSince,
    preSuds: row.pre_suds, postSuds: row.post_suds, peakSuds: row.peak_suds,
    hardStopReason: row.hard_stop_reason,
  };
  return {
    id: row.id,
    moduleId: row.module_id,
    status: row.status,
    endedAt: row.ended_at,
    ...base,
    said: describeSession(base),
    readings: describeReadings(base),
    outstanding: outstandingOn(base),
  };
}
