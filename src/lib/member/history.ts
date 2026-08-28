// The self-assembling history strip (Presentation Layer Handoff §1.4, §8).
//
// This replaces the PCL-5 and ITQ trend charts that were being rendered to
// members — charts Vol 2 forbids outright.
//
// The pattern is Wysa's, and the handoff names why it fits: "The member never
// fills out a log; the system assembles one from what they actually did." A
// member gets a record without being asked to produce one, which matters in a
// population where the effort of self-reporting is itself a barrier.
//
// What it must never receive, per §8's component contract: "dates-as-streak,
// counts, charts."
//
// A streak deserves its own sentence, because it is the one that looks
// harmless. A streak is a score with a friendlier name. It creates the same
// performance pressure a score does, and it converts a missed day — which in
// this population is often a bad day, the day the product exists for — into a
// visible failure the member is shown on return. It is exactly the shame
// dynamic §2 warns about, wearing a badge.

import { data } from "../data";

/** Substrings that must never appear as a field on the history strip.
 *  Asserted by tests/member-boundary.test.ts. */
export const HISTORY_FORBIDDEN = [
  "streak", "count", "total", "percent", "score", "average", "band", "track",
] as const;

/** One thing the member actually did. A reference and a day — no duration
 *  target, no completion percentage, no comparison to any other day. */
export interface HistoryItem {
  /** Which practice. */
  id: string;
  name: string;
  /** The day it happened, for grouping. Never rendered as a gap or a run. */
  day: string;
  kind: "session" | "practice" | "lesson";
}

export interface HistoryDay {
  day: string;
  items: HistoryItem[];
}

/** Recent activity, newest day first.
 *
 *  Bounded by a number of DAYS rather than a number of items, so the shape of
 *  the strip does not itself communicate volume. Deliberately no total, and
 *  deliberately no notion of "days active" — see HISTORY_FORBIDDEN. */
export async function memberHistory(
  userId: string,
  opts: { days?: number } = {}
): Promise<HistoryDay[]> {
  const c = await data();
  const days = opts.days ?? 14;
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  const rows: HistoryItem[] = [];

  for (const r of (await c.all(
    `SELECT module_id, ended_at FROM therapy_sessions
      WHERE user_id = ? AND status = 'completed' AND ended_at >= ?
      ORDER BY ended_at DESC`,
    [userId, since]
  )) as Array<{ module_id: string; ended_at: string }>) {
    rows.push({
      id: r.module_id,
      name: prettify(r.module_id),
      day: r.ended_at.slice(0, 10),
      kind: "session",
    });
  }

  for (const r of (await c.all(
    `SELECT practice_id, created_at FROM practice_completions
      WHERE user_id = ? AND created_at >= ? ORDER BY created_at DESC`,
    [userId, since]
  )) as Array<{ practice_id: string; created_at: string }>) {
    rows.push({
      id: r.practice_id,
      name: prettify(r.practice_id),
      day: r.created_at.slice(0, 10),
      kind: "practice",
    });
  }

  for (const r of (await c.all(
    `SELECT lesson_id, created_at FROM lesson_reads
      WHERE user_id = ? AND created_at >= ? ORDER BY created_at DESC`,
    [userId, since]
  )) as Array<{ lesson_id: string; created_at: string }>) {
    rows.push({
      id: r.lesson_id,
      name: prettify(r.lesson_id),
      day: r.created_at.slice(0, 10),
      kind: "lesson",
    });
  }

  // Group by day, newest first. Days with nothing in them are simply absent —
  // rendering an empty day would be a gap in a streak, which is the thing this
  // is built to avoid.
  const byDay = new Map<string, HistoryItem[]>();
  for (const item of rows) {
    if (!byDay.has(item.day)) byDay.set(item.day, []);
    byDay.get(item.day)!.push(item);
  }

  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([day, items]) => ({ day, items }));
}

function prettify(id: string): string {
  return id.replace(/[-_]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}
