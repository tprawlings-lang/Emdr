// Naming a session in a sentence (session-linked notes).
//
// ONE WORDING, TWO SURFACES, AND THAT IS THE POINT. A note now names the
// session it came from, and three places say so: the recorder before the
// clinician speaks, the note list on the Thoughts page, and Session Prep's
// "Last session" section. If each composed its own phrase, the brief would say
// one thing and the record another about the same row — which is the failure
// this whole feature exists to fix, reintroduced one layer up.
//
// PURE AND CLIENT-SAFE. The recorder is a client component, so this imports
// nothing but the module catalogue.

import { getModule } from "../modules";

export interface SessionRef {
  id: string;
  moduleId: string;
  /** As stored: "YYYY-MM-DD HH:MM:SS" or an ISO string. */
  startedAt: string;
}

/**
 * "the Calm Place session on 3 September".
 *
 * NO YEAR, and no time of day. A note is attached to a session within days of
 * it, and a timestamp precise to the second reads as a database key rather than
 * as a session somebody remembers running. When two sessions of the same module
 * fall on one day the date alone is ambiguous — `disambiguate` below is what
 * handles that, rather than making every label carry a clock to cover a case
 * that is usually absent.
 */
export function sessionLabel(session: SessionRef): string {
  const name = getModule(session.moduleId)?.name ?? session.moduleId;
  return `the ${name} session on ${onDay(session.startedAt)}`;
}

/** The same thing as a heading rather than as part of a sentence. */
export function sessionHeading(session: SessionRef): string {
  const name = getModule(session.moduleId)?.name ?? session.moduleId;
  return `${name} — ${onDay(session.startedAt)}`;
}

/**
 * Labels for a list, with the time added only where the date repeats.
 *
 * The same rule the clinician queue uses for repeated names: a disambiguator
 * appears when there is something to disambiguate and not otherwise, because a
 * clock on every row makes the reader check all of them.
 */
export function labelsFor(sessions: readonly SessionRef[]): Map<string, string> {
  const byDay = new Map<string, number>();
  for (const s of sessions) {
    const key = `${s.moduleId}|${onDay(s.startedAt)}`;
    byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }
  const out = new Map<string, string>();
  for (const s of sessions) {
    const key = `${s.moduleId}|${onDay(s.startedAt)}`;
    out.set(
      s.id,
      (byDay.get(key) ?? 0) > 1
        ? `${sessionLabel(s)} at ${atTime(s.startedAt)}`
        : sessionLabel(s)
    );
  }
  return out;
}

/** Just the day, for a surface whose heading already names the module. */
export function sessionDay(session: SessionRef): string {
  return onDay(session.startedAt);
}

/** A stored stamp as a day somebody reads.
 *
 *  Exported because the note list needed it: its own column rendered
 *  "2026-09-04 00:00:00" — a midnight nobody recorded anything at — directly
 *  beside the session line this file formats. Two formats and a false time, in
 *  one row. */
export function readableDay(stamp: string): string {
  return onDay(stamp);
}

function onDay(stamp: string): string {
  const iso = `${stamp.slice(0, 10)}T12:00:00Z`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return stamp.slice(0, 10);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
}

function atTime(stamp: string): string {
  return stamp.slice(11, 16) || "an unrecorded time";
}
