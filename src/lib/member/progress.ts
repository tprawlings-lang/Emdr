// The member_progress projection (Web GUI handoff §10.2, page example
// "Member Progress", schema member_progress.v6).
//
// THIS SCREEN CARRIES A DELIBERATE REVERSAL. Read docs/site/gui-decisions.md
// before changing it.
//
// Handoff 04 §3 and Vol 2 forbid a score, a band or a chart on ANY member
// surface, and src/lib/member/view.ts makes that structural: the member view
// model has no field a score could occupy. That boundary still holds
// everywhere else, and this module does not go around it — it is a separate
// projection with its own, narrower licence.
//
// The licence: handoff 06 §10.2 designs a member Progress screen built on
// exactly those values, and its own acceptance line bounds them —
//
//   "Pattern language only; no diagnosis or readiness conclusion."
//
// and §26's member acceptance repeats it: "No score is presented as diagnosis,
// readiness or proof of improvement."
//
// So the rule here is not "scores are fine now". It is that a number may be
// shown as a PATTERN and never as a VERDICT. §10.2 fixes the order to make that
// hard to get wrong: "1. Plain-language change statement. 2. Current period
// compared with prior period. 3. One primary trend." The sentence comes first
// and the number supports it, rather than the number arriving bare for the
// member to interpret into a grade.
//
// The counter-argument that lost is worth keeping visible: a member-facing
// number invites performance — the member starts managing the score rather than
// reporting their state, which corrupts the instrument as well as the
// experience. That is why every value below carries its comparison window and
// its missingness, and why `assertPatternOnly` refuses verdict language.

import { data } from "../data";
import { activePolicy } from "../clinical-policy";
import {
  ready, empty, partial, type Envelope, type ProjectionMeta, type MissingSource,
} from "../presentation/envelope";

export const MEMBER_PROGRESS_SCHEMA = "member_progress.v6";

/** A period, always named. §10.2: "Current period compared with prior period."
 *  A change with no comparison window is not a change, it is an assertion. */
export interface Window {
  days: number;
  from: string;
  to: string;
}

export type Direction = "improving" | "steadier" | "harder" | "mixed" | "unclear";

/** One measured series, with everything needed to read it honestly. */
export interface ProgressSeries {
  instrument: string;
  /** Human name. The instrument code is not the label a member reads. */
  label: string;
  points: Array<{ at: string; value: number }>;
  /** The instrument's own range, so a value is legible without a lookup. */
  bounds: { min: number; max: number };
  /** Which direction is the better one for THIS instrument. Never assumed. */
  lowerIsBetter: boolean;
  /** Days in the window with no measurement. §10.2: "missing days shown". */
  missingDays: number;
}

export interface MemberProgress {
  window: Window;
  priorWindow: Window;
  /** §10.2's opening item: the plain-language statement, first. */
  statement: string;
  direction: Direction;
  /** Counts of what the member DID. Activity, not achievement — and never
   *  framed as a streak, which is a score with a friendlier name. */
  activity: { checkins: number; activities: number; sessions: number };
  series: ProgressSeries[];
  /** §10.2: "Event markers that may explain movement." */
  markers: Array<{ at: string; label: string }>;
}

export class ProgressBoundaryError extends Error {}

/** Verdict language, refused.
 *
 *  The boundary this screen actually needs. A number shown as a pattern is
 *  within §10.2; the same number captioned "you are doing well" is a readiness
 *  conclusion, which §26 forbids and which no projection should be able to
 *  emit. Checked on the statement because that is the sentence the member reads
 *  first and believes. */
const VERDICT = [
  "diagnos", "disorder", "severe", "moderate", "mild", "normal", "abnormal",
  "recovered", "cured", "healthy", "ready for", "you are doing well",
  "on track", "behind", "improvement proves", "success", "failing", "good job",
];

export function assertPatternOnly(p: MemberProgress): MemberProgress {
  const s = p.statement.toLowerCase();
  const hit = VERDICT.find((v) => s.includes(v));
  if (hit) {
    throw new ProgressBoundaryError(
      `the progress statement contains "${hit}", which reads as a verdict. ` +
      "§10.2 allows pattern language only — no diagnosis, no readiness conclusion, " +
      "no proof of improvement. Describe what moved and over what window; let the " +
      "member draw their own conclusion, and leave clinical interpretation to a clinician."
    );
  }
  if (!p.window.from || !p.priorWindow.from) {
    throw new ProgressBoundaryError("a change with no comparison window is an assertion, not a change");
  }
  return p;
}

const INSTRUMENTS: Record<string, { label: string; min: number; max: number; lowerIsBetter: boolean }> = {
  "phq-9": { label: "Low mood", min: 0, max: 27, lowerIsBetter: true },
  "gad-7": { label: "Worry and tension", min: 0, max: 21, lowerIsBetter: true },
  "pcl-5": { label: "Trauma symptoms", min: 0, max: 80, lowerIsBetter: true },
};

function iso(d: Date): string { return d.toISOString().slice(0, 10); }

/** The statement, in pattern language.
 *
 *  Deliberately dull. §10.2 wants the member to know what moved and over what
 *  period; anything warmer starts editorialising, and an encouraging sentence
 *  on a screen the member opened after a bad fortnight is its own harm. */
function statementFor(direction: Direction, label: string | null, days: number): string {
  if (!label) return `Not enough measurements yet to show a pattern over ${days} days.`;
  switch (direction) {
    case "improving": return `${label} has been lower over the last ${days} days than the ${days} before.`;
    case "harder":    return `${label} has been higher over the last ${days} days than the ${days} before.`;
    case "steadier":  return `${label} has stayed about the same over the last ${days} days.`;
    case "mixed":     return `${label} has moved in both directions over the last ${days} days.`;
    default:          return `There is not enough recent data to describe a pattern in ${label}.`;
  }
}

export async function buildMemberProgress(args: {
  userId: string;
  tenantId: string;
  days?: number;
  now?: Date;
}): Promise<Envelope<MemberProgress>> {
  const days = args.days ?? 30;
  const now = args.now ?? new Date();
  const policy = activePolicy();
  const c = await data();

  const meta: ProjectionMeta = {
    schemaVersion: MEMBER_PROGRESS_SCHEMA,
    projectionVersion: `${MEMBER_PROGRESS_SCHEMA}+${policy.version}`,
    generatedAt: now.toISOString().replace("T", " ").slice(0, 19),
    tenantId: args.tenantId,
    sourceWatermark: null,
    policyVersion: policy.version,
  };

  const end = new Date(now);
  const start = new Date(now.getTime() - days * 86400000);
  const priorStart = new Date(now.getTime() - days * 2 * 86400000);
  const window: Window = { days, from: iso(start), to: iso(end) };
  const priorWindow: Window = { days, from: iso(priorStart), to: iso(start) };

  const rows = (await c.all(
    `SELECT instrument, total_score, created_at FROM screenings
      WHERE user_id = ? AND created_at >= ? ORDER BY created_at ASC`,
    [args.userId, iso(priorStart)]
  )) as Array<{ instrument: string; total_score: number; created_at: string }>;

  const [checkins, activities, sessions] = await Promise.all([
    c.get(`SELECT COUNT(*) AS n FROM checkins WHERE user_id = ? AND checkin_date >= ?`, [args.userId, iso(start)]),
    c.get(`SELECT COUNT(*) AS n FROM practice_completions WHERE user_id = ? AND created_at >= ?`, [args.userId, iso(start)]),
    c.get(`SELECT COUNT(*) AS n FROM therapy_sessions WHERE user_id = ? AND started_at >= ?`, [args.userId, iso(start)]),
  ]) as Array<{ n: number } | undefined>;

  // Group by instrument, split into the two windows.
  const byInstrument = new Map<string, Array<{ at: string; value: number }>>();
  for (const r of rows) {
    const key = r.instrument.toLowerCase();
    if (!INSTRUMENTS[key]) continue;
    (byInstrument.get(key) ?? byInstrument.set(key, []).get(key)!).push({
      at: r.created_at.slice(0, 10), value: r.total_score,
    });
  }

  const series: ProgressSeries[] = [];
  let primary: { label: string; direction: Direction } | null = null;

  for (const [key, points] of byInstrument) {
    const spec = INSTRUMENTS[key];
    const current = points.filter((p) => p.at >= window.from);
    const prior = points.filter((p) => p.at < window.from);
    series.push({
      instrument: key,
      label: spec.label,
      points,
      bounds: { min: spec.min, max: spec.max },
      lowerIsBetter: spec.lowerIsBetter,
      // Days in the window with no measurement — §10.2's "missing days shown".
      missingDays: Math.max(0, days - new Set(current.map((p) => p.at)).size),
    });

    if (primary || current.length === 0 || prior.length === 0) continue;
    const avg = (xs: typeof points) => xs.reduce((s, p) => s + p.value, 0) / xs.length;
    const delta = avg(current) - avg(prior);
    // A threshold, so noise does not read as movement. Two points on a 27-point
    // scale is not a pattern, and calling it one is the overclaim §10.2 guards.
    const meaningful = Math.abs(delta) >= 2;
    const better = spec.lowerIsBetter ? delta < 0 : delta > 0;
    primary = {
      label: spec.label,
      direction: !meaningful ? "steadier" : better ? "improving" : "harder",
    };
  }

  const progress: MemberProgress = {
    window, priorWindow,
    statement: statementFor(primary?.direction ?? "unclear", primary?.label ?? null, days),
    direction: primary?.direction ?? "unclear",
    activity: {
      checkins: checkins?.n ?? 0,
      activities: activities?.n ?? 0,
      sessions: sessions?.n ?? 0,
    },
    series,
    markers: [],
  };
  assertPatternOnly(progress);

  if (series.length === 0 && progress.activity.checkins === 0) {
    // §30.8: an absence has to say whether it is EXPECTED, and the two
    // absences here have different reasons. "Nothing to show yet" is true for
    // somebody who has just arrived and false for somebody with months of
    // check-ins that all fall outside the period being looked at — and the
    // second was being told the first's sentence, which reads as though their
    // history had been lost.
    const ever = (await c.get(
      `SELECT COUNT(*) AS n, MAX(checkin_date) AS last FROM checkins WHERE user_id = ?`,
      [args.userId],
    )) as { n: number; last: string | null } | undefined;
    const total = Number(ever?.n ?? 0);
    return empty<MemberProgress>(
      meta,
      total === 0
        ? "There is nothing to show yet. A pattern needs a few weeks of check-ins before it means anything."
        : `No check-ins in this period. There ${total === 1 ? "is" : "are"} ${total} on ` +
          `record, the most recent on ${ever?.last}. Try a longer period.`,
    );
  }

  // §30.8: show what is present and NAME what is missing. A trend drawn over
  // half a window without saying so is the "clean chart hiding incomplete data"
  // that §31.6 blocks a release for.
  const gaps: MissingSource[] = series
    .filter((s) => s.missingDays > days / 2)
    .map((s) => ({
      source: s.label,
      reason: `measured on ${days - s.missingDays} of ${days} days`,
    }));
  if (gaps.length > 0) return partial(meta, progress, gaps);

  return ready(meta, progress);
}
